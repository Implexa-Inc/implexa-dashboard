'use client';

import { useState } from 'react';
import Link from 'next/link';
import { callBackend } from '@/lib/api';

type KeyRow = { id: string; name: string; key_prefix: string; status: string; created_at: string; last_used_at: string | null };

export default function ApiKeysManager({ jwt, initial, next }: { jwt: string; initial: KeyRow[]; next?: string | null }) {
  const [keys, setKeys] = useState<KeyRow[]>(initial);
  const [newName, setNewName] = useState('');
  const [revealedKey, setRevealedKey] = useState<{ rawKey: string; name: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create() {
    if (!newName.trim()) return;
    setError(null); setBusy(true);
    try {
      const r = await callBackend('/api/v2/api-keys', {
        jwt, method: 'POST', body: { name: newName.trim() },
      });
      setRevealedKey({ rawKey: r.rawKey, name: r.name });
      setNewName('');
      // Append to list (without the raw)
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
    if (!confirm('Revoke this key? Anything currently using it will lose access.')) return;
    setError(null);
    try {
      await callBackend(`/api/v2/api-keys/${id}`, { jwt, method: 'DELETE' });
      setKeys(keys.map(k => k.id === id ? { ...k, status: 'revoked' } : k));
    } catch (err: any) {
      setError(err.message);
    }
  }

  return (
    <div className="space-y-6">
      {/* Newly-created key dialog (reveals raw value ONCE) */}
      {revealedKey && (
        <div className="card border-2 border-brand-500 bg-brand-50">
          <h3 className="font-medium text-ink-50">✨ Key created — copy it now</h3>
          <p className="text-sm text-ink-200 mt-1">This is the only time the full value will be shown. Save it to your password manager too.</p>
          <div className="mt-3 flex items-center gap-2">
            <code className="flex-1 bg-ink-950 border border-ink-700 text-ink-100 rounded px-3 py-2 text-sm font-mono break-all">{revealedKey.rawKey}</code>
            <button
              onClick={() => { navigator.clipboard.writeText(revealedKey.rawKey); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
              className={`btn-primary whitespace-nowrap ${copied ? '!bg-success-400' : ''}`}
            >
              {copied ? '✓ Copied' : 'Copy'}
            </button>
          </div>

          {/* Continue-with-install CTA when we came from /install */}
          {next ? (
            <div className="mt-4 pt-4 border-t border-brand-500/30">
              <p className="text-sm text-ink-200 mb-3">
                Copied your key? Go back to finish installing Implexa in Claude.
              </p>
              <Link
                href={next}
                className={`btn-primary inline-flex items-center gap-1.5 ${copied ? '!shadow-glow' : 'opacity-60'}`}
                title={copied ? '' : 'Copy the key first, then continue'}
              >
                Continue install →
              </Link>
              {!copied && <p className="text-xs text-ink-400 mt-2">Tip: copy the key first — you&apos;ll paste it in step 2.</p>}
            </div>
          ) : (
            <button onClick={() => setRevealedKey(null)} className="btn-ghost mt-3 text-xs">I&apos;ve saved it — dismiss</button>
          )}
        </div>
      )}

      {/* Create new key */}
      <div className="card">
        <h3 className="font-medium mb-3">Create a key</h3>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Name (e.g. Claude Code, My Mac)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="input flex-1"
          />
          <button onClick={create} disabled={busy || !newName.trim()} className="btn-primary">
            {busy ? 'Creating…' : 'Create'}
          </button>
        </div>
        {error && <p className="text-sm text-red-600 mt-3">{error}</p>}
      </div>

      {/* Existing keys */}
      <div className="card">
        <h3 className="font-medium mb-3">Your keys</h3>
        {keys.length === 0
          ? <p className="text-sm text-ink-500">No keys yet. Create one above.</p>
          : (
            <ul className="divide-y divide-ink-100 -mx-6">
              {keys.map(k => (
                <li key={k.id} className="px-6 py-3 flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{k.name}</div>
                    <div className="text-xs text-ink-500 font-mono">imp_live_{k.key_prefix}…</div>
                    <div className="text-xs text-ink-500 mt-0.5">
                      Created {new Date(k.created_at).toLocaleDateString()}
                      {k.last_used_at && ` · last used ${new Date(k.last_used_at).toLocaleDateString()}`}
                    </div>
                  </div>
                  {k.status === 'active'
                    ? <button onClick={() => revoke(k.id)} className="text-xs text-red-600 hover:underline">Revoke</button>
                    : <span className="text-xs text-ink-500 italic">revoked</span>}
                </li>
              ))}
            </ul>
          )}
      </div>
    </div>
  );
}
