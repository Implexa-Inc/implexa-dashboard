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
  kind: 'switch_engine' | 'install_capability' | 'run_anyway';
  label: string;
  detail?: string;
  /** Present-tense copy for the polling wait state — see capability-preflight.js. */
  waitingLabel?: string;
  engine?: 'claude' | 'codex';
  capability?: string;
  url?: string | null;
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
  /** The agent the card is about. Carried on the payload (not passed in) because a
   *  CONTINUE is raised from a surface that only knows a runId — the backend
   *  resolved the slug, so it hands it over rather than making every caller re-find it. */
  slug?: string;
};

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
  const pollRef = useRef<{ interval: ReturnType<typeof setInterval>; deadline: number } | null>(null);
  const supabase = createClient();

  function stopPolling() {
    if (pollRef.current) clearInterval(pollRef.current.interval);
    pollRef.current = null;
  }
  // Unmount safety — the modal can close (Esc/backdrop/×) mid-wait; don't leak the interval.
  useEffect(() => () => stopPolling(), []);

  function startPolling(a: CapabilityAction) {
    stopPolling();
    setPollTimedOut(false);
    setWaitingFor(a);
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    const tick = async () => {
      if (Date.now() > deadline) { stopPolling(); setPollTimedOut(true); return; }
      if (!a.engine || !a.capability) return; // nothing to poll for; shouldn't happen
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await callBackend(
          `/api/v2/me/capability-status?engine=${encodeURIComponent(a.engine)}&capability=${encodeURIComponent(a.capability)}`,
          { jwt: session?.access_token },
        );
        if (res?.value === true) {
          stopPolling();
          setWaitingFor(null);
          await onRetry();   // the grant is confirmed — re-attempt immediately, no second click
        }
      } catch {
        // A transient poll failure isn't the user's problem — just try again next tick.
      }
    };
    pollRef.current = { interval: setInterval(tick, POLL_INTERVAL_MS), deadline };
    tick();   // don't make the user wait a full interval for the first check
  }

  async function act(a: CapabilityAction) {
    setErr('');
    if (a.kind === 'run_anyway') { onRetry({ force: true }); return; }

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

      {waitingFor ? (
        // The button is GONE while we wait — founder's explicit call: once the link
        // is clicked, show live status, not a static button sitting there doing
        // nothing. Polls GET /me/capability-status; the moment it confirms the
        // grant, onRetry() fires automatically — no second click.
        <div className="mt-4">
          <div className="flex items-center gap-2 text-ink-200">
            {!pollTimedOut && (
              <span className="h-3 w-3 flex-none animate-spin rounded-full border-2 border-ink-400 border-t-transparent" aria-hidden />
            )}
            <span>{waitingFor.waitingLabel || `Waiting for you to enable ${waitingFor.label}…`}</span>
          </div>
          {pollTimedOut ? (
            <div className="mt-2 flex items-center gap-3 text-xs">
              <span className="text-ink-500">Still not seeing it — did you flip the toggle?</span>
              <button type="button" className="text-brand-500 hover:underline" onClick={() => startPolling(waitingFor)}>
                Check again
              </button>
            </div>
          ) : null}
          <button
            type="button"
            className="mt-2 text-xs text-ink-500 hover:underline"
            onClick={() => { stopPolling(); setWaitingFor(null); setPollTimedOut(false); }}
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-2.5">
          {card.actions.map((a) => {
            const key = a.kind + (a.engine || '');
            // Run anyway is deliberately the quiet one — it is the escape hatch, not
            // the recommendation.
            const primary = a.kind !== 'run_anyway';
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
              </div>
            );
          })}
        </div>
      )}
      {err ? <div className="mt-2 text-xs text-red-700 dark:text-red-400">{err}</div> : null}
    </div>
  );
}
