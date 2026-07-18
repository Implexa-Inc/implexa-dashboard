'use client';

/**
 * <KeyRow /> / <KeysList /> — the LOCAL KEY VAULT's "add your API key" UI
 * (LOCAL_KEY_VAULT_SPEC §3.1). Shared between every surface that lists an
 * agent's provider-key needs: the activation card's "API keys" step, and the
 * Overview tab's "What you'll need" panel (2026-07-18 founder ask: "we've
 * already built the design for it, reuse it" — this file IS that reuse, so a
 * third surface never re-implements this from scratch a third time).
 *
 * CRITICAL (2026-07-17 review, unchanged here): this remote page NEVER handles
 * a key value. Every path opens the packaged LOCAL key-entry window
 * (window.implexaDesktop.openKeySetup) where the user types the key; only a
 * masked boolean (keysConfigured) ever comes back to this page.
 */

import { useEffect, useState } from 'react';

export type DesktopBridge = {
  connectAccount?: (domain: string) => Promise<{ ok: boolean; message?: string }>;
  verifyAccount?: (domain: string) => Promise<{ ok: boolean; reachable?: boolean; identity?: string | null; message?: string }>;
  checkTool?: (key: string) => Promise<{ ok: boolean; installed?: boolean }>;
  installTool?: (key: string) => Promise<{ ok: boolean; installed?: boolean; alreadyInstalled?: boolean; message?: string }>;
  grantLocalPermissions?: (tools: string[]) => Promise<{ ok: boolean; added?: string[]; addedDirs?: string[]; error?: string }>;
  openKeySetup?: (provider: string, agentSlug?: string) => Promise<{ ok: boolean; error?: string }>;
  keysConfigured?: () => Promise<Record<string, boolean>>;
  // PER-AGENT grant booleans. keysConfigured is per-PROVIDER and therefore
  // cannot answer "may THIS agent use the saved key" — see the note on
  // InlineAddKeyButton for the dead end that caused.
  keysGrantedFor?: (agentSlug: string) => Promise<Record<string, boolean>>;
  onKeysChanged?: (cb: (info: { provider: string }) => void) => () => void;
};

export function desktopBridge(): DesktopBridge | null {
  if (typeof window === 'undefined') return null;
  return (window as Window & { implexaDesktop?: DesktopBridge }).implexaDesktop ?? null;
}

// Bridge detection AFTER mount only. Reading the bridge during render makes the
// server HTML (no bridge) disagree with the desktop webview's first client
// render (bridge present) — a hydration mismatch that crashes the page with
// React's production "client-side exception" (the founder hit it clicking into
// an activation card). First paint always matches the server; the app-only
// buttons appear right after mount.
export function useDesktopBridge(): DesktopBridge | null {
  const [bridge, setBridge] = useState<DesktopBridge | null>(null);
  useEffect(() => { setBridge(desktopBridge()); }, []);
  return bridge;
}

export type KeyItem = { provider: string; label: string; scope?: string; envVar?: string | null; createUrl?: string | null; configured?: boolean };

// THE WAITING STATE MUST NEVER TRAP (2026-07-18 founder report; the same P1 the
// #56 reviewer raised and I then reproduced here). Clicking "Add key" opens the
// LOCAL key-entry window and flips `awaiting` — but if the user closes that
// window WITHOUT saving, the desktop bridge sends no cancellation event, so
// nothing ever cleared `awaiting`: the button vanished and the row sat on
// "Waiting for save…" forever, with a full page reload the only way out.
//
// The real fix is a bridge-level cancel event, which needs a desktop release.
// These two rules fix it with the CURRENT installed app and stay correct once
// that event exists:
//   1. The action stays CLICKABLE while awaiting (re-opens the window) — the
//      user is never left without the control that got them here.
//   2. The wait self-expires, so a walked-away-from row returns to normal on
//      its own rather than lying about a save that is never coming.
const KEY_WAIT_TIMEOUT_MS = 90 * 1000;

