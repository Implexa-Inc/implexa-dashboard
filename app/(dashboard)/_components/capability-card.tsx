'use client';

/**
 * <CapabilityCard /> — the answer to "this agent needs something this Mac can't do",
 * shown AT THE RUN CLICK instead of letting the run fail somewhere the user can't see.
 *
 * The backend answers a Run/Continue with 409 + `needsCapability` when the agent has
 * a HARD capability need (declared by its author, or proven by a previous run) that
 * the engine it would run on doesn't have. See lib/capability-preflight.js for why
 * this exists at all — short version: Setup has always said "Optional until an agent
 * needs screen-level control", and nothing could ever say an agent needed it, so the
 * promise was never kept and the run just quietly did the wrong thing.
 *
 * The card is CROSS-ENGINE on purpose. "This agent needs Computer Use" is a dead end.
 * "Codex doesn't have it, Claude does — switch, or install it for Codex" is a decision
 * the user can actually make in one click. We know both, so we say both.
 *
 * Every action here is real:
 *   - switch_engine      → POST /agents/:slug/executor, then re-run immediately.
 *   - install_capability → opens the engine's own permission surface (codex:// /
 *     claude:// deep link, handled by the OS), THEN POLLS for the grant instead of
 *     leaving the user to guess and re-click Run (founder's design, 2026-07-14: "once
 *     I click the link, remove the button and show loading text"). The button becomes
 *     a live "Waiting for you to enable…" state; the moment GET /me/capability-status
 *     confirms the flag, we auto-retry the run — no second click. We still never
 *     CLAIM it worked ourselves: the retry re-runs the full server-side preflight,
 *     the poll is only what decides WHEN to retry, not whether it will succeed.
 *   - run_anyway         → re-issues the run with force. We ask, we never forbid: our
 *     evidence can be stale and the user knows their machine better than we do.
 */

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { callBackend } from '@/lib/api';

// Stop asking after this long — a toggle the desktop app hasn't reported back yet
// (its own poll loop backs off to every 5 min when idle) shouldn't spin forever.
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 2 * 60 * 1000;

export type CapabilityAction = {
  kind: 'switch_engine' | 'install_capability' | 'run_anyway' | 'create_key' | 'paste_key';
  label: string;
  detail?: string;
  /** Present-tense copy for the polling wait state — see capability-preflight.js. */
  waitingLabel?: string;
  engine?: 'claude' | 'codex';
  capability?: string;
  url?: string | null;
  /** API-key actions (LOCAL_KEY_VAULT_SPEC): which provider, and its env-var NAME. */
  provider?: string;
  envVar?: string | null;
};

export type CapabilityCardData = {
  capability: string;
  label: string;
  why?: string;
  message: string;
  pinned?: 'claude' | 'codex' | null;
  available?: string[];
  missing?: string[];
  actions: CapabilityAction[];
  /** API-key card (capability:'apiKey'): the trust promise, shown prominently. */
  trustLine?: string;
  provider?: string;
  envVar?: string | null;
  /** The agent the card is about. Carried on the payload (not passed in) because a
   *  CONTINUE is raised from a surface that only knows a runId — the backend
   *  resolved the slug, so it hands it over rather than making every caller re-find it. */
  slug?: string;
};

// The desktop preload bridge (dashboard-preload.js). Present only inside the
// Implexa desktop app; undefined on plain web. The key VALUE crosses INTO the
// bridge (renderer → main → OS keychain) and never comes back.
type ImplexaDesktop = {
  keysAvailable?: () => Promise<boolean>;
  setKey?: (p: { provider: string; value: string; agentSlug?: string }) => Promise<{ ok: boolean; error?: string }>;
};
function desktopBridge(): ImplexaDesktop | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { implexaDesktop?: ImplexaDesktop }).implexaDesktop || null;
}

