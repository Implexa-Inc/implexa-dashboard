/**
 * MIRROR of implexa-backend/src/lib/run-recovery.js.
 *
 * The dashboard needs this to decide whether to RENDER the salvage affordance;
 * the backend needs it to decide whether to HONOUR the resulting request. Two
 * runtimes, so two copies — but the rule has one home in spirit, and
 * `run-recovery-parity.test.ts` fails if the two drift on the parts that matter
 * (eligible states and the marker vocabulary).
 *
 * The server is ALWAYS the authority. This copy may only be optimistic-or-equal:
 * rendering a button the server then refuses is a recoverable annoyance;
 * withholding a button the server would have honoured strands the user, which is
 * the exact dead end this feature exists to remove.
 */

// Keep in sync with the backend's _TERMINAL_MARKERS.
const TERMINAL_MARKERS = /\b(verified|complete[d]?|finished|done|delivered|success(?:ful)?|passed|rendered|uploaded|published)\b/i;
// Keep in sync with the backend's _PROGRESS_MARKERS. These WIN over terminal
// markers — "encode ~55% done" contains 'done' but is plainly mid-flight.
const PROGRESS_MARKERS = /(\b\d{1,3}\s*%|\bremaining\b|\bin progress\b|\brunning\b|\betas?\b|~\s*\d+\s*min|\bstep \d+\/\d+:\s*(?:encode|render|upload)\w*\s+(?:running|started))/i;

// Keep in sync with the backend. 'running' is deliberately absent: a live agent
// may still report properly, and offering to finalize it invites the user to
// race their own run.
export const RECOVERABLE_STATES = ['stalled', 'failed'];

export type ProgressEntry = { at?: string; note?: string; step?: string };
export type Progress = { current?: ProgressEntry; history?: ProgressEntry[] } | null | undefined;
export type StepState = { status?: string } | null;

export type RecoveredWork = {
  recoverable: boolean;
  looksComplete: boolean;
  lastNote: string | null;
  stepCount: number;
};

function entries(progress: Progress): ProgressEntry[] {
  if (!progress || typeof progress !== 'object') return [];
  const history = Array.isArray(progress.history) ? progress.history : [];
  const cur = progress.current && typeof progress.current === 'object' ? progress.current : null;
  if (cur && !history.some((h) => h && h.at === cur.at && h.note === cur.note)) return [...history, cur];
  return history;
}

const text = (e?: ProgressEntry) => [e?.step, e?.note].filter(Boolean).join(' ').trim();

export function deriveRecoveredWork({
  runState, outputMarkdown, progress, stepsState,
}: {
  runState?: string | null;
  outputMarkdown?: string | null;
  progress?: Progress;
  stepsState?: StepState[] | null;
}): RecoveredWork {
  const none = { recoverable: false, looksComplete: false, lastNote: null, stepCount: 0 };

  if (outputMarkdown && String(outputMarkdown).trim()) return none;
  if (!RECOVERABLE_STATES.includes(String(runState))) return none;

  const list = entries(progress);
  if (!list.length) return none;

  const lastText = text(list[list.length - 1]);
  const steps = Array.isArray(stepsState) ? stepsState : [];
  const allStepsDone = steps.length > 0 && steps.every((s) => s && s.status === 'done');
  const looksComplete = (!PROGRESS_MARKERS.test(lastText) && TERMINAL_MARKERS.test(lastText)) || allStepsDone;

  return { recoverable: true, looksComplete, lastNote: lastText || null, stepCount: list.length };
}
