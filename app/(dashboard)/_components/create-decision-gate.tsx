'use client';

/**
 * <CreateDecisionGate /> — the capability-aware Create flow (2026-07-23 fix).
 *
 * The shipped plan-review modal opened for EVERY Create, presenting deterministic
 * defaults as if a model chose them and adding friction where no decision exists.
 * This gate reads the backend's `decisionMode` and does the RIGHT thing per
 * request instead of always opening a modal:
 *
 *   direct   → enqueue the build immediately, no modal at all.
 *   disclose → enqueue immediately + a compact, changeable confirmation
 *              ("Using your signed-in Gmail. Change in Setup.") folded into the
 *              surface's queued message.
 *   decide   → a FOCUSED question (the smallest one relevant: a video-format
 *              product question, an email source, or a capability gap) before
 *              queueing — never a generic vendor table up front. "Change tools"
 *              still opens the full editor (the existing PlanReviewModal).
 *
 * The gate never resolves vendors itself — it re-uses the same server-backed
 * helpers (fetchPlanPreview / createAgentBuild). Only a `decide` selection
 * becomes a confirmed toolPreference; direct/disclose enqueue the plain intent.
 */

import { useEffect, useRef, useState } from 'react';
import {
  fetchPlanPreview, createAgentBuild,
  type AgentPlan, type DecisionOption, type PlanDisclosure,
} from '@/lib/plan-review';
import PlanReviewModal from './plan-review-modal';
import Modal from './modal';

type Phase = 'loading' | 'decide' | 'advanced' | 'error';