// Self-contained diagram of the exact click path — matches the founder's own
// annotated screenshot intent (arrows to "Computer use" in the sidebar, then "Any
// App" in the panel) without depending on hosting a real screenshot, which isn't
// reliably something this component can source. Scoped to the one combination that
// actually needs it: Codex's computer-use deep link lands one screen short of the
// toggle (see capability-preflight.js PERMISSION_URL), so this is the only spot in
// the app where "which of two things do I click" is genuinely ambiguous.
function CodexComputerUseHelp() {
  return (
    <svg viewBox="0 0 340 108" className="mt-2 w-full max-w-[340px]" role="img" aria-label="Click Computer use in the sidebar, then enable Any App">
      <rect x="1" y="1" width="110" height="106" rx="8" className="fill-none stroke-current opacity-30" />
      <text x="10" y="24" className="fill-current text-[10px] opacity-60">Settings</text>
      <text x="10" y="46" className="fill-current text-[10px] opacity-40">Browser</text>
      <rect x="4" y="56" width="102" height="20" rx="5" className="fill-current opacity-15" />
      <text x="10" y="70" className="fill-current text-[11px] font-medium">Computer use</text>
      <circle cx="118" cy="66" r="9" className="fill-current opacity-80" />
      {/* fill-ink-900 punches through to the card's own background (see .card in
          globals.css) so the badge number reads correctly in both light and dark —
          it's the real token, not a guessed CSS variable. */}
      <text x="118" y="70" textAnchor="middle" className="fill-ink-900 text-[10px] font-bold">1</text>
      <path d="M128 66 L176 66" className="stroke-current opacity-50" strokeWidth="1.5" markerEnd="url(#cuh-arrow)" />
      <defs>
        <marker id="cuh-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 Z" className="fill-current opacity-50" />
        </marker>
      </defs>
      <rect x="184" y="1" width="155" height="106" rx="8" className="fill-none stroke-current opacity-30" />
      <text x="192" y="20" className="fill-current text-[10px] font-medium">Computer use</text>
      {/* Badge sits in the LEFT MARGIN, clear of the row — the row starts at x=214
          (not x=188) specifically to leave it room, the same way badge 1 sits in the
          gap between the two panels rather than on top of either. */}
      <circle cx="199" cy="47" r="9" className="fill-current opacity-80" />
      <text x="199" y="51" textAnchor="middle" className="fill-ink-900 text-[10px] font-bold">2</text>
      <rect x="214" y="30" width="121" height="34" rx="6" className="fill-current opacity-15" />
      <text x="221" y="44" className="fill-current text-[10px] font-medium">Any App</text>
      <text x="221" y="56" className="fill-current text-[7px] opacity-60">Let ChatGPT control apps</text>
      <rect x="304" y="38" width="24" height="14" rx="7" className="fill-current opacity-80" />
      <circle cx="316" cy="45" r="5" className="fill-ink-900" />
    </svg>
  );
}