export function KeyRow({ item, slug, onChanged }: { item: KeyItem; slug: string; onChanged: () => void }) {
  const bridge = useDesktopBridge();
  const [awaiting, setAwaiting] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // `item.configured` is PROVIDER-level (it comes from the server-computed
  // activation checklist, which reads keysConfigured). On its own it recreates
  // the exact dead end this whole change removes: a Runway key saved for Agent A
  // makes a brand-new Agent B read "configured on this Mac", hides the button,
  // and leaves no way to authorize B. So pair it with the PER-AGENT grant.
  // null = not yet known (or an older desktop with no keysGrantedFor) — treated
  // as "assume granted" so this never regresses the pre-existing behaviour.
  const [granted, setGranted] = useState<boolean | null>(null);
  // ABSENT METHOD ≠ FAILED CALL (2026-07-18 review, P2). Collapsing both into
  // granted=null made an IPC error render a saved key as ready and HIDE the
  // grant button — recreating the dead end during a transient failure. No
  // secret-access bypass (the local vault still denies an ungranted key), but
  // the UI would strand the user. A missing method is a legitimate legacy
  // fallback; an error from a method that IS there means we simply don't know,
  // and "don't know" must never render as "ready".
  const [verifyFailed, setVerifyFailed] = useState(false);

  const checkGrant = () => {
    if (!bridge?.keysGrantedFor) { setGranted(null); setVerifyFailed(false); return; }
    setVerifyFailed(false);
    bridge.keysGrantedFor(slug)
      .then((m) => { setGranted(!!m?.[item.provider]); setVerifyFailed(false); })
      .catch(() => { setGranted(null); setVerifyFailed(true); });
  };

  useEffect(() => {
    let alive = true;
    if (!bridge?.keysGrantedFor) { setGranted(null); setVerifyFailed(false); return; }
    setVerifyFailed(false);
    bridge.keysGrantedFor(slug)
      .then((m) => { if (alive) { setGranted(!!m?.[item.provider]); setVerifyFailed(false); } })
      .catch(() => { if (alive) { setGranted(null); setVerifyFailed(true); } });
    return () => { alive = false; };
  }, [bridge, slug, item.provider]);

  // Saved AND allowed for THIS agent. granted=null means the bridge has no
  // per-agent read at all (older desktop) → fall back to the provider boolean,
  // matching the old behaviour exactly. verifyFailed means we HAVE the read and
  // it errored → never claim ready; keep the control visible and retryable.
  const ready = !!item.configured && granted !== false && !verifyFailed;
  const needsGrantOnly = !!item.configured && granted === false;
  // A saved key we couldn't verify access for: opening the local window is always
  // the correct action anyway — it reads authoritative state from main, so it
  // shows the right mode (grant-only vs already-allowed) regardless of what this
  // remote page failed to learn.
  const verifyUnknown = !!item.configured && verifyFailed;

  // Open the LOCAL key-entry window (the value is typed there, never here), then
  // re-check keysConfigured on the keys:changed event and flip the step to done.
  const addKey = async () => {
    if (!bridge?.openKeySetup) { setNote('Open the Implexa desktop app to add your key.'); return; }
    setNote(null);
    const r = await bridge.openKeySetup(item.provider, slug);
    if (!r.ok) { setNote(r.error === 'vault_unavailable' ? 'This Mac can’t store keys securely (keychain unavailable).' : (r.error || 'Could not open key entry.')); return; }
    setAwaiting(true);
  };

  useEffect(() => {
    if (!awaiting || !bridge?.keysConfigured) return;
    let done = false;
    const check = async () => {
      if (done) return;
      try {
        // Complete on THIS AGENT being granted, not on a key merely existing. A
        // grant-only flow never changes keysConfigured (already true), so polling
        // that alone would spin to the timeout on every grant.
        if (bridge.keysGrantedFor) {
          const grants = await bridge.keysGrantedFor(slug);
          if (grants && grants[item.provider] === true) {
            done = true; setAwaiting(false); setGranted(true); onChanged(); return;
          }
          return;
        }
        // Older desktop with no keysGrantedFor: fall back to the provider boolean
        // so a first-time ADD still resolves instead of hanging.
        const map = await bridge.keysConfigured!();
        if (map && map[item.provider] === true) { done = true; setAwaiting(false); onChanged(); }
      } catch { /* retry on next tick/event */ }
    };
    const unsub = bridge.onKeysChanged?.(() => check());
    const interval = setInterval(check, 3000);
    // Self-expire: the user may have closed the window without saving, and the
    // bridge has no cancel event to tell us. Give up waiting rather than claim a
    // save is still coming.
    const expiry = setTimeout(() => { done = true; setAwaiting(false); }, KEY_WAIT_TIMEOUT_MS);
    return () => { done = true; clearInterval(interval); clearTimeout(expiry); if (unsub) unsub(); };
  }, [awaiting]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <li>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm text-ink-100">{item.label} API key{item.scope ? ` (${item.scope} only)` : ''}</span>
            {ready
              ? <span className="text-[11px] text-emerald-600 dark:text-emerald-400">ready for this agent</span>
              : verifyUnknown
                ? <span className="text-[11px] text-amber-700 dark:text-amber-300">saved — couldn’t check this agent’s access</span>
                : needsGrantOnly
                  ? <span className="text-[11px] text-amber-700 dark:text-amber-300">saved — not allowed for this agent yet</span>
                  : <span className="text-[11px] text-amber-700 dark:text-amber-300">not set</span>}
          </div>
          {note && <p className="text-xs text-ink-500 mt-0.5 leading-snug">{note}</p>}
          {/* Never silently resolve an unverified state to "ready" — say we don't
              know, and make re-checking one click. */}
          {verifyUnknown && !awaiting && (
            <p className="text-xs text-ink-500 mt-0.5 leading-snug">
              Couldn’t reach the Implexa app to check access.{' '}
              <button type="button" onClick={checkGrant} className="text-brand-500 hover:underline">Check again</button>
            </p>
          )}
          {awaiting && <p className="text-xs text-ink-500 mt-0.5 leading-snug">Waiting for you to confirm in the Implexa window — closed it? Hit Reopen.</p>}
        </div>
        {/* Shown until this agent is actually READY (saved AND allowed) — not
            merely until a key exists somewhere. Gating on item.configured alone
            hid the control from a saved-but-ungranted agent, which is the dead
            end this change exists to remove. Also deliberately NOT hidden while
            awaiting: closing the key window without saving used to leave this row
            with no control at all. */}
        {!ready && (
          <div className="flex-none flex items-center gap-1.5">
            {/* "Create one" only makes sense when there is no saved key yet. */}
            {item.createUrl && !needsGrantOnly && !verifyUnknown && (
              <a href={item.createUrl} target="_blank" rel="noopener noreferrer" className="btn-outline text-xs px-2.5 py-1">Create one</a>
            )}
            {bridge?.openKeySetup
              ? (
                <button
                  type="button"
                  onClick={addKey}
                  title={(needsGrantOnly || verifyUnknown)
                    ? 'Your key is already saved — this only allows this agent to use it.'
                    : undefined}
                  className="btn-outline text-xs px-2.5 py-1"
                >
                  {/* verifyUnknown reads as "Use saved key" too: a key IS saved, and
                      the local window resolves the real mode from main — so this is
                      correct whether the agent turns out to be granted or not. */}
                  {awaiting ? 'Reopen' : ((needsGrantOnly || verifyUnknown) ? 'Use saved key' : 'Add key')}
                </button>
              )
              : <span className="text-[11px] text-ink-500">Add it in the Implexa app</span>}
          </div>
        )}
      </div>
    </li>
  );
}

