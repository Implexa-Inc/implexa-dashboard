/**
 * lib/professional-v2-timeline.ts — the Professional timeline, as a pure model.
 *
 * TWO AXES THAT MUST NEVER BE CONFLATED (the backend module says this first, and
 * the UI is where the confusion actually costs money):
 *
 *   COVERAGE — how many MOMENTS the timeline carries. Each moment is its own
 *              window, its own prompt, and its own few seconds of finished B-roll.
 *   VARIANTS — how many alternative takes are generated FOR ONE moment. Extra
 *              variants add NO timeline coverage. At most one survives into the
 *              cut; the rest are paid-for choice.
 *
 * So "4 variants" is never "4 clips" and never "more B-roll". Every summary this
 * module produces states coverage and generated takes as SEPARATE numbers, and
 * `coverageSummary` exists so no component has to phrase that itself.
 *
 * REFUSE EARLY, AND FOR THE REASON THE BACKEND WOULD. Every rule here mirrors a
 * rule the deployed compiler enforces (probed, see professional-v2-contract.ts).
 * The point is not to be the gate — the backend is the gate — it is to fail a
 * user in the editor, where the mistake is visible and fixable, instead of after
 * a round trip that returns a single opaque `professional_graph_compile_failed`.
 */

import {
  BOUNDS, DEFAULT_RATIO, JUDGE_MODES_ALLOWING_REPAIR, MOMENT_ID_PATTERN,
  PINNED_PROVIDER, SUPPORTED_RATIOS, creditsPerTask, durationSecondsFor,
  maxSourcePromptChars, toMs,
  type JudgeMode,
} from './professional-v2-contract.ts';
import { formatDurationMs, isAuthoritativeDurationMs, withinSourceDuration } from './generation-source.ts';

export type TimelineMoment = {
  id: string;
  prompt: string;
  startSeconds: number;
  endSeconds: number;
  ratio: string;
  variantsRequested: number;
  judgeMode: JudgeMode;
  /**
   * The EXPLICIT repair reserve. Contingent credits that only a judge verdict can
   * release, which is why the backend refuses a reserve under judge `off`:
   * authorized money that nothing could ever legitimately spend.
   */
  maxRepairs: number;
};

export type TimelineIssue = {
  /** The moment this is about, or null for a whole-timeline problem. */
  momentId: string | null;
  code:
    | 'no_moments' | 'too_many_moments' | 'too_many_tasks'
    | 'invalid_moment_id' | 'duplicate_moment_id'
    | 'missing_prompt' | 'prompt_too_long'
    | 'invalid_window' | 'window_too_short' | 'window_too_long' | 'window_precision'
    | 'out_of_order' | 'overlap'
    | 'moment_outside_source_duration' | 'source_duration_unknown'
    | 'invalid_variants' | 'invalid_judge_mode' | 'invalid_repairs'
    | 'repair_without_judge' | 'unsupported_ratio' | 'uncatalogued_provider';
  message: string;
};

export type TimelineCost = {
  /** Credits the requested variants will spend if nothing is repaired. */
  expectedCredits: number;
  /** Contingent credits held for repair. Released only by a judge verdict. */
  repairReserveCredits: number;
  /** expected + reserve. The number an approval actually authorizes. */
  maximumCredits: number;
  /** Paid generations that will run up front. NOT the number of B-roll moments. */
  variantTaskCount: number;
  /** Contingent repair tasks. */
  repairTaskCount: number;
  /** Everything the authorization covers. */
  totalTaskCount: number;
  /** Finished B-roll moments — the timeline coverage. One per moment, always. */
  coverageMomentCount: number;
};

export type TimelineValidation = {
  ok: boolean;
  issues: TimelineIssue[];
  /**
   * The local cost model, or null when the timeline cannot be priced (invalid, or
   * the pinned provider is not catalogued here). NEVER shown as authoritative —
   * it exists to be reconciled against the backend's compiled figures.
   */
  cost: TimelineCost | null;
};

export const MAX_MOMENT_ID_ORDINAL = 9999;

