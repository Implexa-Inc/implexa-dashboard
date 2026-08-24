/**
 * lib/terminal-evidence.ts — when a surface may still say "Queued".
 *
 * THE INCIDENT (2026-08-23). A Review Room continuation delivered: its child run
 * reached `completed` / `verified_complete`, nine artifacts and the final MP4 were
 * validated, its launch attempt recorded `succeeded`, and `run_requests.status`
 * was `done`. Three surfaces went on rendering Queued with "No deliverable
 * recorded", because each of them read one field — the request's stale
 * `lifecycle_state`, which the close had never updated — and treated it as the
 * whole answer.
 *
 * The backend fix (migration 0227) stops that row from being written again. This
 * module is the OTHER half, and it exists because the first half cannot be
 * retroactive: rows written before 0227 still hold the contradiction, a
 * reconciliation runs on its own schedule, and a projection can always lag a
 * fact by a poll interval. A presentation layer that believes the weakest signal
 * on the page will keep telling the user their finished work is queued.
 *
 * So the rule is stated once, here, and it is a rule about EVIDENCE STRENGTH:
 *
 *   1. A settled request outranks any lifecycle decoration on that same request.
 *      `status = done` is a durable transition; `lifecycle_state` is a projection
 *      OF it, and a projection may never contradict the thing it projects.
 *   2. A completed child run outranks a queued/running request projection. The
 *      run plane validates its own terminal state and its artifacts; the request
 *      plane is bookkeeping about who was asked to do the work.
 *   3. A terminal SUCCESS receipt on the launch attempt outranks both. It is the
 *      only signal written after the process really ended.
 *
 * And one thing this must never do, which is why every branch below is about
 * evidence rather than absence: it never promotes silence. Nothing here can turn
 * an unknown, a stall or a still-running attempt into success. Missing evidence
 * leaves the caller's own state exactly as it was.
 *
 * PURE, so the whole matrix is executable in a test rather than asserted by
 * reading JSX — which is how the original surfaces passed their tests while
 * showing the wrong word.
 */

/** The vocabulary every run surface already speaks (lib/run-state.ts). */
export type PresentedState = 'queued' | 'running' | 'stalled' | 'completed' | 'failed';

/** A launch attempt's terminal outcome, as migration 0177 constrains it. */
export type TerminalOutcome = 'succeeded' | 'failed' | 'superseded' | 'cancelled' | 'needs_attention';

export type TerminalEvidence = {
  /** run_requests.status — 'pending' | 'consumed' | 'done' | 'cancelled'. */
  requestStatus?: string | null;
  /** run_requests.failed_at / launch_failed_at. Either makes `done` a failure. */
  requestFailedAt?: string | null;
  requestLaunchFailedAt?: string | null;
  /**
   * skill_runs.run_state for the run that actually carries the deliverable — the
   * CHILD for a continuation, never the parent it was reviewed from. Resolving
   * that is the caller's job (see childRunEvidence below); getting it wrong is a
   * different bug and this module cannot detect it.
   */
  childRunState?: string | null;
  /** run_launch_attempts.terminal_outcome for the request's current attempt. */
  attemptTerminalOutcome?: TerminalOutcome | string | null;
  /** How many validated artifacts the child run carries. */
  validatedArtifacts?: number | null;
};

export type TerminalVerdict = {
  /** What the surface should present. */
  state: PresentedState;
  /**
   * True when this module overrode what the caller was about to show. Surfaces
   * use it to explain themselves rather than silently disagreeing with a badge
   * elsewhere on the page.
   */
  dominated: boolean;
  /** The single strongest fact that decided it, for copy and for tests. */
  reason:
    | 'request_done'
    | 'request_failed'
    | 'request_cancelled'
    | 'child_run_completed'
    | 'child_run_failed'
    | 'attempt_succeeded'
    | 'no_terminal_evidence';
};

const NON_TERMINAL: ReadonlySet<PresentedState> = new Set(['queued', 'running', 'stalled']);

/**
 * resolvePresentedState(presented, evidence)
 *
 * `presented` is what the surface derived on its own. The verdict either confirms
 * it or replaces it with something the evidence proves. A caller that already
 * shows a terminal state is left alone: this resolves contradictions in ONE
 * direction — non-terminal presentation versus terminal evidence — because that
 * is the only direction in which a stale projection can lie about finished work.
 */