export default function CapabilityCard({ card, onRetry }: {
  card: CapabilityCardData;
  /** Re-issue the run. `force` carries the "Run anyway" choice through. */
  onRetry: (opts?: { force?: boolean }) => void | Promise<void>;
  /** Dismissal lives on the wrapping <Modal>'s × / backdrop / Esc — this card
   *  renders only its content, not a second close affordance. */
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState('');
  // The install_capability action we're actively polling for, or null. Distinct
  // from `busy` (a one-shot in-flight request) — this spans the whole open-link +
  // wait-for-the-toggle window, which can run for up to POLL_TIMEOUT_MS.
  const [waitingFor, setWaitingFor] = useState<CapabilityAction | null>(null);
  const [pollTimedOut, setPollTimedOut] = useState(false);
  const [checking, setChecking] = useState(false);   // the MANUAL "Check now" click, not the background poll
  const [showHelp, setShowHelp] = useState(false);
  // API-key paste flow: which action's field is open, the typed value, save state.
  const [pasteOpen, setPasteOpen] = useState(false);
  const [keyValue, setKeyValue] = useState('');
  const [savingKey, setSavingKey] = useState(false);
  const pollRef = useRef<{ interval: ReturnType<typeof setInterval>; deadline: number } | null>(null);
  // Guards against the background poll and a manual "Check now" click both landing
  // on a true result within the same few hundred ms — without this, both would call
  // onRetry() and queue the run twice.
  const succeededRef = useRef(false);
  const supabase = createClient();

  function stopPolling() {
    if (pollRef.current) clearInterval(pollRef.current.interval);
    pollRef.current = null;
  }
  // Unmount safety — the modal can close (Esc/backdrop/×) mid-wait; don't leak the interval.
  useEffect(() => () => stopPolling(), []);

  // The one thing both the background poll and the manual "Check now" button do:
  // ask the backend once, and if it's true, stop and retry the run. Split out so a
  // click doesn't have to wait for the NEXT interval tick — same logic, two triggers.
  async function checkOnce(a: CapabilityAction): Promise<boolean> {
    if (!a.engine || !a.capability) return false; // nothing to poll for; shouldn't happen
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await callBackend(
        `/api/v2/me/capability-status?engine=${encodeURIComponent(a.engine)}&capability=${encodeURIComponent(a.capability)}`,
        { jwt: session?.access_token },
      );
      if (res?.value === true && !succeededRef.current) {
        succeededRef.current = true;
        stopPolling();
        setWaitingFor(null);
        await onRetry();   // the grant is confirmed — re-attempt immediately, no second click
        return true;
      }
    } catch {
      // A transient poll failure isn't the user's problem — the background poll or
      // the next manual click will just try again.
    }
    return false;
  }

  function startPolling(a: CapabilityAction) {
    stopPolling();
    setPollTimedOut(false);
    succeededRef.current = false;
    setWaitingFor(a);
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    const tick = async () => {
      if (Date.now() > deadline) { stopPolling(); setPollTimedOut(true); return; }
      await checkOnce(a);
    };
    pollRef.current = { interval: setInterval(tick, POLL_INTERVAL_MS), deadline };
    tick();   // don't make the user wait a full interval for the first check
  }

  async function checkNow() {
    if (!waitingFor || checking) return;
    setChecking(true);
    try { await checkOnce(waitingFor); }
    finally { setChecking(false); }
  }

  // LOCAL KEY VAULT: write the pasted key to the OS keychain via the desktop
  // bridge and grant THIS agent, then re-run. The value goes renderer → main →
  // keychain and NEVER comes back or crosses the network. Web (no bridge) can't
  // store keys — the paste field shows the "get the app" state instead.
  async function saveKey(a: CapabilityAction) {
    setErr('');
    const bridge = desktopBridge();
    if (!bridge?.setKey) { setErr('Open the Implexa desktop app to store a key on this Mac.'); return; }
    if (!a.provider) { setErr('Could not identify the provider.'); return; }
    if (!keyValue.trim()) { setErr('Paste your key first.'); return; }
    setSavingKey(true);
    try {
      const res = await bridge.setKey({ provider: a.provider, value: keyValue.trim(), agentSlug: card.slug });
      if (!res?.ok) {
        setErr(res?.error === 'vault_unavailable'
          ? 'This Mac can’t store keys securely (system keychain unavailable).'
          : (res?.error || 'Could not save the key.'));
        return;
      }
      setKeyValue('');
      setPasteOpen(false);
      await onRetry();   // configured now — the preflight passes and the run proceeds
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save the key.');
    } finally {
      setSavingKey(false);
    }
  }

  async function act(a: CapabilityAction) {
    setErr('');
    if (a.kind === 'run_anyway') { onRetry({ force: true }); return; }

    // Open the provider's key page in a NEW TAB (http(s), noopener) — the human
    // mints the key there; Implexa never logs in or creates one (bright line §2).
    if (a.kind === 'create_key') {
      if (a.url) window.open(a.url, '_blank', 'noopener,noreferrer');
      setPasteOpen(true);   // reveal the paste field so the flow continues in place
      return;
    }
    if (a.kind === 'paste_key') { setPasteOpen(true); return; }

    if (a.kind === 'install_capability') {
      // Hand off to the engine's own permission UI. The grant itself happens in
      // Claude/Codex — Implexa can only ever TRIGGER a Class-2 OS permission, never
      // grant it. codex:// / claude:// isn't http(s), so this does NOT navigate the
      // tab away — the OS handles it via its registered protocol handler and this
      // page keeps running, which is what makes polling after it possible at all.
      if (a.url) window.location.href = a.url;
      startPolling(a);
      return;
    }

    if (a.kind === 'switch_engine' && a.engine) {
      if (!card.slug) { setErr('Could not identify the agent to switch.'); return; }
      setBusy(a.kind + a.engine);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        await callBackend(`/api/v2/agents/${encodeURIComponent(card.slug)}/executor`, {
          jwt: session?.access_token,
          method: 'POST',
          body: { executorPreference: a.engine },
        });
        await onRetry();   // the pin is written; the preflight will now pass
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Could not switch the engine.');
      } finally {
        setBusy(null);
      }
    }
  }

  return (
    // No outer card/border here — this renders INSIDE <Modal>, which already owns
    // the shell (title bar, × close, backdrop). A second nested card + a redundant
    // Cancel button (Modal's × already dismisses) was exactly the doubled-up chrome
    // the founder's inline-vs-modal call was about fixing.
    <div className="text-sm">
      <div className="text-ink-100">{card.message}</div>
      {card.why ? (
        <div className="mt-1 text-ink-400">{card.label} {card.why}.</div>
      ) : null}
      {/* THE TRUST PROMISE, prominent on the key card — the brand, not a footnote. */}
      {card.trustLine ? (
        <div className="mt-2 rounded-md border border-ink-800 bg-ink-900/40 p-2 text-xs text-ink-300">
          🔒 {card.trustLine}
        </div>
      ) : null}

      {waitingFor ? (
        // The button is GONE while we wait — founder's explicit call: once the link
        // is clicked, show live status, not a static button sitting there doing
        // nothing. Background poll (GET /me/capability-status every 3s) auto-retries
        // the run the instant it sees the grant — but "Check now" is ALSO visible
        // from the very first second, not gated behind a timeout, because clicking
        // it right after actually flipping the toggle should feel instant, not wait
        // out an interval (founder's correction, 2026-07-14: the original design
        // only offered a manual re-check after a 2-minute timeout).
        <div className="mt-4">
          <div className="flex items-center gap-2 text-ink-200">
            {!pollTimedOut && (
              <span className="h-3 w-3 flex-none animate-spin rounded-full border-2 border-ink-400 border-t-transparent" aria-hidden />
            )}
            <span>{waitingFor.waitingLabel || `Waiting for you to enable ${waitingFor.label}…`}</span>
          </div>
          {waitingFor.capability === 'computerUse' && waitingFor.engine === 'codex' && (
            <>
              <button
                type="button"
                className="mt-1 text-xs text-brand-500 hover:underline"
                onClick={() => setShowHelp((v) => !v)}
              >
                {showHelp ? 'Hide' : 'Show me exactly where to click'}
              </button>
              {showHelp ? <CodexComputerUseHelp /> : null}
            </>
          )}
          <div className="mt-2 flex items-center gap-3">
            <button
              type="button"
              disabled={checking}
              onClick={checkNow}
              className="btn-outline text-xs px-3 py-1.5 disabled:opacity-60"
            >
              {checking ? 'Checking…' : 'Check now'}
            </button>
            <button
              type="button"
              className="text-xs text-ink-500 hover:underline"
              onClick={() => { stopPolling(); setWaitingFor(null); setPollTimedOut(false); }}
            >
              Cancel
            </button>
          </div>
          {pollTimedOut ? (
            <div className="mt-2 text-xs text-ink-500">
              Still not seeing it — make sure you flipped the toggle, then Check now.
            </div>
          ) : null}
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-2.5">
          {card.actions.map((a) => {
            const key = a.kind + (a.engine || a.provider || '');
            // Run anyway is deliberately the quiet one — it is the escape hatch, not
            // the recommendation.
            const primary = a.kind !== 'run_anyway';
            // The paste field renders in place of the plain "Paste it here" button
            // once the key flow is open (either action reveals it).
            if (a.kind === 'paste_key' && pasteOpen) {
              const bridge = desktopBridge();
              if (!bridge?.setKey) {
                return (
                  <div key={key} className="text-xs text-ink-400">
                    Open the Implexa desktop app to paste and store your key on this Mac — it’s stored locally, never on the web.
                  </div>
                );
              }
              return (
                <div key={key} className="flex flex-col gap-2">
                  <input
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={keyValue}
                    onChange={(e) => setKeyValue(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') saveKey(a); }}
                    placeholder={`Paste your ${card.label} key${a.envVar ? ` (${a.envVar})` : ''}`}
                    className="input text-xs px-2 py-1.5"
                    aria-label={`${card.label} API key`}
                  />
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      disabled={savingKey || !keyValue.trim()}
                      onClick={() => saveKey(a)}
                      className="btn-success text-xs px-3 py-1.5 disabled:opacity-60"
                    >
                      {savingKey ? 'Saving…' : 'Save key & run'}
                    </button>
                    <span className="text-xs text-ink-500">Stored in your Mac’s keychain.</span>
                  </div>
                </div>
              );
            }
            return (
              <div key={key}>
                <button
                  type="button"
                  disabled={busy === key}
                  onClick={() => act(a)}
                  className={primary
                    ? 'btn-success text-xs px-3 py-1.5 disabled:opacity-60'
                    : 'btn-outline text-xs px-3 py-1.5 disabled:opacity-60'}
                >
                  {busy === key ? 'Switching…' : a.label}
                </button>
                {/* Visible, not a hover title — e.g. Codex's computer-use deep link
                    lands one settings screen short of the real toggle, and a hover-only
                    hint is easy to miss on something this actionable. */}
                {a.detail ? <div className="mt-1 text-xs text-ink-500">{a.detail}</div> : null}
                {a.capability === 'computerUse' && a.engine === 'codex' && (
                  <>
                    <button
                      type="button"
                      className="mt-1 text-xs text-brand-500 hover:underline"
                      onClick={() => setShowHelp((v) => !v)}
                    >
                      {showHelp ? 'Hide' : 'Show me exactly where to click'}
                    </button>
                    {showHelp ? <CodexComputerUseHelp /> : null}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
      {err ? <div className="mt-2 text-xs text-red-700 dark:text-red-400">{err}</div> : null}
    </div>
  );
}
