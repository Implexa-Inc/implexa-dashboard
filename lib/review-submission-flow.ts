/**
 * lib/review-submission-flow.ts — the one action Review Room owns end to end.
 *
 * THE FAILURE THIS REPLACES. "Approve Next Action" did not apply the reviewer's
 * feedback. It navigated to a separate run approval gate where the reviewer then had
 * to infer that *Request changes* — not *Continue* — was the choice that carried their
 * 14 issues. The continuation created by the other branch had no structured review at
 * all and went looking for it through Computer Use. Two screens, two vocabularies, and
 * the failure mode was silent.
 *
 * So the decision lives where the evidence lives. When drafts exist the room offers
 * exactly one primary action and one way out, and nothing else — no second approval
 * page, no "Continue work", and no unrelated recommendation such as Generate B-roll,
 * which answers a question the reviewer did not ask.
 *
 * PURE ON PURPOSE, like the rest of lib/review-*: the state machine and the copy are
 * the contract, and asserting them by reading JSX is how the first version passed its
 * tests while shipping the bug.
 *
 * ── SCOPE AT THIS COMMIT ────────────────────────────────────────────────────────
 * The submission CALL is deliberately not wired here and this module performs no I/O.
 * Backend #160 owns the revision-note field name, its bounds, its trimming and the
 * canonical digest that covers it; inventing any of those client-side would ship a
 * textarea whose contents are silently dropped, which is the same class of lie the
 * epic exists to end. `noteEnabled` is therefore false until that PR is pinned, and
 * `phaseFor`/`reviewSubmissionView` model the complete contract so wiring it is a
 * change of caller, not a change of rules.
 */

export type SubmissionPhase = 'draft' | 'preparing' | 'submitting' | 'revision_queued' | 'error';

/**
 * What `preparing` froze.
 *
 * A CLIENT-SIDE DISPLAY FREEZE, AND NOTHING MORE. It records what the room believed
 * it was sending at the instant of the click, so the in-flight and queued copy cannot
 * drift as drafts change underneath. It is NOT a contract with the server: the submit
 * endpoint takes only a session id and snapshots server-side, so there is no way to
 * send these ids or to have them verified. Claiming otherwise would be a promise the
 * wire cannot keep — binding a client snapshot needs Backend #160.
 *
 * Two things follow, and both are enforced below:
 *   the transition into flight is ONE action, so no user edit can land between the
 *   freeze and the send; and
 *   the count the queued state reports comes from the BACKEND, not from here.
 */
export type SubmissionSnapshot = {
  readonly issueIds: readonly string[];
  readonly issueCount: number;
};

export type SubmissionState = {
  phase: SubmissionPhase;
  /** Frozen on the click, retained through failure so a retry reports the same set. */
  snapshot: SubmissionSnapshot | null;
  /** Set ONLY from a durable backend response. */
  continuationId: string | null;
  /**
   * How many issues the BACKEND says it submitted. Outranks the local snapshot
   * everywhere it exists — the server's snapshot is the real one.
   */
  submittedCount: number | null;
  error: string | null;
};

export const INITIAL_SUBMISSION_STATE: SubmissionState = {
  phase: 'draft', snapshot: null, continuationId: null, submittedCount: null, error: null,
};

/**
 * A provisional UI bound so the composer cannot grow without limit. It is NOT the wire
 * bound: Backend #160 defines the authoritative maximum and trimming rule, and this
 * must be reconciled with it when the contract is pinned.
 */
export const NOTE_MAX_PROVISIONAL = 4000;

/** Freeze the visible snapshot. The only entry into the send path. */
export function beginPreparing(state: SubmissionState, draftIssueIds: string[]): SubmissionState {
  // Re-entry is refused rather than re-frozen: a second click in flight would
  // otherwise replace the snapshot the reviewer is looking at.
  if (state.phase !== 'draft' && state.phase !== 'error') return state;
  const ids = Object.freeze([...draftIssueIds]);
  if (!ids.length) return state;
  return {
    phase: 'preparing',
    snapshot: Object.freeze({ issueIds: ids, issueCount: ids.length }),
    continuationId: null,
    submittedCount: null,
    error: null,
  };
}

