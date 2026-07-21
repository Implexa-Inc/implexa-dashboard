'use client';

/**
 * VaultManager — the client body of /settings/local-vault.
 *
 * Every fact renders from one of two honest sources:
 *   LOCAL  (desktop bridge): what is saved, who is granted, when last used —
 *          masked metadata only, never a value.
 *   BACKEND (/me/vault-context): which agents MAY need each key + display names.
 *
 * Honesty rules (encoded + tested in lib/vault-view.ts):
 *   - absent bridge method = older app → calm fallback, reduced features;
 *   - REJECTED call = we don't know → never render "ready"/"saved"/"missing";
 *   - unreachable ('error') ≠ answered-no ('unavailable') — different fixes.
 *
 * Mutations: add/replace/allow open the desktop's own native key window
 * (openKeySetup); revoke/delete are REQUESTS decided in a native OS dialog.
 * This page never holds a primitive that can write a key or expand access.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { callBackend } from '@/lib/api';
import { useDesktopBridge } from '../../_components/api-key-row';
import { desktopAppLive, macDownloadUrl, appLocalVaultUrl } from '@/lib/app-links';
import {
  deriveVaultMode, deriveProviderCards, allowCandidates, relativeTime,
  type ListedKey, type ProviderMeta, type ProviderCardState,
} from '@/lib/vault-view';

type VaultContext = {
  ok: boolean;
  providers: ProviderMeta[];
  mayNeed: Record<string, Array<{ slug: string; name: string }>>;
  agentNames: Record<string, string>;
};

// Mirror of KEY_WAIT_TIMEOUT_MS in api-key-row.tsx: the local key window sends
// no cancel event, so a wait must self-expire rather than claim a save is coming.
const WAIT_MS = 90 * 1000;

export default function VaultManager({ jwt }: { jwt: string }) {
  const bridge = useDesktopBridge();
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const [availableResult, setAvailableResult] = useState<boolean | null>(null);
  const [availFailed, setAvailFailed] = useState(false);
  const [listed, setListed] = useState<ListedKey[] | null>(null);
  const [listFailed, setListFailed] = useState(false);
  const [configuredFallback, setConfiguredFallback] = useState<Record<string, boolean> | null>(null);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [ctx, setCtx] = useState<VaultContext | null>(null);
  const [ctxFailed, setCtxFailed] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const awaitingUntil = useRef<number>(0);

  const refreshLocal = useCallback(async () => {
    if (!bridge) return;
    if (bridge.keysAvailable) {
      try { setAvailableResult(await bridge.keysAvailable()); setAvailFailed(false); }
      catch { setAvailableResult(null); setAvailFailed(true); }
    }
    if (bridge.listKeys) {
      try { setListed(await bridge.listKeys()); setListFailed(false); }
      catch { setListed(null); setListFailed(true); }
    } else if (bridge.keysConfigured) {
      try { setConfiguredFallback(await bridge.keysConfigured()); } catch { setConfiguredFallback(null); }
    }
    setCheckedAt(Date.now());
  }, [bridge]);

  useEffect(() => { refreshLocal(); }, [refreshLocal]);
  // The local key window has no cancel event; after opening it we poll briefly
  // (plus the keys:changed push) and stop claiming anything after WAIT_MS.
  useEffect(() => {
    const unsub = bridge?.onKeysChanged?.(() => refreshLocal());
    const tick = setInterval(() => { if (Date.now() < awaitingUntil.current) refreshLocal(); }, 3000);
    return () => { clearInterval(tick); if (unsub) unsub(); };
  }, [bridge, refreshLocal]);

  const grantedSlugs = useMemo(
    () => [...new Set((listed || []).flatMap((k) => k.grantedAgents || []))].sort(),
    [listed],
  );
  const grantedKey = grantedSlugs.join(',');
  useEffect(() => {
    let alive = true;
    callBackend(`/api/v2/me/vault-context?granted=${encodeURIComponent(grantedKey)}`, { jwt })
      .then((r) => { if (alive) { setCtx(r); setCtxFailed(false); } })
      .catch(() => { if (alive) setCtxFailed(true); });
    return () => { alive = false; };
  }, [jwt, grantedKey]);

  const mode = deriveVaultMode({
    mounted,
    hasBridge: !!bridge,
    hasKeysAvailable: !!bridge?.keysAvailable,
    availableResult,
    checkFailed: availFailed,
  });

  // Registry: the backend serves the ONE provider table (with createUrl); the
  // local bridge's copy is the fallback so the page still lists providers when
  // the network read fails but the app is right here.
  const [bridgeRegistry, setBridgeRegistry] = useState<ProviderMeta[] | null>(null);
  useEffect(() => {
    if (!bridge?.keyProviders || ctx) return;
    bridge.keyProviders()
      .then((m) => setBridgeRegistry(Object.entries(m || {}).map(([provider, v]) => ({ provider, label: v.label, envVar: v.envVar, scope: v.scope }))))
      .catch(() => { /* leave null — cards render from ctx or not at all */ });
  }, [bridge, ctx]);
  const registry: ProviderMeta[] = ctx?.providers || bridgeRegistry || [];

  const cards = deriveProviderCards({ registry, listed, listFailed, configuredFallback });

  // ── Actions ────────────────────────────────────────────────────────────────
  const openLocal = async (provider: string, agentSlug?: string) => {
    if (!bridge?.openKeySetup) { setNote('Open the Implexa desktop app to manage keys.'); return; }
    setNote(null);
    const r = await bridge.openKeySetup(provider, agentSlug);
    if (!r.ok) {
      setNote(r.error === 'vault_unavailable'
        ? 'This Mac can’t store keys securely (system keychain unavailable).'
        : (r.error || 'Could not open the key window.'));
      return;
    }
    awaitingUntil.current = Date.now() + WAIT_MS;
  };
  const revokeGrant = async (provider: string, agentSlug: string) => {
    if (!bridge?.requestRevokeGrant) { setNote('Update the Implexa app to manage access from this page.'); return; }
    setNote(null);
    const r = await bridge.requestRevokeGrant(provider, agentSlug);
    if (r.ok) refreshLocal();
    else if (!r.cancelled) setNote(r.error || 'Could not revoke access.');
  };
  const deleteKey = async (provider: string) => {
    if (!bridge?.requestDeleteKey) { setNote('Update the Implexa app to delete keys from this page.'); return; }
    setNote(null);
    const r = await bridge.requestDeleteKey(provider);
    if (r.ok) refreshLocal();
    else if (!r.cancelled) setNote(r.error || 'Could not delete the key.');
  };

  if (!mounted) return null;

  // ── Web without the desktop app ────────────────────────────────────────────
  if (mode === 'web') {
    return (
      <div className="card">
        <h2 className="font-medium text-ink-50">Open Implexa desktop to manage local keys</h2>
        <p className="text-sm text-ink-300 mt-2 leading-relaxed">
          Your keys live on your Mac, so this page can only manage them when the
          desktop app is running. Nothing here is stored on Implexa&apos;s servers.
        </p>
        <div className="mt-4 flex items-center gap-3">
          {desktopAppLive() ? (
            <a href={appLocalVaultUrl()} className="btn-primary text-sm">Open Implexa desktop</a>
          ) : null}
          <a href={macDownloadUrl()} className="btn-outline text-sm" target="_blank" rel="noopener noreferrer">
            Download for Mac
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Vault status ── */}
      <div className="card">
        <div className="flex items-baseline justify-between mb-2">
          <h2 className="font-medium text-ink-50">Vault status</h2>
          <button type="button" onClick={refreshLocal} className="text-xs text-brand-500 hover:underline">Check again</button>
        </div>
        <ul className="text-sm text-ink-200 space-y-1.5">
          <li className="flex items-center gap-2">
            <Dot tone="ok" /> This Mac: connected through the Implexa app
          </li>
          <li className="flex items-center gap-2">
            {mode === 'ready' && <><Dot tone="ok" /> Vault: available</>}
            {mode === 'unavailable' && <><Dot tone="bad" /> Vault: unavailable — this Mac can&apos;t store keys securely (system keychain locked or unsupported)</>}
            {mode === 'error' && <><Dot tone="warn" /> Vault: couldn&apos;t check — the app didn&apos;t answer. That&apos;s different from &quot;unavailable&quot;; try Check again.</>}
            {mode === 'unsupported' && <><Dot tone="warn" /> Vault: this app version can&apos;t report vault status — update the Implexa app</>}
            {mode === 'loading' && <><Dot tone="warn" /> Vault: checking…</>}
          </li>
          <li className="flex items-center gap-2">
            <Dot tone="ok" /> Storage: encrypted local file, readable only by the Implexa app (keychain-bound)
          </li>
          {checkedAt && (
            <li className="text-xs text-ink-400">Last checked {new Date(checkedAt).toLocaleTimeString()}</li>
          )}
        </ul>
        <p className="text-xs text-ink-400 mt-3 leading-relaxed">
          Keys are stored on this Mac only. If you use another computer, add keys there too.
        </p>
      </div>

      {note && <p className="text-sm text-amber-700 dark:text-amber-300">{note}</p>}
      {ctxFailed && (
        <p className="text-xs text-ink-400">
          Couldn&apos;t load which agents may need keys — the saved-key list below is still live from this Mac.
        </p>
      )}

      {/* ── Provider cards ── */}
      {registry.length === 0 && (
        <p className="text-sm text-ink-300">Couldn&apos;t load the provider list. Try reloading the page.</p>
      )}
      {cards.map((card) => (
        <ProviderCard
          key={card.provider}
          card={card}
          ctx={ctx}
          onAdd={() => openLocal(card.provider)}
          onAllow={(slug) => openLocal(card.provider, slug)}
          onRevoke={(slug) => revokeGrant(card.provider, slug)}
          onDelete={() => deleteKey(card.provider)}
          canRequestRevoke={!!bridge?.requestRevokeGrant}
          canRequestDelete={!!bridge?.requestDeleteKey}
        />
      ))}
    </div>
  );
}

