/**
 * <GenerationProgressCard /> — one honest statement of where a paid generation
 * stands. Server-renderable; all state logic lives in
 * lib/generation-proposal-state.ts where it is tested.
 *
 * Every lifecycle/progress state gets its own words. `unknown` explicitly says
 * "do not retry" and this surface offers no retry control for it — a disposition
 * we cannot see is not an invitation to spend again.
 */

import type { GenerationProposalViewModel } from '@/lib/generation-proposal';
import { creditsLine, deriveClipProgress, progressPresentation } from '@/lib/generation-proposal-state';
import { unavailableModeCopy, qualityModeLabel } from '@/lib/quality-mode';

const TONE_CLASSES: Record<string, string> = {
  ok: 'bg-emerald-500/15 text-state-ok',
  active: 'bg-sky-500/15 text-state-running',
  attention: 'bg-amber-500/15 text-state-needs',
  bad: 'bg-red-500/15 text-state-fail',
  muted: 'bg-ink-800 text-ink-400',
};

export default function GenerationProgressCard({ vm }: { vm: GenerationProposalViewModel }) {
  const clips = deriveClipProgress(vm);
  const presentation = progressPresentation(vm.progress, clips);

  return (
    <section aria-label="Generation progress" className="rounded-lg border border-ink-800 bg-ink-900/40 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded px-2 py-0.5 text-secondary font-medium ${TONE_CLASSES[presentation.tone]}`}>
          {presentation.label}
        </span>
        <span className="text-secondary text-ink-500">{qualityModeLabel(vm.qualityMode)} mode</span>
      </div>
      <p className="mt-2 text-reading text-ink-200">{presentation.description}</p>

      {vm.progress === 'unavailable' && vm.unavailableReason && (
        <p className="mt-2 text-secondary text-state-needs">
          {unavailableModeCopy(vm.qualityMode, vm.unavailableReason, vm.requiredMissingCapabilities)}
        </p>
      )}

      {presentation.doNotRetry && (
        <p className="mt-2 rounded border border-amber-500/30 bg-amber-500/10 p-2 text-reading text-state-needs">
          Because the outcome is unknown, no retry is offered here. A retry could
          pay for the same clips twice.
        </p>
      )}

      <p className="mt-3 text-secondary text-ink-400">{creditsLine(vm)}</p>

      {vm.authorization?.errorCode && (
        <p className="mt-1 text-secondary text-ink-500">Recorded error: {vm.authorization.errorCode}</p>
      )}
    </section>
  );
}