/**
 * The frozen set is now in flight.
 *
 * `preparing` is a transition, NOT a screen. It is entered and left inside one click
 * handler, so nothing the reviewer can do lands between the freeze and the send. The
 * earlier two-click shape promised "Send N changes & start revision" on a click that
 * sent nothing, and left a window in which editing a draft made the promised count
 * differ from what the server actually snapshotted.
 */
export function beginSubmitting(state: SubmissionState): SubmissionState {
  if (state.phase !== 'preparing') return state;
  return { ...state, phase: 'submitting', error: null };
}

/**
 * A DURABLE backend response, and the only thing that may say the issues were sent.
 *
 * A continuation id is required: without one there is nothing for the queued state to
 * link to, and reporting success anyway is precisely the local-only success the epic
 * forbids. This must be called from the response itself — waiting for a refreshed
 * session prop to arrive is how a completed submission sits on "Sending…" forever.
 *
 * `issueCount` is the server's own count of what it snapshotted. Where it is supplied
 * it REPLACES the local freeze in everything the room says.
 */
export function settleQueued(
  state: SubmissionState,
  args: { continuationId: string; issueCount?: number | null },
): SubmissionState {
  if (state.phase !== 'submitting' && state.phase !== 'preparing') return state;
  const id = String(args?.continuationId || '').trim();
  if (!id) return failSubmission(state, 'The revision was not confirmed. Nothing was sent.');
  const n = args?.issueCount;
  const submittedCount = typeof n === 'number' && Number.isInteger(n) && n >= 0 ? n : null;
  return { ...state, phase: 'revision_queued', continuationId: id, submittedCount, error: null };
}

/**
 * Any failure — a refusal, an unreadable response, or a request that never completed
 * at all. Drafts and the note are owned by the caller and deliberately untouched here:
 * this returns a retryable state, never a cleared one.
 */
export function failSubmission(state: SubmissionState, message: string): SubmissionState {
  return {
    ...state,
    phase: 'error',
    continuationId: null,
    submittedCount: null,
    error: String(message || '').trim() || 'That did not go through. Nothing was sent.',
  };
}

/**
 * "Keep reviewing" — the explicit alternative to sending.
 *
 * Never touches drafts or the note; it only clears a failed attempt so the room stops
 * reporting an outcome the reviewer has moved on from. A submission already in flight
 * is NOT cancellable from here: the request is out, and pretending otherwise would
 * leave the room saying "draft" while a continuation is being created.
 */
export function keepReviewing(state: SubmissionState): SubmissionState {
  if (state.phase !== 'error') return state;
  return { ...INITIAL_SUBMISSION_STATE };
}

/**
 * The state to render, given the DURABLE session row and whatever this tab did.
 *
 * The row wins. A reload and a back-navigation carry no local state at all, and both
 * must still show the queued revision instead of re-offering the send button — the
 * session row is the record, this component's memory is not. That is also what closes
 * the duplicate-submission window from the other direction: a second tab reads
 * `submitted` and never offers to send again.
 *
 * `state === 'submitted'` is trusted as the mark because the backend sets it only
 * after the continuation exists durably. The count is rebuilt from `submittedIssueIds`
 * rather than from live drafts, which are empty after a submission — reading them
 * would report "0 changes were sent".
 */