function Dot({ tone }: { tone: 'ok' | 'warn' | 'bad' }) {
  const cls = tone === 'ok' ? 'bg-success-400' : tone === 'warn' ? 'bg-amber-400' : 'bg-red-500';
  return <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${cls}`} aria-hidden="true" />;
}

function ProviderCard({ card, ctx, onAdd, onAllow, onRevoke, onDelete, canRequestRevoke, canRequestDelete }: {
  card: ProviderCardState;
  ctx: VaultContext | null;
  onAdd: () => void;
  onAllow: (slug: string) => void;
  onRevoke: (slug: string) => void;
  onDelete: () => void;
  canRequestRevoke: boolean;
  canRequestDelete: boolean;
}) {
  const [open, setOpen] = useState(false);
  const now = Date.now();
  const nameOf = (slug: string) => ctx?.agentNames?.[slug] || slug;
  const candidates = allowCandidates(ctx?.mayNeed?.[card.provider], card.grants);
  const used = relativeTime(card.lastUsedAt, now);
  const savedOn = card.savedAt ? new Date(card.savedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : null;

  return (
    <div className="card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium text-ink-50">{card.label}{card.scope ? <span className="text-xs text-ink-400 font-normal"> · {card.scope} only</span> : null}</div>
          <div className="text-xs text-ink-400 mt-1">
            {card.state === 'saved' && (
              <>
                {/* Masked marker + locally-sourced metadata only. */}
                <span className="font-mono text-ink-500">••••••••</span>
                {' '}Saved on this Mac{savedOn ? ` · saved ${savedOn}` : ''}
                {` · Used by ${card.grants.length} agent${card.grants.length === 1 ? '' : 's'}`}
                {used ? ` · Last used ${used}` : ' · Never used'}
              </>
            )}
            {card.state === 'missing' && 'No key saved'}
            {card.state === 'unknown' && 'Couldn’t check this Mac’s vault — not guessing. Use Check again above.'}
          </div>
        </div>
        <div className="flex-none flex items-center gap-1.5">
          {card.state === 'saved' && card.canManageAccess && (
            <button type="button" onClick={() => setOpen(!open)} className="btn-outline text-xs px-2.5 py-1">
              {open ? 'Hide access' : 'Manage access'}
            </button>
          )}
          {card.state === 'saved' && (
            <>
              {/* Replace = the ADD window; typing a new value rotates in place. */}
              <button type="button" onClick={onAdd} className="btn-outline text-xs px-2.5 py-1" title="Opens the Implexa key window. Saving a new value replaces the stored key.">Replace key</button>
              {canRequestDelete
                ? <button type="button" onClick={onDelete} className="text-xs text-red-600 dark:text-red-400 hover:underline px-1" title="Removes the key and every agent's access to it from this Mac. You'll confirm in an Implexa dialog.">Delete key</button>
                : <span className="text-[11px] text-ink-500">update app to delete</span>}
            </>
          )}
          {card.state === 'missing' && (
            <>
              {card.createUrl && (
                <a href={card.createUrl} target="_blank" rel="noopener noreferrer" className="btn-outline text-xs px-2.5 py-1">Create one</a>
              )}
              <button type="button" onClick={onAdd} className="btn-primary text-xs px-2.5 py-1">Add key</button>
            </>
          )}
        </div>
      </div>

      {card.state === 'saved' && !card.canManageAccess && (
        <p className="text-xs text-ink-500 mt-2">Update the Implexa app to see and manage which agents may use this key.</p>
      )}

      {open && card.canManageAccess && (
        <div className="mt-3 pt-3 border-t border-ink-800 space-y-3">
          <div>
            <h3 className="text-[11px] uppercase tracking-wider text-ink-500 font-medium mb-1.5">Allowed agents</h3>
            {card.grants.length === 0 ? (
              <p className="text-xs text-ink-400">No agent is allowed to use this key yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {card.grants.map((g) => {
                  const gUsed = relativeTime(g.lastUsedAt, now);
                  return (
                    <li key={g.agentSlug} className="flex items-center justify-between gap-3 text-sm">
                      <span className="min-w-0 truncate text-ink-100">
                        {nameOf(g.agentSlug)}
                        <span className="text-xs text-ink-500">
                          {g.grantedAt ? ` · allowed ${new Date(g.grantedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : ''}
                          {gUsed ? ` · last used ${gUsed}` : ''}
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() => onRevoke(g.agentSlug)}
                        className="flex-none text-xs text-red-600 dark:text-red-400 hover:underline"
                        title={canRequestRevoke ? "You'll confirm in an Implexa dialog." : 'Update the Implexa app to revoke from this page.'}
                      >
                        Revoke
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {candidates.length > 0 && (
            <div>
              <h3 className="text-[11px] uppercase tracking-wider text-ink-500 font-medium mb-1.5">May need this key</h3>
              <ul className="space-y-1.5">
                {candidates.map((a) => (
                  <li key={a.slug} className="flex items-center justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate text-ink-100">{a.name}</span>
                    {/* Allow opens the desktop's grant-only window (backend-verified
                        agent name + explicit confirmation) — one click here, one
                        deliberate confirm there. Never a silent web-side grant. */}
                    <button type="button" onClick={() => onAllow(a.slug)} className="flex-none btn-outline text-xs px-2.5 py-1">
                      Allow…
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-xs text-ink-500 leading-relaxed">
            Revoking access stops this agent from using the key on future runs.
            Runs already in progress may need to be restarted.
          </p>
        </div>
      )}
    </div>
  );
}
