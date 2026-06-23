'use client';

/**
 * <RunActionItems /> — the proposed FOLLOW-UP ACTIONS for a run (run_actions,
 * migration 0090), surfaced LOUD at the top of the run page.
 *
 * A delivered run often implies several next steps ("Publish the article",
 * "Approve the HeyGen render") that today die as prose in the deliverable's
 * "Holds / Next steps" section. The executing agent now emits them as data; this
 * renders them as one-tap buttons so the user acts without re-reading the markdown.
 *
 * Loud vs quiet (the founder's model):
 *   • READY actions → primary green buttons. One tap spawns a hands-off continue
 *     run that does the preset instruction from this run's deliverable.
 *   • NEEDS_SETUP actions → shown but muted, with the blocker ("needs the repo
 *     mounted"), since they need the user to enable something first.
 *   • Beyond the top two, the rest collapse under "More actions (N)".
 * Each action has a quiet ✕ to dismiss. The freeform "Continue this run" box
 * lower on the page stays as the escape hatch.
 *
 * Acting calls POST /runs/:id/actions/:actionId/act (spawns the continue/revise
 * run-request + flips the action to 'acting'); dismiss calls .../dismiss.
 */

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { callBackend } from '@/lib/api';

export type RunActionItem = {
  id: string;
  kind: 'publish' | 'approve_render' | 'continue' | 'revise' | 'approve' | 'other';
  label: string;
  summary: string | null;
  preset_prompt: string | null;
  readiness: 'ready' | 'needs_setup';
  blocker: string | null;
  confidence: number | null;
  status: 'open' | 'acting' | 'done' | 'dismissed';
};

export default function RunActionItems({ runId, actions }: { runId: string; actions: RunActionItem[] }) {
  const supabase = createClient();
  // Local lifecycle: hide a dismissed action, flip an acted one to a confirmation.
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [acted, setActed] = useState<Record<string, string>>({}); // id → confirmation line
  const [busy, setBusy] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function jwt() {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token;
  }

  async function act(a: RunActionItem) {
    if (busy) return;
    setBusy(a.id); setErr(null);
    try {
      await callBackend(`/api/v2/runs/${encodeURIComponent(runId)}/actions/${encodeURIComponent(a.id)}/act`, {
        jwt: await jwt(), method: 'POST', body: {},
      });
      setActed((m) => ({ ...m, [a.id]: `Queued — “${a.label}” runs hands-off. The result lands on Home.` }));
    } catch {
      setErr('Could not queue that. Try again.');
    } finally {
      setBusy(null);
    }
  }

  async function dismiss(a: RunActionItem) {
    if (busy) return;
    setBusy(a.id); setErr(null);
    try {
      await callBackend(`/api/v2/runs/${encodeURIComponent(runId)}/actions/${encodeURIComponent(a.id)}/dismiss`, {
        jwt: await jwt(), method: 'POST', body: {},
      });
      setHidden((s) => new Set(s).add(a.id));
    } catch {
      setErr('Could not dismiss. Try again.');
    } finally {
      setBusy(null);
    }
  }

  // Ready first, then needs_setup; within each, higher confidence first.
  const live = actions
    .filter((a) => !hidden.has(a.id))
    .sort((x, y) => {
      const r = (x.readiness === 'ready' ? 0 : 1) - (y.readiness === 'ready' ? 0 : 1);
      return r !== 0 ? r : (y.confidence ?? 0) - (x.confidence ?? 0);
    });
  if (live.length === 0) return null;

  const PRIMARY = 2;
  const primary = showAll ? live : live.slice(0, PRIMARY);
  const moreCount = live.length - PRIMARY;

  function Row({ a }: { a: RunActionItem }) {
    const confirmation = acted[a.id];
    const ready = a.readiness === 'ready';
    return (
      <div className="flex items-start gap-3 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => act(a)}
              disabled={!!busy || !!confirmation}
              className={`${ready ? 'btn-success' : 'btn-outline'} text-sm px-3.5 py-1.5 disabled:opacity-60`}
            >
              {busy === a.id ? 'Queuing…' : confirmation ? '✓ Queued' : a.label}
            </button>
            {!ready && (
              <span className="text-[10px] uppercase tracking-wide text-amber-600 dark:text-amber-400 font-medium">
                needs setup
              </span>
            )}
          </div>
          {confirmation ? (
            <p className="mt-1.5 text-xs text-emerald-700 dark:text-emerald-300">{confirmation}</p>
          ) : (
            <>
              {a.summary && <p className="mt-1 text-xs text-ink-400 leading-snug">{a.summary}</p>}
              {!ready && a.blocker && <p className="mt-0.5 text-[11px] text-amber-600/90 dark:text-amber-400/80">{a.blocker}</p>}
            </>
          )}
        </div>
        {!confirmation && (
          <button
            type="button"
            onClick={() => dismiss(a)}
            disabled={!!busy}
            title="Not needed"
            aria-label="Dismiss this action"
            className="shrink-0 text-ink-600 hover:text-ink-300 text-sm leading-none px-1 pt-2 disabled:opacity-50"
          >
            ✕
          </button>
        )}
      </div>
    );
  }

  return (
    <section className="rounded-lg border border-ink-800 bg-ink-950/40 p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-medium text-ink-100">What&apos;s next for this run</h2>
        <span className="text-[11px] text-ink-500">{live.length} action{live.length === 1 ? '' : 's'} identified</span>
      </div>
      <div className="mt-1.5 divide-y divide-ink-800/70">
        {primary.map((a) => <Row key={a.id} a={a} />)}
      </div>
      {!showAll && moreCount > 0 && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="mt-2 text-xs text-ink-500 hover:text-ink-300"
        >
          More actions ({moreCount}) ▾
        </button>
      )}
      {err && <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{err}</p>}
    </section>
  );
}