export function resolvePresentedState(
  presented: PresentedState,
  evidence: TerminalEvidence | null | undefined,
): TerminalVerdict {
  const keep = (reason: TerminalVerdict['reason'] = 'no_terminal_evidence'): TerminalVerdict =>
    ({ state: presented, dominated: false, reason });
  if (!evidence) return keep();
  // A surface that is already telling the truth about a terminal state does not
  // need this. In particular a `failed` presentation is never upgraded here.
  if (!NON_TERMINAL.has(presented)) return keep();

  const failedStamp = !!(evidence.requestFailedAt || evidence.requestLaunchFailedAt);

  // Cancellation is a fact about the user's intent and outranks every result.
  if (evidence.requestStatus === 'cancelled') {
    return { state: 'failed', dominated: true, reason: 'request_cancelled' };
  }

  // A failure stamp outranks `done` for the same reason derivePhase reads it
  // first: the give-up paths write BOTH, and reading done_at first is the bug.
  if (failedStamp) {
    return { state: 'failed', dominated: true, reason: 'request_failed' };
  }

  // The child run's own terminal state. Checked before the request's, because a
  // request row can lag the run plane by a poll and the run plane is the one that
  // validated the deliverable.
  if (evidence.childRunState === 'failed' || evidence.childRunState === 'cancelled') {
    return { state: 'failed', dominated: true, reason: 'child_run_failed' };
  }
  if (evidence.childRunState === 'completed') {
    return { state: 'completed', dominated: true, reason: 'child_run_completed' };
  }

  // A LIVE CHILD OUTRANKS A SETTLED REQUEST POINTER, and this is the branch that
  // keeps this module from becoming the next incident in reverse. `parent
  // completed + child running` is a real, ordinary shape: the request row can
  // settle ahead of the run plane, and calling that "completed" would be
  // premature success — announcing a deliverable that is still being written.
  // The child is the authority on liveness, so the verdict is what IT is doing.
  if (evidence.childRunState === 'running' || evidence.childRunState === 'stalled'
      || evidence.childRunState === 'queued') {
    const live: PresentedState = evidence.childRunState === 'queued' ? 'queued' : evidence.childRunState;
    return { state: live, dominated: live !== presented, reason: 'no_terminal_evidence' };
  }

  if (evidence.requestStatus === 'done') {
    return { state: 'completed', dominated: true, reason: 'request_done' };
  }

  // A terminal SUCCESS receipt, on its own. Only 'succeeded' is admissible:
  // 'superseded' means another attempt took over (the work may still be running),
  // and 'needs_attention' is the opposite of a result.
  if (evidence.attemptTerminalOutcome === 'succeeded') {
    return { state: 'completed', dominated: true, reason: 'attempt_succeeded' };
  }

  // VALIDATED ARTIFACTS ALONE PROVE NOTHING TERMINAL. A run that is still going
  // registers artifacts as it produces them, and a half-finished deliverable is
  // the exact thing the user must not be told is done. They are carried on the
  // evidence so callers can rank and explain, never so absence-of-a-verdict can
  // be filled in from a file count.
  return keep();
}

/**
 * mayPresentQueued — the flat form of requirement 10, for a call site that only
 * needs the yes/no.
 *
 * "Queued" is a claim that nothing has happened yet. It is false the moment the
 * request is done, the child run is completed, or a terminal success receipt
 * exists — and being false, it must not be said.
 */
export function mayPresentQueued(evidence: TerminalEvidence | null | undefined): boolean {
  return resolvePresentedState('queued', evidence).state === 'queued';
}

/**
 * childRunEvidence — pick the run that actually carries a continuation's result.
 *
 * PARENT/CHILD CONFUSION IS THE OTHER HALF OF THE INCIDENT. A continuation's
 * request pointer names the run it continued FROM until the close overwrites it,
 * so a surface that reads `run_requests.run_id` can end up rendering the reviewed
 * parent — which is `completed`, has its own (older) artifacts, and looks
 * entirely plausible while being the wrong run.
 *
 * Precedence matches the backend's (migration 0227):
 *   the attempt's terminal binding → the attempt's pre-spawn child → the request
 *   pointer, and only when the request pointer is not the parent itself.
 */
export function childRunEvidence(input: {
  parentRunId?: string | null;
  requestRunId?: string | null;
  attemptRunId?: string | null;
  attemptTerminalRunId?: string | null;
}): string | null {
  const parent = input.parentRunId ? String(input.parentRunId) : null;
  const candidates = [input.attemptTerminalRunId, input.attemptRunId, input.requestRunId];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const id = String(candidate).trim();
    if (!id) continue;
    if (parent && id === parent) continue;
    return id;
  }
  return null;
}
