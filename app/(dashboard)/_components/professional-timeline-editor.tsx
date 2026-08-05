'use client';

/**
 * <ProfessionalTimelineEditor /> — the explicit multi-moment timeline.
 *
 * WHAT THIS COMPONENT IS ALLOWED TO DECIDE: nothing about money, providers, or
 * availability. It edits a plan and refuses one the deployed backend would
 * refuse, using bounds probed from that backend (lib/professional-v2-contract).
 * Every authoritative figure comes back from a preview.
 *
 * WHY THE ISSUE LIST IS EXHAUSTIVE RATHER THAN FIRST-FAILURE: a paid flow where
 * each fix reveals the next refusal, one round trip at a time, is exactly the
 * experience this editor exists to replace.
 *
 * WHY REORDER DOES NOT SILENTLY RE-SORT: moving a moment is a deliberate act. If
 * it produces an out-of-order timeline the editor SAYS so and offers an explicit
 * sort — quietly moving a moment the user just placed would be the UI editing
 * their plan for them.
 */

import type { JudgeMode } from '@/lib/professional-v2-contract';
import { durationSeconds } from '@/lib/generation-source';
import {
  BOUNDS, DEFAULT_RATIO, JUDGE_MODES_ALLOWING_REPAIR, PINNED_PROVIDER,
  maxSourcePromptChars, pinnedProviderCapability,
} from '@/lib/professional-v2-contract';
import {
  addMoment, moveMoment, removeMoment, sortMomentsByStart, updateMoment,
  validateTimeline, type TimelineIssue, type TimelineMoment,
} from '@/lib/professional-v2-timeline';

type Props = {
  moments: TimelineMoment[];
  onChange: (moments: TimelineMoment[]) => void;
  disabled: boolean;
  /**
   * The authoritative source length in integer milliseconds, read from the
   * backend and never computed here. Bounds the timestamp fields and the
   * validation shown below.
   *
   * The `max` it produces is a CONVENIENCE, not the gate: a number input's max
   * does not stop typing, pasting or autofill, and devtools ignore it entirely.
   * The gate is the backend — at compile, at create, and again at approval
   * against a fresh read. What this buys is a user who sees the problem where
   * they can fix it.
   */
  mediaDurationMs: number;
};

const numberOrNaN = (value: string): number => (value.trim() === '' ? Number.NaN : Number(value));

function issuesFor(issues: TimelineIssue[], momentId: string): TimelineIssue[] {
  return issues.filter((issue) => issue.momentId === momentId);
}

