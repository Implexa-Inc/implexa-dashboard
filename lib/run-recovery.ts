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
 *
 * Whether a DIFFERENT recovery already succeeded for this run (run_recovery_
 * attempts.status='recovered') is intentionally NOT this module's concern either
 * — same reasoning as the backend twin: that is a DB fact, not a pure function of
 * one row's progress trace. The run page queries it directly and gates the whole
 * affordance on it before this function is even consulted.
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
  /** Heartbeats/step notes exist but no validated deliverable does: explain, never offer "done". */
  transcriptOnly: boolean;
  deliverable: { id: string | null; role: string; relativePath: string; sha256: string } | null;
  reason: 'already_reported' | 'not_recoverable_state' | 'no_evidence' | 'transcript_only' | 'recoverable';
};

// A DELIVERABLE is a Desktop-validated artifact in a terminal role. Heartbeats
// and step notes are the agent's own narration and never qualify (2026-09-10:
// "Work recovered — review and finalize" appeared over a run that died in
// dependency installation, and "Mark as done" would have recorded transcript-
// only work as delivered). Mirrors the backend's RECOVERY_ARTIFACT_ROLES.
export const RECOVERY_ARTIFACT_ROLES = ['final_output', 'recovery_result'];
export type ValidatedArtifact = { id?: string | null; role?: string | null; status?: string | null; relative_path?: string | null; relativePath?: string | null; sha256?: string | null };

function validatedDeliverable(artifacts: ValidatedArtifact[] | null | undefined) {
  const list = Array.isArray(artifacts) ? artifacts : [];
  return list.find((a) => a && typeof a === 'object'
    && (a.status === undefined || a.status === 'validated')
    && RECOVERY_ARTIFACT_ROLES.includes(String(a.role))
    && typeof (a.relative_path ?? a.relativePath) === 'string' && String(a.relative_path ?? a.relativePath).trim()
    && /^[a-f0-9]{64}$/.test(String(a.sha256 || ''))) || null;
}

function entries(progress: Progress): ProgressEntry[] {
  if (!progress || typeof progress !== 'object') return [];
  const history = Array.isArray(progress.history) ? progress.history : [];
  const cur = progress.current && typeof progress.current === 'object' ? progress.current : null;
  if (cur && !history.some((h) => h && h.at === cur.at && h.note === cur.note)) return [...history, cur];
  return history;
}

const text = (e?: ProgressEntry) => [e?.step, e?.note].filter(Boolean).join(' ').trim();

export function deriveRecoveredWork({
  runState, outputMarkdown, progress, stepsState, validatedArtifacts = [],
}: {
  runState?: string | null;
  outputMarkdown?: string | null;
  progress?: Progress;
  stepsState?: StepState[] | null;
  /** run_artifacts rows (status='validated') or the trusted projection. */
  validatedArtifacts?: ValidatedArtifact[] | null;
}): RecoveredWork {
  const none = (reason: RecoveredWork['reason'], extra: Partial<RecoveredWork> = {}): RecoveredWork => ({
    recoverable: false, looksComplete: false, lastNote: null, stepCount: 0, transcriptOnly: false, deliverable: null, reason, ...extra,
  });

  if (outputMarkdown && String(outputMarkdown).trim()) return none('already_reported');
  if (!RECOVERABLE_STATES.includes(String(runState))) return none('not_recoverable_state');

  const list = entries(progress);
  const last = list.length ? list[list.length - 1] : null;
  const lastText = last ? text(last) : '';
  const deliverable = validatedDeliverable(validatedArtifacts);

  if (!deliverable) {
    if (!list.length) return none('no_evidence');
    // A COUNT of heartbeats is not evidence, however large.
    return none('transcript_only', { transcriptOnly: true, lastNote: lastText || null, stepCount: list.length });
  }

  const steps = Array.isArray(stepsState) ? stepsState : [];
  const allStepsDone = steps.length > 0 && steps.every((s) => s && s.status === 'done');
  const looksComplete = (!PROGRESS_MARKERS.test(lastText) && TERMINAL_MARKERS.test(lastText)) || allStepsDone;

  return {
    recoverable: true, looksComplete, lastNote: lastText || null, stepCount: list.length, transcriptOnly: false,
    deliverable: { id: deliverable.id ?? null, role: String(deliverable.role), relativePath: String(deliverable.relative_path ?? deliverable.relativePath), sha256: String(deliverable.sha256) },
    reason: 'recoverable',
  };
}
