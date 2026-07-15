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
 *     claude:// deep link, handled by the OS). We never claim it worked: the run is
 *     retried, which re-runs the same preflight against a FRESH capability report.
 *   - run_anyway         → re-issues the run with force. We ask, we never forbid: our
 *     evidence can be stale and the user knows their machine better than we do.
 */

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { callBackend } from '@/lib/api';

export type CapabilityAction = {
  kind: 'switch_engine' | 'install_capability' | 'run_anyway';
  label: string;
  detail?: string;
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
  const supabase = createClient();

  async function act(a: CapabilityAction) {
    setErr('');
    if (a.kind === 'run_anyway') { onRetry({ force: true }); return; }

    if (a.kind === 'install_capability') {
      // Hand off to the engine's own permission UI. The grant itself happens in
      // Claude/Codex — Implexa can only ever TRIGGER a Class-2 OS permission, never
      // grant it. So we open the door and let the retry re-check for real; we never
      // infer a grant from the panel merely having been opened.
      if (a.url) window.location.href = a.url;
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

      <div className="mt-4 flex flex-wrap gap-2">
        {card.actions.map((a) => {
          const key = a.kind + (a.engine || '');
          // Run anyway is deliberately the quiet one — it is the escape hatch, not
          // the recommendation.
          const primary = a.kind !== 'run_anyway';
          return (
            <button
              key={key}
              type="button"
              disabled={busy === key}
              onClick={() => act(a)}
              title={a.detail || undefined}
              className={primary
                ? 'btn-success text-xs px-3 py-1.5 disabled:opacity-60'
                : 'btn-outline text-xs px-3 py-1.5 disabled:opacity-60'}
            >
              {busy === key ? 'Switching…' : a.label}
            </button>
          );
        })}
      </div>

      {/* After an install the user comes back here; the retry re-runs the preflight
          against a fresh report, so this is the honest instruction, not a fake "done". */}
      {card.missing?.length ? (
        <div className="mt-3 text-xs text-ink-500">
          After granting it, run again — we re-check rather than assume.
        </div>
      ) : null}
      {err ? <div className="mt-2 text-xs text-red-700 dark:text-red-400">{err}</div> : null}
    </div>
  );
}