export function phaseForSession(input: {
  sessionState: string | null | undefined;
  submittedRequestId: string | null | undefined;
  submittedIssueIds: string[] | null | undefined;
  local: SubmissionState;
}): SubmissionState {
  const { sessionState, submittedRequestId, submittedIssueIds, local } = input;

  if (sessionState === 'submitted') {
    const ids = Array.isArray(submittedIssueIds) ? submittedIssueIds.map(String).filter(Boolean) : [];
    const snapshot: SubmissionSnapshot | null = ids.length
      ? Object.freeze({ issueIds: Object.freeze([...ids]), issueCount: ids.length })
      : local.snapshot;
    return {
      phase: 'revision_queued',
      snapshot,
      // May be absent on an older row. The queued copy still states the count; only
      // the link is withheld, because a link that names no continuation is a lie.
      continuationId: String(submittedRequestId || '').trim() || null,
      // The durable ids ARE the server's count. Falls back to whatever this tab
      // already learned from its own response.
      submittedCount: ids.length || local.submittedCount,
      error: null,
    };
  }

  // A local response that already settled outranks a row this tab has not re-read.
  // Without this, a completed submission is dragged back to "Sending…" by a stale
  // `draft` prop and sits there — the exact stall this flow exists to prevent.
  if (local.phase === 'revision_queued') return local;

  if (sessionState === 'submitting') {
    return {
      phase: 'submitting', snapshot: local.snapshot,
      continuationId: null, submittedCount: null, error: null,
    };
  }

  return local;
}

/**
 * What one submit attempt learned. A failure carries no identity by construction, so
 * there is no shape in which "it worked" and "there is no continuation" coexist.
 */
export type SubmitOutcome =
  | { ok: true; requestId: string; issueCount?: number | null }
  | { ok: false };

/**
 * THE WHOLE CLICK, as one function — freeze, send, settle or fail.
 *
 * Extracted from the component on purpose. Every way this can go wrong is a way the
 * room gets stuck on "Sending…" forever, and none of them are reachable from a test
 * that reads JSX or asserts on a source string:
 *
 *   the request RESOLVES with a refusal            -> error, drafts kept
 *   the request RESOLVES ok but names no revision  -> error, drafts kept
 *   the request REJECTS (offline, abort, navigate) -> error, drafts kept
 *   the request RESOLVES with a continuation       -> queued, from THAT response
 *
 * The last one is the one that matters most: the queued state is taken from the reply
 * that created the continuation, never waited for from a refreshed prop.
 *
 * `onState` is called at most twice — once entering flight, once on the outcome — so
 * a caller can drive React state without this function knowing about React.
 */
export async function submitRevision(args: {
  state: SubmissionState;
  draftIssueIds: string[];
  submit: () => Promise<SubmitOutcome>;
  onState: (next: SubmissionState) => void;
}): Promise<SubmissionState> {
  const { state, draftIssueIds, submit, onState } = args;

  // Re-entry and "nothing to send" both stop here, before anything is transmitted.
  // This is what makes a double click harmless without a separate guard.
  const prepared = beginPreparing(state, draftIssueIds);
  if (prepared.phase !== 'preparing') return state;

  const sending = beginSubmitting(prepared);
  onState(sending);

  let outcome: SubmitOutcome;
  try {
    outcome = await submit();
  } catch {
    // The request never completed. Without this the rejection escapes the click
    // handler entirely and `sending` is the last state the room ever sees.
    outcome = { ok: false };
  }

  const next = outcome.ok
    // settleQueued re-checks the continuation, so an `ok` with an empty id still
    // lands in error rather than claiming a revision that does not exist.
    ? settleQueued(sending, { continuationId: outcome.requestId, issueCount: outcome.issueCount ?? null })
    : failSubmission(sending, '');
  onState(next);
  return next;
}

export type SubmissionView = {
  /** Which question the block is asking. */
  mode: 'send_changes' | 'accept_result' | 'in_flight' | 'queued';
  primaryLabel: string;
  primaryEnabled: boolean;
  secondaryLabel: string | null;
  secondaryEnabled: boolean;
  /** The composer is offered only where a revision is actually being described. */
  showNote: boolean;
  noteEnabled: boolean;
  noteHint: string | null;
  /** The frozen count, once frozen. Null while still drafting. */
  frozenCount: number | null;
  statusLine: string | null;
  errorLine: string | null;
  /** Set only in `revision_queued`; the reviewer can follow the work they started. */
  continuationId: string | null;
  /** True once queued: resubmission is closed here as well as at the backend. */
  resubmissionDisabled: boolean;
};

const changeWord = (n: number) => (n === 1 ? 'change' : 'changes');

/**
 * Everything the action block may render, for one state.
 *
 * `busy` is the caller's in-flight flag for any other review write (adding an issue,
 * editing one). It disables the primary action without changing the copy — a button
 * that changes its words while a different request is in flight reads as a state
 * transition that did not happen.
 */