export function KeysList({ items, slug, trustLine, onChanged }: { items: KeyItem[]; slug: string; trustLine?: string; onChanged: () => void }) {
  const bridge = useDesktopBridge();
  return (
    <div className="mt-3 rounded-lg border border-ink-800 bg-ink-950/40 p-3">
      {trustLine && <p className="text-xs text-ink-300 mb-2 leading-snug">🔒 {trustLine}</p>}
      <ul className="space-y-3">
        {items.map((it) => <KeyRow key={it.provider} item={it} slug={slug} onChanged={onChanged} />)}
      </ul>
      {!bridge?.openKeySetup && (
        <p className="text-xs text-ink-500 mt-2 leading-snug">
          Keys are stored locally on your Mac by the Implexa desktop app — open the app to add one. The agent still activates now; a key-dependent step will pause until it’s set.
        </p>
      )}
    </div>
  );
}

// ── Inline "Add API Key" CTA, next to "Get it" ───────────────────────────────
// A LIGHTER variant of KeyRow for the "What you'll need" panel (agent-requirements
// .tsx): that panel is a plain informational list, one line per service, not the
// activation card's expandable step — so this renders as a single small button
// alongside "Get it ↗" rather than a full row with its own configured/not-set
// state line. Fetches its OWN state (this surface has no server-computed setup
// payload to read it from, unlike the activation card).
//
// TWO booleans, not one (2026-07-18 review). The vault stores a key ONCE per
// provider but denies every agent by default, so there are three real states:
//   saved=false               → "Add API key"      (paste + authorize)
//   saved=true, granted=false → "Use saved key"    (authorize only — NO re-paste)
//   saved=true, granted=true  → "key ready"        (nothing to do)
// Reading only keysConfigured (per-PROVIDER) collapsed the middle state into the
// last one: a brand-new agent that was NOT allowed rendered as "key configured"
// with no control at all, and the only way to authorize it was to re-paste the
// secret — which OVERWRITES the stored key. That is the dead end this fixes.
export function InlineAddKeyButton({ provider, slug }: { provider: string; slug: string }) {
  const bridge = useDesktopBridge();
  const [saved, setSaved] = useState<boolean | null>(null);
  const [granted, setGranted] = useState<boolean | null>(null);
  const [awaiting, setAwaiting] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const check = async () => {
    if (!bridge?.keysConfigured) return;
    try {
      const [cfg, grants] = await Promise.all([
        bridge.keysConfigured(),
        bridge.keysGrantedFor ? bridge.keysGrantedFor(slug) : Promise.resolve({} as Record<string, boolean>),
      ]);
      setSaved(!!cfg?.[provider]);
      setGranted(!!grants?.[provider]);
    } catch { /* leave as unknown — the button still offers to act */ }
  };

  useEffect(() => { check(); }, [bridge]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!awaiting || !bridge?.keysConfigured) return;
    let done = false;
    const poll = async () => {
      if (done) return;
      try {
        // Done when THIS AGENT is granted — not merely when a key exists. A
        // grant-only flow never changes keysConfigured (it was already true),
        // so polling that alone would spin until the timeout on every grant.
        const grants = bridge.keysGrantedFor ? await bridge.keysGrantedFor(slug) : null;
        if (grants && grants[provider] === true) {
          done = true; setAwaiting(false); setSaved(true); setGranted(true); return;
        }
        // Older desktop build with no keysGrantedFor: fall back to the provider
        // boolean so an ADD still resolves instead of hanging.
        if (!bridge.keysGrantedFor) {
          const map = await bridge.keysConfigured!();
          if (map && map[provider] === true) { done = true; setAwaiting(false); setSaved(true); }
        }
      } catch { /* retry on next tick/event */ }
    };
    const unsub = bridge.onKeysChanged?.(() => poll());
    const interval = setInterval(poll, 3000);
    // Self-expire — see KEY_WAIT_TIMEOUT_MS. Closing the key window without
    // saving sends no event, so without this the row waits forever.
    const expiry = setTimeout(() => { done = true; setAwaiting(false); }, KEY_WAIT_TIMEOUT_MS);
    return () => { done = true; clearInterval(interval); clearTimeout(expiry); if (unsub) unsub(); };
  }, [awaiting]); // eslint-disable-line react-hooks/exhaustive-deps

  // ONE action for both modes: open the local window. The window itself decides
  // whether to ask for a paste or only for authorization (it reads the same two
  // booleans from main, which is the authority) — the remote page never does.
  const openLocal = async () => {
    if (!bridge?.openKeySetup) { setNote('Open the Implexa desktop app to add your key.'); return; }
    setNote(null);
    const r = await bridge.openKeySetup(provider, slug);
    if (!r.ok) { setNote(r.error === 'vault_unavailable' ? 'Keychain unavailable on this Mac.' : (r.error || 'Could not open key entry.')); return; }
    setAwaiting(true);
  };

  if (saved && granted) {
    return <span className="text-[11px] text-emerald-600 dark:text-emerald-400 whitespace-nowrap">key ready</span>;
  }
  if (!bridge?.openKeySetup) {
    // Plain web / bridge not detected yet: never show a dead button.
    return note ? <span className="text-[11px] text-amber-700 dark:text-amber-300">{note}</span> : null;
  }
  // While awaiting, this stays a BUTTON (relabelled "reopen"), never a dead
  // <span> — closing the key window without saving previously left this row
  // with no control at all and a page reload as the only escape.
  const label = awaiting
    ? 'Waiting… — reopen'
    : (saved ? 'Use saved key' : 'Add API key');
  return (
    <button
      type="button"
      onClick={openLocal}
      title={awaiting
        ? 'Waiting for you to confirm in the Implexa window. Closed it? Click to reopen.'
        : (saved ? 'Your key is already saved — this only allows this agent to use it.' : undefined)}
      className={`flex-none text-xs whitespace-nowrap hover:underline ${awaiting ? 'text-ink-500' : 'text-brand-500'}`}
    >
      {label}
    </button>
  );
}