/** A fresh moment, at the smallest legal window the backend accepts. */
export function newMoment(ordinal: number, startSeconds = 0): TimelineMoment {
  return {
    id: `moment-${Math.min(Math.max(ordinal, 1), MAX_MOMENT_ID_ORDINAL)}`,
    prompt: '',
    startSeconds,
    endSeconds: startSeconds + BOUNDS.minDurationSeconds,
    ratio: DEFAULT_RATIO,
    variantsRequested: BOUNDS.minVariantsPerMoment,
    judgeMode: 'ranked',
    maxRepairs: 0,
  };
}

/** The next id that does not collide with one already on the timeline. */
export function nextMomentId(moments: readonly TimelineMoment[]): string {
  const taken = new Set(moments.map((m) => m.id));
  for (let ordinal = 1; ordinal <= MAX_MOMENT_ID_ORDINAL; ordinal += 1) {
    const candidate = `moment-${ordinal}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `moment-${MAX_MOMENT_ID_ORDINAL}`;
}

export function addMoment(moments: readonly TimelineMoment[]): TimelineMoment[] {
  const last = moments.length ? moments[moments.length - 1] : null;
  // A new moment starts where the last one ended: ABUTTING, which the backend
  // accepts. Starting it at 0 would create an overlap the user did not ask for.
  const start = last ? last.endSeconds : 0;
  return [...moments, { ...newMoment(1, start), id: nextMomentId(moments) }];
}

export function removeMoment(moments: readonly TimelineMoment[], momentId: string): TimelineMoment[] {
  return moments.filter((m) => m.id !== momentId);
}

/**
 * Move a moment one place. Reordering is a real editing action and it CAN produce
 * an out-of-order timeline — the backend reads the array in order and refuses a
 * moment that starts before its predecessor ends. That refusal is surfaced as a
 * validation issue rather than prevented by silently re-sorting, because silently
 * re-sorting would move a moment the user just deliberately placed.
 */
export function moveMoment(
  moments: readonly TimelineMoment[], momentId: string, direction: -1 | 1,
): TimelineMoment[] {
  const index = moments.findIndex((m) => m.id === momentId);
  if (index < 0) return [...moments];
  const target = index + direction;
  if (target < 0 || target >= moments.length) return [...moments];
  const next = [...moments];
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved);
  return next;
}

/** The explicit fix for an out-of-order timeline. Offered, never applied silently. */
export function sortMomentsByStart(moments: readonly TimelineMoment[]): TimelineMoment[] {
  return [...moments].sort((a, b) => a.startSeconds - b.startSeconds);
}

export function updateMoment(
  moments: readonly TimelineMoment[], momentId: string, patch: Partial<TimelineMoment>,
): TimelineMoment[] {
  return moments.map((m) => (m.id === momentId ? { ...m, ...patch } : m));
}

/**
 * Millisecond precision, tested EXACTLY as the backend tests it
 * (`Number.isInteger(seconds * 1000)`), float behaviour included. A "nicer"
 * epsilon-tolerant check here would accept a timestamp the compiler then
 * refuses — the point of mirroring is to reach the same verdict, not a kinder one.
 */
const isMs = (seconds: number): boolean =>
  Number.isFinite(seconds) && Number.isInteger(seconds * 1000);

/**
 * Validate the whole timeline against the deployed bounds.
 *
 * Collects EVERY issue rather than stopping at the first: a user fixing one
 * moment at a time, discovering a new refusal after each round trip, is the
 * experience this editor exists to replace.
 */
/**
 * `mediaDurationMs` is the AUTHORITATIVE source length, read from the backend —
 * never computed here, never guessed from a file size or a `<video>` element.
 *
 * It is optional so that pure cost/shape validation still works where no source
 * is in play (the fixture regenerator, the cost reconciler). Where a source IS
 * in play, passing `null` produces `source_duration_unknown` on every moment
 * rather than silently accepting them: an unknown duration is never unlimited,
 * on this side either.
 */
export function validateTimeline(
  moments: readonly TimelineMoment[],
  mediaDurationMs: number | null | undefined = undefined,
): TimelineValidation {
  const issues: TimelineIssue[] = [];
  // `undefined` means "this call is not about a source at all" — a distinct
  // thing from `null`, which means "there is a source and we do not know how
  // long it is". Conflating them would either break the shape-only callers or
  // let an unverified source through.
  const boundToSource = mediaDurationMs !== undefined;
  const push = (momentId: string | null, code: TimelineIssue['code'], message: string) =>
    issues.push({ momentId, code, message });

  if (moments.length === 0) {
    push(null, 'no_moments', 'Add at least one B-roll moment.');
  }
  if (moments.length > BOUNDS.maxMoments) {
    push(null, 'too_many_moments', `A Professional timeline carries at most ${BOUNDS.maxMoments} moments.`);
  }

  const seen = new Set<string>();
  let variantTaskCount = 0;
  let repairTaskCount = 0;
  let expectedCredits = 0;
  let repairReserveCredits = 0;
  let priceable = moments.length > 0;

  for (let index = 0; index < moments.length; index += 1) {
    const moment = moments[index];
    const label = `Moment ${index + 1}`;

    if (!MOMENT_ID_PATTERN.test(moment.id)) {
      push(moment.id, 'invalid_moment_id', `${label} has an id the backend will refuse.`);
    }
    if (seen.has(moment.id)) {
      push(moment.id, 'duplicate_moment_id', `${label} repeats the id "${moment.id}".`);
    }
    seen.add(moment.id);

    const prompt = moment.prompt.trim();
    const promptRoom = maxSourcePromptChars(moment.variantsRequested, moment.maxRepairs);
    if (prompt.length === 0) {
      push(moment.id, 'missing_prompt', `${label} needs a shot description.`);
    } else if (prompt.length > promptRoom) {
      // The provider's ceiling applies to the string it actually receives, which
      // is longer than what was typed. Say the real room, not the raw cap.
      push(moment.id, 'prompt_too_long',
        `${label}: shorten the description to ${promptRoom} characters — variant and repair instructions are appended to it before ${PINNED_PROVIDER.model} receives it.`);
    }

    if (!SUPPORTED_RATIOS.includes(moment.ratio)) {
      push(moment.id, 'unsupported_ratio', `${label} uses an aspect ratio this build does not support.`);
    }

    const windowValid = Number.isFinite(moment.startSeconds) && Number.isFinite(moment.endSeconds)
      && moment.startSeconds >= 0 && moment.endSeconds > moment.startSeconds;
    if (!windowValid) {
      push(moment.id, 'invalid_window', `${label} needs an end time after its start time.`);
    } else if (!isMs(moment.startSeconds) || !isMs(moment.endSeconds)) {
      push(moment.id, 'window_precision', `${label} must be timed to the millisecond or coarser.`);
    } else {
      const durationSeconds = moment.endSeconds - moment.startSeconds;
      if (durationSeconds < BOUNDS.minDurationSeconds) {
        push(moment.id, 'window_too_short', `${label} is shorter than ${BOUNDS.minDurationSeconds} seconds.`);
      }
      if (durationSeconds > BOUNDS.maxDurationSeconds) {
        push(moment.id, 'window_too_long', `${label} is longer than ${BOUNDS.maxDurationSeconds} seconds.`);
      }
      // ── THE SOURCE-DURATION CEILING ────────────────────────────────────
      // Compared in integer MILLISECONDS, exactly as the backend compares it:
      // `end <= duration` is valid and `end === duration + 1` is not, and two
      // floats differing in the last bit must not decide which side of that a
      // user is on.
      if (boundToSource) {
        if (!isAuthoritativeDurationMs(mediaDurationMs)) {
          push(moment.id, 'source_duration_unknown',
            `${label} cannot be checked: Implexa does not know how long the source video is yet. Open Implexa Desktop to verify it.`);
        } else if (!withinSourceDuration(toMs(moment.startSeconds), toMs(moment.endSeconds), mediaDurationMs)) {
          push(moment.id, 'moment_outside_source_duration',
            `${label} runs past the end of the source video (${formatDurationMs(mediaDurationMs)}). A clip generated for it would have nowhere to go.`);
        }
      }
    }

    if (!Number.isSafeInteger(moment.variantsRequested)
      || moment.variantsRequested < BOUNDS.minVariantsPerMoment
      || moment.variantsRequested > BOUNDS.maxVariantsPerMoment) {
      push(moment.id, 'invalid_variants',
        `${label}: Professional generates ${BOUNDS.minVariantsPerMoment}–${BOUNDS.maxVariantsPerMoment} variants per moment.`);
    }

    if (moment.judgeMode !== 'off' && moment.judgeMode !== 'ranked') {
      push(moment.id, 'invalid_judge_mode', `${label} has an unsupported Judge mode.`);
    }

    if (!Number.isSafeInteger(moment.maxRepairs)
      || moment.maxRepairs < 0 || moment.maxRepairs > BOUNDS.maxRepairsPerMoment) {
      push(moment.id, 'invalid_repairs',
        `${label}: the repair reserve is 0–${BOUNDS.maxRepairsPerMoment} per moment.`);
    } else if (moment.maxRepairs > 0 && !JUDGE_MODES_ALLOWING_REPAIR.includes(moment.judgeMode)) {
      // Contingent credits nothing could release are money authorized for work
      // nothing can legitimately spend.
      push(moment.id, 'repair_without_judge',
        `${label}: a repair reserve needs a Judge. With judging off, nothing can decide a repair is warranted, so those credits could never be released.`);
    }

    // ORDERING AND OVERLAP, read in array order exactly as the backend reads it.
    const previous = index === 0 ? null : moments[index - 1];
    if (previous && Number.isFinite(previous.endSeconds) && Number.isFinite(moment.startSeconds)) {
      if (moment.startSeconds < previous.startSeconds) {
        push(moment.id, 'out_of_order', `${label} starts before the moment above it. Moments must run in time order.`);
      } else if (moment.startSeconds < previous.endSeconds) {
        // Abutting is fine — one ends exactly where the next begins.
        push(moment.id, 'overlap', `${label} overlaps the moment above it. Moments may touch, but they may not cover the same instant.`);
      }
    }

    // COST, only for a moment that is actually well-formed. Pricing an invalid
    // window would produce a confident number for a plan that cannot be compiled.
    if (windowValid && isMs(moment.startSeconds) && isMs(moment.endSeconds)) {
      const durationSeconds = durationSecondsFor(toMs(moment.startSeconds), toMs(moment.endSeconds));
      const perTask = creditsPerTask(durationSeconds, moment.ratio);
      if (perTask === null) {
        priceable = false;
      } else {
        const variants = Number.isSafeInteger(moment.variantsRequested) ? Math.max(moment.variantsRequested, 0) : 0;
        const repairs = Number.isSafeInteger(moment.maxRepairs) ? Math.max(moment.maxRepairs, 0) : 0;
        variantTaskCount += variants;
        repairTaskCount += repairs;
        expectedCredits += perTask * variants;
        repairReserveCredits += perTask * repairs;
      }
    } else {
      priceable = false;
    }
  }

  const totalTaskCount = variantTaskCount + repairTaskCount;
  if (priceable && totalTaskCount > BOUNDS.maxTotalTasks) {
    push(null, 'too_many_tasks',
      `This plan authorizes ${totalTaskCount} generations; the backend caps one approval at ${BOUNDS.maxTotalTasks}. Reduce variants, repair reserves, or moments.`);
  }

  const cost: TimelineCost | null = priceable
    ? {
      expectedCredits,
      repairReserveCredits,
      maximumCredits: expectedCredits + repairReserveCredits,
      variantTaskCount,
      repairTaskCount,
      totalTaskCount,
      coverageMomentCount: moments.length,
    }
    : null;

  return { ok: issues.length === 0, issues, cost };
}

/**
 * The request body's `moments` array, in the EXACT shape the deployed v2 request
 * path normalizes. Returns null when the timeline is invalid — a refused plan
 * must never be serialized, because serializing it is what sends it.
 *
 * Deliberately absent: provider, model, pricing version, credits. The backend
 * PINS the provider identity and derives every price; a client that named either
 * would be choosing what it is charged at.
 */
export function toRequestMoments(
  moments: readonly TimelineMoment[],
  mediaDurationMs: number | null | undefined = undefined,
): Array<{
  id: string; prompt: string; start_seconds: number; end_seconds: number; ratio: string;
  variants_requested: number; judge_mode: JudgeMode; max_repairs: number;
}> | null {
  // Serializing IS sending. A timeline that fails against the source it is
  // bound to must never be serialized, or the refusal would arrive from the
  // backend after the user had every reason to believe it was accepted.
  if (!validateTimeline(moments, mediaDurationMs).ok) return null;
  return moments.map((moment) => ({
    id: moment.id,
    prompt: moment.prompt.trim(),
    start_seconds: moment.startSeconds,
    end_seconds: moment.endSeconds,
    ratio: moment.ratio,
    variants_requested: moment.variantsRequested,
    judge_mode: moment.judgeMode,
    max_repairs: moment.maxRepairs,
  }));
}

/**
 * A stable fingerprint of the submitted plan.
 *
 * This is the thing an edit must invalidate. It covers ORDER and every field
 * that changes what is generated or what it costs, so a proposal previewed for
 * one timeline can never be approved after the timeline underneath it moved.
 * Not a security digest — the backend's own proposal digest is that. This is the
 * browser's own "is what I am about to approve still what I previewed".
 */
export function timelineFingerprint(moments: readonly TimelineMoment[]): string {
  return JSON.stringify(moments.map((moment) => [
    moment.id, moment.prompt.trim(), moment.startSeconds, moment.endSeconds,
    moment.ratio, moment.variantsRequested, moment.judgeMode, moment.maxRepairs,
  ]));
}

/**
 * The sentence that keeps variants from reading as coverage. Both numbers, always,
 * and never a single "N clips" figure that could mean either.
 */
export function coverageSummary(cost: TimelineCost): string {
  const moments = `${cost.coverageMomentCount} B-roll moment${cost.coverageMomentCount === 1 ? '' : 's'}`;
  const takes = `${cost.variantTaskCount} generated take${cost.variantTaskCount === 1 ? '' : 's'}`;
  return `${moments} of finished timeline — from ${takes}. Extra takes are alternatives for the same moments; they do not add coverage.`;
}

/**
 * Does the backend's compiled answer agree with what this module computed?
 *
 * FAIL CLOSED. A disagreement is not "prefer the backend and carry on" — it means
 * the plan that was priced is not the plan that was sent, and the only safe
 * outcome is to refuse the approval and re-preview. The backend's numbers are
 * authoritative for what is DISPLAYED; this check decides whether anything may be
 * approved at all.
 */
export function reconcileWithBackend(
  local: TimelineCost | null,
  backend: {
    maximumCredits: number; initialCredits: number; repairReserveCredits: number;
    taskCount: number; momentCount: number;
  },
): { ok: true } | { ok: false; reason: string } {
  if (!local) return { ok: false, reason: 'The plan could not be priced locally, so its cost cannot be confirmed.' };
  if (local.coverageMomentCount !== backend.momentCount) {
    return { ok: false, reason: `The backend compiled ${backend.momentCount} moments; this timeline has ${local.coverageMomentCount}.` };
  }
  if (local.totalTaskCount !== backend.taskCount) {
    return { ok: false, reason: `The backend authorized ${backend.taskCount} generations; this timeline asked for ${local.totalTaskCount}.` };
  }
  if (local.expectedCredits !== backend.initialCredits
    || local.repairReserveCredits !== backend.repairReserveCredits
    || local.maximumCredits !== backend.maximumCredits) {
    return { ok: false, reason: `The backend's ceiling (${backend.maximumCredits} credits) does not match this plan (${local.maximumCredits}).` };
  }
  return { ok: true };
}