export default function CreateDecisionGate({
  intent, mode, cron, timezone, onCancel, onCreated,
}: {
  intent: string;
  mode?: string;
  cron?: string;
  timezone?: string;
  onCancel: () => void;
  /** Called after the build is enqueued. `disclosures` lets the surface fold a
   *  compact confirmation into its own "Queued" message (disclose mode). */
  onCreated: (info?: { disclosures?: PlanDisclosure[] }) => void;
}) {
  const [plan, setPlan] = useState<AgentPlan | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const settled = useRef(false); // guards the single auto-enqueue for direct/disclose

  async function enqueue(opts: { toolPreferences?: string[]; buildIntent?: string; disclosures?: PlanDisclosure[] }) {
    if (creating) return;
    setCreating(true);
    setError(null);
    const res = await createAgentBuild({
      intent: opts.buildIntent ?? intent,
      toolPreferences: opts.toolPreferences ?? [],
      mode, cron, timezone,
    });
    setCreating(false);
    if (!res.ok) { setError(res.error || 'Could not queue the build.'); setPhase('error'); return; }
    onCreated(opts.disclosures ? { disclosures: opts.disclosures } : undefined);
  }

  // Fetch the plan ONCE, then branch on the mode. direct/disclose auto-enqueue;
  // decide shows the focused question. A failed fetch is a recoverable error.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const p = await fetchPlanPreview(intent, [], []);
        if (!alive) return;
        setPlan(p);
        if (p.decisionMode === 'decide') { setPhase('decide'); return; }
        if (settled.current) return;
        settled.current = true;
        // direct: silent immediate build. disclose: same, plus the confirmation.
        // BOTH must carry autoToolPreferences — the trusted source the preview
        // disclosed ("Using your Outlook") has to ride the build, or the headless
        // builder re-derives a default (the P0 the disclose promise depends on).
        await enqueue({
          toolPreferences: p.autoToolPreferences,
          ...(p.decisionMode === 'disclose' ? { disclosures: p.disclosures } : {}),
        });
      } catch (e) {
        if (alive) { setError(e instanceof Error ? e.message : 'Could not build the plan.'); setPhase('error'); }
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intent]);

  // Any trusted auto-preference (e.g. a single connected inbox) must ride EVERY
  // build path, even a decide the user answers about a DIFFERENT capability —
  // otherwise answering "faceless" would drop the connected Gmail the preview
  // already resolved. Dedupe, explicit choice first.
  function withAuto(prefs: string[] = []): string[] {
    return Array.from(new Set([...prefs, ...(plan?.autoToolPreferences || [])]));
  }

  // ── decide: map a chosen option to a build ──────────────────────────────────
  function chooseOption(opt: DecisionOption) {
    const kind = plan?.decision?.kind;
    if (kind === 'source') {
      // The option id is a real tool/source id — rides as a confirmed preference.
      void enqueue({ toolPreferences: withAuto([opt.id]) });
    } else if (kind === 'video_format') {
      // Format isn't a vendor — fold the product choice into the intent so the
      // deterministic build honors it (the classifier reads the words).
      const suffix = opt.id === 'faceless'
        ? ' — make it faceless (no avatar or presenter).'
        : ' — use a talking-head avatar presenter.';
      void enqueue({ buildIntent: `${intent}${suffix}`, toolPreferences: withAuto() });
    } else {
      void enqueue({ toolPreferences: withAuto() });
    }
  }

  if (phase === 'advanced') {
    // The full editor — reuses the existing table + accept path unchanged.
    return (
      <PlanReviewModal
        intent={intent}
        mode={mode}
        cron={cron}
        timezone={timezone}
        basePreferences={plan?.autoToolPreferences || []}
        onCancel={() => setPhase('decide')}
        onCreated={() => onCreated()}
      />
    );
  }

  if (phase === 'error') {
    return (
      <Modal open onClose={onCancel} title="Couldn’t queue that" maxWidth="max-w-md">
        <p className="text-sm text-ink-400">{error}</p>
        <div className="mt-4 flex gap-2">
          <button type="button" className="btn btn-outline text-sm" onClick={onCancel}>Back</button>
        </div>
      </Modal>
    );
  }

  // While a direct/disclose plan is fetching + enqueuing, there is no modal —
  // just a lightweight, non-blocking status so a slow network isn't a dead click.
  if (phase === 'loading') {
    return (
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 rounded-full border border-ink-800 bg-ink-950/95 px-4 py-2 text-xs text-ink-300 shadow-lg">
        {creating ? 'Queuing your agent…' : 'Reviewing your request…'}
      </div>
    );
  }

  // ── decide: the focused question ────────────────────────────────────────────
  const decision = plan?.decision;
  const isGap = decision?.kind === 'gap';
  return (
    <Modal open onClose={onCancel} title={plan?.proposedName || 'Your new agent'} maxWidth="max-w-lg">
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-500">One quick choice</div>
      <p className="text-sm text-ink-100 leading-snug">{decision?.question}</p>
      {decision?.reason && <p className="mt-1 text-xs text-amber-600 dark:text-amber-400 leading-snug">{decision.reason}</p>}
      {decision?.needsConnection && (
        <p className="mt-1 text-xs text-ink-500 leading-snug">Pick one to use — you’ll sign in to it when the agent first runs.</p>
      )}

      {!isGap && (decision?.options?.length ?? 0) > 0 && (
        <div className="mt-4 grid gap-2">
          {decision!.options.map((opt) => (
            <button
              key={opt.id}
              type="button"
              disabled={creating}
              onClick={() => chooseOption(opt)}
              className="text-left rounded-lg border border-ink-800 bg-ink-900 hover:border-ink-600 px-3 py-2.5 disabled:opacity-60"
            >
              <div className="text-sm text-ink-100">{opt.label}</div>
              {opt.detail && <div className="text-xs text-ink-500 mt-0.5 leading-snug">{opt.detail}</div>}
            </button>
          ))}
        </div>
      )}

      {isGap && (
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" disabled={creating} onClick={() => enqueue({ toolPreferences: withAuto() })} className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-60">
            {creating ? 'Queuing…' : 'Build anyway'}
          </button>
          <span className="self-center text-xs text-ink-500">It’ll flag the gap instead of substituting a different tool.</span>
        </div>
      )}

      <div className="mt-5 flex items-center gap-3 flex-wrap border-t border-ink-800 pt-4">
        <button type="button" disabled={creating} onClick={() => setPhase('advanced')} className="btn-outline text-sm px-3 py-2">
          Change tools
        </button>
        <button type="button" disabled={creating} onClick={onCancel} className="text-sm text-ink-400 hover:text-ink-200 px-2 py-2">
          Cancel
        </button>
      </div>
    </Modal>
  );
}