export function reviewSubmissionView(input: {
  state: SubmissionState;
  draftCount: number;
  busy: boolean;
  /**
   * False until Backend #160 is pinned. When false the composer renders but cannot be
   * typed into, so a note can never be collected on a path that could not carry it.
   */
  noteEnabled: boolean;
}): SubmissionView {
  const { state, draftCount, busy, noteEnabled } = input;
  const frozenCount = state.snapshot ? state.snapshot.issueCount : null;

  const noteHint = noteEnabled
    ? null
    : 'The revision note ships with the backend submission contract; it is not collected yet.';

  if (state.phase === 'revision_queued') {
    // THE SERVER'S COUNT, not the local freeze. The two can differ — another tab, or
    // a draft written between this room's last read and the server's snapshot — and
    // where they do, the server is right.
    const n = state.submittedCount ?? frozenCount ?? draftCount;
    const drifted = state.submittedCount !== null && frozenCount !== null && state.submittedCount !== frozenCount;
    return {
      mode: 'queued',
      primaryLabel: 'Revision queued',
      primaryEnabled: false,
      secondaryLabel: null,
      secondaryEnabled: false,
      showNote: false,
      noteEnabled: false,
      noteHint: null,
      frozenCount,
      // Names the exact count AND the continuation, so the reviewer can tell this
      // screen's claim from a hopeful one. A drift is stated rather than hidden: the
      // room showed one number and the server committed another.
      statusLine: drifted
        ? `${n} ${changeWord(n)} were sent as one revision — this room had shown ${frozenCount}.`
        : `${n} ${changeWord(n)} were sent as one revision.`,
      errorLine: null,
      continuationId: state.continuationId,
      resubmissionDisabled: true,
    };
  }

  if (state.phase === 'preparing' || state.phase === 'submitting') {
    // IN FLIGHT, NOT A CONFIRMATION SCREEN. `preparing` is entered and left inside one
    // click handler, so neither phase offers a clickable primary: the decisive click
    // already happened, and re-offering the same label was how the old two-step flow
    // promised "& start revision" on a click that sent nothing.
    const n = frozenCount ?? draftCount;
    const submitting = state.phase === 'submitting';
    return {
      mode: 'in_flight',
      primaryLabel: submitting ? `Sending ${n} ${changeWord(n)}…` : `Preparing ${n} ${changeWord(n)}…`,
      primaryEnabled: false,
      secondaryLabel: null,
      secondaryEnabled: false,
      showNote: true,
      noteEnabled: false,
      noteHint,
      frozenCount,
      statusLine: `${n} ${changeWord(n)} frozen for this revision.`,
      errorLine: null,
      continuationId: null,
      resubmissionDisabled: true,
    };
  }

  // ── draft, or a failure that returned to it ──────────────────────────────────
  // A failure preserves every draft and the note, so the block returns to the SAME
  // offer it made before, plus the reason it did not go through.
  const errorLine = state.phase === 'error' ? state.error : null;

  if (draftCount === 0) {
    // Nothing to revise. The explicit action is acceptance, and it says so — this is
    // the one place "continue" is honest, because there is no feedback to carry.
    return {
      mode: 'accept_result',
      primaryLabel: 'Accept result & continue',
      primaryEnabled: !busy,
      secondaryLabel: null,
      secondaryEnabled: false,
      showNote: false,
      noteEnabled: false,
      noteHint: null,
      frozenCount: null,
      statusLine: null,
      errorLine,
      continuationId: null,
      resubmissionDisabled: false,
    };
  }

  return {
    mode: 'send_changes',
    primaryLabel: `Send ${draftCount} ${changeWord(draftCount)} & start revision`,
    primaryEnabled: !busy,
    secondaryLabel: 'Keep reviewing',
    secondaryEnabled: true,
    showNote: true,
    noteEnabled,
    noteHint,
    frozenCount: null,
    statusLine: null,
    errorLine,
    continuationId: null,
    resubmissionDisabled: false,
  };
}
