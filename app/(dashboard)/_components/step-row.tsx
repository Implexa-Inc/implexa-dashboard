'use client';

/**
 * <StepRow /> — one row in an agent's step chain. A bound step (a reusable skill,
 * the user's own skill, or a sub-agent in a chain) is CLICKABLE and opens a modal
 * with its details, instead of linking out to the marketing site in a browser
 * (which broke the in-app experience). A sub-agent step also offers "Open agent"
 * which navigates IN-APP, never to an external tab.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { WorkflowStep } from '@/lib/workflow-catalog';
import { createClient } from '@/lib/supabase/client';
import { callBackend } from '@/lib/api';
import Modal from './modal';

export default function StepRow({ step, showBuildEvidence = false }: { step: WorkflowStep; showBuildEvidence?: boolean }) {
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState<string | null>(null);
  const [loadingContent, setLoadingContent] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  // Lazy-load the FULL skill/agent content when the modal opens (once), so the
  // user sees the whole thing instead of the truncated preview. Fail-soft: on
  // any miss we keep showing the description + preview we already have.
  useEffect(() => {
    if (!open || content !== null || loadingContent || !step.ref) return;
    let cancelled = false;
    setLoadingContent(true);
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const q = `source=${encodeURIComponent(step.ref!.source)}&slug=${encodeURIComponent(step.ref!.slug)}`;
        const res = await callBackend(`/api/v2/me/skill-content?${q}`, { jwt: session?.access_token });
        if (!cancelled && res?.ok && typeof res.content === 'string') setContent(res.content);
      } catch { /* keep the preview fallback */ }
      finally { if (!cancelled) setLoadingContent(false); }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const bound = step.ref && !step.gap;
  const isAgent = step.kind === 'workflow';
  const isOrg = bound && step.ref && step.ref.source === 'org';
  const name = step.ref_summary?.name || (step.ref ? step.ref.slug : '');
  const noun = isAgent ? 'agent' : 'skill';

  return (
    <li className="flex gap-3 py-3">
      <div className="flex-none mt-0.5">
        <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-semibold tabular-nums ${
          bound ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-ink-800 text-ink-400'
        }`}>
          {step.order}
        </span>
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          {step.kind !== 'skill' && (
            <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-ink-700 text-ink-400">{step.kind}</span>
          )}
          {step.gap && (
            <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-amber-500/40 text-amber-700 dark:text-amber-300">gap</span>
          )}
        </div>
        <p className="text-sm text-ink-100">{step.label}</p>
        {step.detail ? (
          <p className="mt-1 text-xs text-ink-400 leading-relaxed">{step.detail}</p>
        ) : bound && step.ref_summary?.description ? (
          <p className="mt-1 text-xs text-ink-400 leading-relaxed">{step.ref_summary.description}</p>
        ) : null}
        {bound && step.same_as_step ? (
          <p className="mt-1 text-xs text-ink-500">
            ↳ same {noun} as step {step.same_as_step}{step.ref_summary?.name ? ` (${step.ref_summary.name})` : ''}
          </p>
        ) : null}
        {bound && !step.same_as_step && step.ref_summary?.preview ? (
          <p className="mt-1.5 text-xs text-ink-500 leading-relaxed border-l border-ink-700 pl-3">{step.ref_summary.preview}</p>
        ) : null}
        {showBuildEvidence && bound && step.build_evidence && Number(step.build_evidence.provenRuns || 0) > 0 ? (
          <p className="mt-1 text-xs text-emerald-600 dark:text-emerald-400">
            Proven by {step.build_evidence.provenRuns} delivered run{step.build_evidence.provenRuns === 1 ? '' : 's'}
            {Number(step.build_evidence.verifiedRuns || 0) > 0 ? ` · ${step.build_evidence.verifiedRuns} verified` : ''}
          </p>
        ) : showBuildEvidence && bound ? (
          <p className="mt-1 text-xs text-ink-500">No proven run history yet</p>
        ) : null}

        {/* Bound step → clickable, opens a modal (no navigation, no browser). */}
        {bound && step.ref ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="mt-1.5 inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 hover:underline"
          >
            {isAgent ? `View agent: ${name}` : isOrg ? `Your skill: ${name}` : `View skill: ${name}`}
            <span aria-hidden="true">→</span>
          </button>
        ) : step.kind === 'decision' ? (
          <span className="mt-1 block text-xs text-ink-500">decision step</span>
        ) : (
          <span className="mt-1 block text-xs text-ink-500">your model fills this step</span>
        )}

        {step.fallbacks.length > 0 ? (
          <ul className="mt-1.5 space-y-0.5">
            {step.fallbacks.map((fb) => (
              <li key={fb} className="text-xs text-ink-500">
                <span className="text-ink-600">no integration? </span>{fb}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {bound && step.ref && (
        <Modal
          open={open}
          onClose={() => setOpen(false)}
          title={name}
          subtitle={isAgent ? 'Sub-agent in this chain' : isOrg ? 'Your captured skill' : 'Reusable skill'}
          maxWidth="max-w-lg"
        >
          {step.ref_summary?.description && (
            <p className="text-sm text-ink-200 leading-relaxed">{step.ref_summary.description}</p>
          )}
          {/* Full SKILL.md content (lazy-loaded). Falls back to the preview. */}
          {content ? (
            <pre className="mt-3 max-h-[50vh] overflow-auto rounded-lg border border-ink-800 bg-ink-950/60 p-3 text-xs text-ink-300 leading-relaxed whitespace-pre-wrap font-mono">
              {content}
            </pre>
          ) : loadingContent ? (
            <div className="mt-3 flex items-center gap-2 text-xs text-ink-500">
              <span className="inline-block w-3.5 h-3.5 border-2 border-ink-600 border-t-brand-500 rounded-full animate-spin" aria-hidden="true" />
              Loading the full {noun}…
            </div>
          ) : step.ref_summary?.preview ? (
            <p className="mt-3 text-xs text-ink-400 leading-relaxed border-l border-ink-700 pl-3 whitespace-pre-wrap">
              {step.ref_summary.preview}
            </p>
          ) : (
            <p className="mt-3 text-sm text-ink-400">This {noun} runs as step {step.order} of the chain.</p>
          )}
          {/* Open the full thing IN-APP (never an external browser tab). */}
          {isAgent && (
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => router.push(`/workflows/${encodeURIComponent(step.ref!.slug)}?source=${encodeURIComponent(step.ref!.source)}`)}
                className="btn-success text-sm px-4 py-2"
              >
                Open this agent →
              </button>
            </div>
          )}
        </Modal>
      )}
    </li>
  );
}