export default function ProfessionalTimelineEditor({ moments, onChange, disabled, mediaDurationMs }: Props) {
  const validation = validateTimeline(moments, mediaDurationMs);
  const timelineIssues = validation.issues.filter((issue) => issue.momentId === null);
  const outOfOrder = validation.issues.some((issue) => issue.code === 'out_of_order');
  const capability = pinnedProviderCapability();

  const set = (momentId: string, patch: Partial<TimelineMoment>) => onChange(updateMoment(moments, momentId, patch));

  return (
    <section aria-label="Professional timeline" className="rounded-lg border border-ink-800 bg-ink-950/40 p-4">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-medium text-ink-100">Timeline</h2>
          <p className="mt-0.5 text-xs text-ink-400">
            Up to {BOUNDS.maxMoments} moments, {BOUNDS.minDurationSeconds}–{BOUNDS.maxDurationSeconds} seconds each.
            One moment is one piece of finished B-roll.
          </p>
        </div>
        {/* The engine is PINNED server-side. Shown so the plan names what will run
            it; never chosen here, because a client that named a provider would be
            choosing what it is charged at. */}
        <p className="text-right text-xs text-ink-400">
          {PINNED_PROVIDER.provider} · {PINNED_PROVIDER.model}
          <span className="mt-0.5 block text-[11px] text-ink-600">
            {capability
              ? `${capability.strengths.join(', ')} · ${DEFAULT_RATIO}`
              : 'No verified rate for this engine in this build — Implexa will supply the figures.'}
          </span>
        </p>
      </header>

      <ol className="mt-4 space-y-3">
        {moments.map((moment, index) => {
          const rowIssues = issuesFor(validation.issues, moment.id);
          const promptRoom = maxSourcePromptChars(moment.variantsRequested, moment.maxRepairs);
          const repairAllowed = JUDGE_MODES_ALLOWING_REPAIR.includes(moment.judgeMode);
          return (
            <li key={moment.id} className="rounded-lg border border-ink-800 bg-ink-900/40 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-xs font-medium text-ink-200">
                  Moment {index + 1}
                  <span className="ml-2 font-mono text-[11px] text-ink-600">{moment.id}</span>
                </h3>
                <div className="flex gap-1">
                  <button
                    type="button" disabled={disabled || index === 0}
                    onClick={() => onChange(moveMoment(moments, moment.id, -1))}
                    aria-label={`Move moment ${index + 1} earlier`}
                    className="rounded border border-ink-700 px-2 py-1 text-xs text-ink-300 disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    type="button" disabled={disabled || index === moments.length - 1}
                    onClick={() => onChange(moveMoment(moments, moment.id, 1))}
                    aria-label={`Move moment ${index + 1} later`}
                    className="rounded border border-ink-700 px-2 py-1 text-xs text-ink-300 disabled:opacity-30"
                  >
                    ↓
                  </button>
                  <button
                    type="button" disabled={disabled || moments.length <= 1}
                    onClick={() => onChange(removeMoment(moments, moment.id))}
                    aria-label={`Remove moment ${index + 1}`}
                    className="rounded border border-ink-800 px-2 py-1 text-xs text-ink-400 hover:text-red-300 disabled:opacity-30"
                  >
                    Remove
                  </button>
                </div>
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="text-xs text-ink-300">
                  Start (seconds)
                  {/* step="any" so arrow keys move by a whole second while typed
                      sub-second values stay valid — same reasoning as the Quick
                      builder's timestamp fields. */}
                  <input
                    type="number" min="0" max={durationSeconds(mediaDurationMs)} step="any"
                    inputMode="decimal" disabled={disabled}
                    value={Number.isFinite(moment.startSeconds) ? String(moment.startSeconds) : ''}
                    onChange={(e) => set(moment.id, { startSeconds: numberOrNaN(e.target.value) })}
                    className="mt-1 w-full rounded-md border border-ink-700 bg-ink-900 px-2 py-1.5 text-sm text-ink-100 disabled:opacity-50"
                  />
                </label>
                <label className="text-xs text-ink-300">
                  End (seconds)
                  <input
                    type="number" min="0" max={durationSeconds(mediaDurationMs)} step="any"
                    inputMode="decimal" disabled={disabled}
                    value={Number.isFinite(moment.endSeconds) ? String(moment.endSeconds) : ''}
                    onChange={(e) => set(moment.id, { endSeconds: numberOrNaN(e.target.value) })}
                    className="mt-1 w-full rounded-md border border-ink-700 bg-ink-900 px-2 py-1.5 text-sm text-ink-100 disabled:opacity-50"
                  />
                </label>
              </div>

              <label className="mt-3 block text-xs text-ink-300">
                What should this moment show?
                <textarea
                  rows={3} disabled={disabled} value={moment.prompt}
                  onChange={(e) => set(moment.id, { prompt: e.target.value })}
                  placeholder="Example: A clean aerial route map moving from Palo Alto to Pleasanton at sunrise, no text or logos."
                  className="mt-1 w-full resize-y rounded-md border border-ink-700 bg-ink-900 px-2 py-1.5 text-sm text-ink-100 placeholder:text-ink-600 disabled:opacity-50"
                />
                {/* The room stated is the room actually left: variant and repair
                    instructions are appended before the provider sees the text. */}
                <span className="mt-1 block text-[11px] text-ink-600">
                  {moment.prompt.trim().length}/{promptRoom} — variant and repair instructions are added to this before {PINNED_PROVIDER.model} receives it.
                </span>
              </label>

              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <label className="text-xs text-ink-300">
                  Variants
                  <select
                    disabled={disabled} value={moment.variantsRequested}
                    onChange={(e) => set(moment.id, { variantsRequested: Number(e.target.value) })}
                    className="mt-1 w-full rounded-md border border-ink-700 bg-ink-900 px-2 py-1.5 text-sm text-ink-100 disabled:opacity-50"
                  >
                    {Array.from(
                      { length: BOUNDS.maxVariantsPerMoment - BOUNDS.minVariantsPerMoment + 1 },
                      (unused, i) => BOUNDS.minVariantsPerMoment + i,
                    ).map((count) => (
                      <option key={count} value={count}>{count}</option>
                    ))}
                  </select>
                  <span className="mt-1 block text-[11px] text-ink-600">
                    Alternative takes of THIS moment. They add choice, not timeline.
                  </span>
                </label>

                <label className="text-xs text-ink-300">
                  Judge
                  <select
                    disabled={disabled} value={moment.judgeMode}
                    onChange={(e) => {
                      const judgeMode = e.target.value as JudgeMode;
                      // Turning the Judge off drops the reserve in the same edit.
                      // Leaving it set would hold contingent credits nothing could
                      // ever release, and the backend refuses that plan outright.
                      const keepsRepair = JUDGE_MODES_ALLOWING_REPAIR.includes(judgeMode);
                      set(moment.id, { judgeMode, ...(keepsRepair ? {} : { maxRepairs: 0 }) });
                    }}
                    className="mt-1 w-full rounded-md border border-ink-700 bg-ink-900 px-2 py-1.5 text-sm text-ink-100 disabled:opacity-50"
                  >
                    <option value="ranked">Ranked — judge every take, keep the best</option>
                    <option value="off">Off — return every take, select nothing</option>
                  </select>
                  <span className="mt-1 block text-[11px] text-ink-600">
                    {moment.judgeMode === 'off'
                      ? 'Deterministic checks only. Nothing is selected for you.'
                      : 'Semantic evidence per take, then one selection for this moment.'}
                  </span>
                </label>

                <label className="text-xs text-ink-300">
                  Repair reserve
                  <select
                    disabled={disabled || !repairAllowed} value={moment.maxRepairs}
                    onChange={(e) => set(moment.id, { maxRepairs: Number(e.target.value) })}
                    className="mt-1 w-full rounded-md border border-ink-700 bg-ink-900 px-2 py-1.5 text-sm text-ink-100 disabled:opacity-50"
                  >
                    {Array.from({ length: BOUNDS.maxRepairsPerMoment + 1 }, (unused, i) => i).map((count) => (
                      <option key={count} value={count}>{count}</option>
                    ))}
                  </select>
                  <span className="mt-1 block text-[11px] text-ink-600">
                    {repairAllowed
                      ? 'Contingent. Priced into the ceiling; spent only on a judged failure.'
                      : 'Needs a Judge — with judging off, nothing could decide a repair is warranted.'}
                  </span>
                </label>
              </div>

              {rowIssues.length > 0 && (
                <ul className="mt-3 space-y-1" role="alert">
                  {rowIssues.map((issue) => (
                    <li key={`${issue.code}-${issue.message}`} className="text-[11px] text-amber-300">{issue.message}</li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={disabled || moments.length >= BOUNDS.maxMoments}
          onClick={() => onChange(addMoment(moments))}
          className="rounded-md border border-ink-700 px-3 py-1.5 text-xs text-ink-200 disabled:opacity-40"
        >
          Add moment
        </button>
        {outOfOrder && (
          <button
            type="button" disabled={disabled}
            onClick={() => onChange(sortMomentsByStart(moments))}
            className="rounded-md border border-amber-500/40 px-3 py-1.5 text-xs text-amber-200 disabled:opacity-40"
          >
            Sort by start time
          </button>
        )}
      </div>

      {timelineIssues.length > 0 && (
        <ul className="mt-3 space-y-1" role="alert">
          {timelineIssues.map((issue) => (
            <li key={issue.code} className="text-xs text-amber-300">{issue.message}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
