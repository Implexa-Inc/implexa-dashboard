'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { callBackend } from '@/lib/api';

type KeyRow = { id: string; name: string; key_prefix: string; status: string; created_at: string; last_used_at: string | null };

/**
 * "Connected installs" manager — primary action is revoke. Manual key
 * generation is folded into a collapsed Advanced disclosure for the
 * rare user who needs a raw key (Chat Custom Connector URL is the
 * remaining surface that requires one).
 */
export default function ApiKeysManager({ jwt, initial, next }: { jwt: string; initial: KeyRow[]; next?: string | null }) {
  const router = useRouter();
  const [keys, setKeys] = useState<KeyRow[]>(initial);
  const [newName, setNewName] = useState('');
  const [revealedKey, setRevealedKey] = useState<{ rawKey: string; name: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function goToNext() {
    if (!next) return;
    router.push(next);
    router.refresh();
  }

  async function create() {
    if (!newName.trim()) return;
    setError(null); setBusy(true);
    try {
      const r = await callBackend('/api/v2/api-keys', {
        jwt, method: 'POST', body: { name: newName.trim() },
      });
      setRevealedKey({ rawKey: r.rawKey, name: r.name });
      setNewName('');
      setKeys([
        { id: r.id, name: r.name, key_prefix: r.keyPrefix, status: 'active', created_at: r.createdAt, last_used_at: null },
        ...keys,
      ]);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    if (!confirm('Revoke this install? The connected device will lose access immediately — you\'ll need to re-run the install script on it.')) return;
    setError(null);
    try {
      await callBackend(`/api/v2/api-keys/${id}`, { jwt, method: 'DELETE' });
      setKeys(keys.map(k => k.id === id ? { ...k, status: 'revoked' } : k));
    } catch (err: any) {
      setError(err.message);
    }
  }

  const activeInstalls = keys.filter(k => k.status === 'active');
  const revokedInstalls = keys.filter(k => k.status === 'revoked');

  return (
    <div className="space-y-6">
      {/* ── Newly-created key dialog (reveals raw value ONCE) ──
        * Only shown right after the Advanced → Generate path. Most users
        * never hit this path because the install script auto-mints keys
        * without exposing them.
        */}
      {revealedKey && (
        <div className="card !border-2 !border-brand-500 !bg-gradient-to-r !from-brand-500/10 !to-brand-500/5">
          <h3 className="font-medium text-ink-50">✨ Key created — copy it now</h3>
          <p className="text-sm text-ink-200 mt-1">
            This is the only time the full value will be shown. Save it in your password manager.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <code className="flex-1 bg-ink-950 border border-ink-700 text-ink-100 rounded px-3 py-2 text-sm font-mono break-all">{revealedKey.rawKey}</code>
            <button
              onClick={() => { navigator.clipboard.writeText(revealedKey.rawKey); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
              className={`btn-primary whitespace-nowrap ${copied ? '!bg-success-400' : ''}`}
            >
              {copied ? '✓ Copied' : 'Copy'}
            </button>
          </div>

          {next ? (
            <div className="mt-4 pt-4 border-t border-brand-500/30">
              <p className="text-sm text-ink-200 mb-3">
                Copied your key? Go back to finish installing.
              </p>
              <button
                onClick={goToNext}
                disabled={!copied}
                className={`btn-primary inline-flex items-center gap-1.5 ${copied ? '!shadow-glow' : 'opacity-60 cursor-not-allowed'}`}
                title={copied ? '' : 'Copy the key first, then continue'}
              >
                Continue install →
              </button>
            </div>
          ) : (
            <button onClick={() => setRevealedKey(null)} className="btn-ghost mt-3 text-xs">I&apos;ve saved it — dismiss</button>
          )}
        </div>
      )}

      {/* ── Active installs — the primary section ── */}
      <div className="card">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="font-medium text-ink-50">Active installs</h2>
          <span className="text-xs text-ink-400">{activeInstalls.length} connected</span>
        </div>
        {activeInstalls.length === 0 ? (
          <div className="text-sm text-ink-300 leading-relaxed">
            <p className="mb-2">No active installs.</p>
            <p className="text-xs text-ink-400">
              Run <code className="bg-ink-800 px-1 rounded">curl -fsSL https://core.implexa.ai/install.sh | bash</code> to install Implexa — it creates the connection automatically.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-ink-800 -mx-6">
            {activeInstalls.map(k => (
              <InstallRow key={k.id} k={k} onRevoke={revoke} />
            ))}
          </ul>
        )}
      </div>

      {/* ── Revoked installs (collapsed, audit-only) ── */}
      {revokedInstalls.length > 0 && (
        <details className="card !p-0 group">
          <summary className="cursor-pointer hover:bg-ink-800/40 transition-colors px-6 py-3 select-none flex items-center gap-2 text-sm text-ink-300">
            <span className="text-ink-500 group-open:rotate-90 transition-transform inline-block">▸</span>
            <span>Revoked installs ({revokedInstalls.length})</span>
          </summary>
          <ul className="divide-y divide-ink-800 border-t border-ink-700/60">
            {revokedInstalls.map(k => (
              <InstallRow key={k.id} k={k} onRevoke={revoke} />
            ))}
          </ul>
        </details>
      )}

      {/* ── Advanced: manual key generation ──
        * Almost no one needs this. Kept here for:
        *   - Users wiring the Chat (Desktop) Custom Connector URL — that
        *     surface still has the API key embedded in the URL
        *   - Power users / scripted integrations
        */}
      <details className="card !p-0 group">
        <summary className="cursor-pointer hover:bg-ink-800/40 transition-colors px-6 py-3 select-none flex items-center gap-2 text-sm text-ink-300">
          <span className="text-ink-500 group-open:rotate-90 transition-transform inline-block">▸</span>
          <span>Advanced — generate a key manually</span>
        </summary>
        <div className="px-6 pb-5 pt-2 border-t border-ink-700/60">
          <p className="text-xs text-ink-400 mb-3 leading-relaxed">
            Most users don&apos;t need this — the install script creates keys automatically.
            Generate one manually only if you&apos;re wiring the Chat (Desktop) Custom
            Connector URL, or running a scripted integration.
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Install name (e.g. Personal laptop, CI agent)"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="input flex-1"
            />
            <button onClick={create} disabled={busy || !newName.trim()} className="btn-primary">
              {busy ? 'Creating…' : 'Generate'}
            </button>
          </div>
          {error && <p className="text-sm text-red-600 mt-3">{error}</p>}
        </div>
      </details>
    </div>
  );
}

/**
 * Single row in the installs list. Emphasizes the install name + when
 * it was created / last used. Key prefix shown small + monospace as
 * an "id" reference, not as a credential to copy.
 */
function InstallRow({ k, onRevoke }: { k: KeyRow; onRevoke: (id: string) => void }) {
  const created = new Date(k.created_at);
  const lastUsed = k.last_used_at ? new Date(k.last_used_at) : null;

  return (
    <li className="px-6 py-3.5 flex items-center gap-4">
      <div className="flex-1 min-w-0">
        <div className="font-medium text-ink-50 truncate">{k.name}</div>
        <div className="text-xs text-ink-400 mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
          <span>Created {created.toLocaleDateString()}</span>
          {lastUsed && <span>Last active {timeSince(lastUsed)}</span>}
          <span className="font-mono text-ink-500">imp_live_{k.key_prefix}…</span>
        </div>
      </div>
      {k.status === 'active' ? (
        <button
          onClick={() => onRevoke(k.id)}
          className="text-xs text-red-600 dark:text-red-400 hover:underline whitespace-nowrap"
        >
          Revoke
        </button>
      ) : (
        <span className="text-xs text-ink-500 italic">revoked</span>
      )}
    </li>
  );
}

function timeSince(d: Date) {
  const ms = Date.now() - d.getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString();
}
