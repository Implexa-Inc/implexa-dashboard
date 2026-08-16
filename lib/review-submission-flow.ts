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
 * ── THE PINNED CONTRACT ─────────────────────────────────────────────────────────
 * Wired against implexa-backend@8c0f71d6eb611faf9635f14c7bafc767d01bc706 (migrations
 * 0165 + 0166 applied). Field names, bounds and response shapes here were read from
 * that commit's `src/routes/review.js` and `src/lib/review-submission.js` — none of
 * them are inferred.
 *
 *   POST /api/v2/review/sessions/:sessionId/submit   { revisionNote: string | null }
 *
 *   fresh      { ok, requestId, issueCount, brief, submissionId, submissionDigest, session }
 *   recovered  { ok, recovered: true, … same fields }
 *   idempotent { ok, idempotent: true, requestId, session }   ← no issueCount
 *
 * This module still performs NO I/O: the caller supplies the transport, and everything
 * here — including how a response is read and when it is refused — stays executable in
 * a test.
 */

export type SubmissionPhase = 'draft' | 'preparing' | 'submitting' | 'revision_queued' | 'error';

/**
 * What `preparing` froze.
 *
 * A CLIENT-SIDE DISPLAY FREEZE, AND NOTHING MORE. It records what the room believed
 * it was sending at the instant of the click, so the in-flight copy cannot drift as
 * drafts change underneath. It is still NOT a contract with the server: at 8c0f71d the
 * submit endpoint takes a session id and a note, and snapshots the issue set itself
 * under a row lock (`review_prepare_submission`). There is no field in which to send
 * these ids and nothing that would verify them.
 *
 * Two things follow, and both are enforced below:
 *   the transition into flight is ONE action, so no user edit can land between the
 *   freeze and the send; and
 *   every count the room REPORTS after the fact comes from the server, never here.
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
  /** The 0165 structured-submission id the server bound, when it named one. */
  submissionId: string | null;
  error: string | null;
};

export const INITIAL_SUBMISSION_STATE: SubmissionState = {
  phase: 'draft', snapshot: null, continuationId: null,
  submittedCount: null, submissionId: null, error: null,
};

/**
 * The composer's bound IS the wire bound — re-exported from the one place that states
 * it, so the textarea and the request can never disagree about what fits.
 */
export { REVISION_NOTE_MAX } from './review-actions.ts';

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
    submissionId: null,
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
  args: { continuationId: string; issueCount?: number | null; submissionId?: string | null },
): SubmissionState {
  if (state.phase !== 'submitting' && state.phase !== 'preparing') return state;
  const id = String(args?.continuationId || '').trim();
  if (!id) return failSubmission(state, 'The revision was not confirmed. Nothing was sent.');
  const n = args?.issueCount;
  const submittedCount = typeof n === 'number' && Number.isInteger(n) && n >= 0 ? n : null;
  return {
    ...state,
    phase: 'revision_queued',
    continuationId: id,
    submittedCount,
    // The 0165 structured-submission identity, when the server names one. Absent on a
    // pre-0165 adopted row, so the room shows it only where it is real.
    submissionId: String(args?.submissionId || '').trim() || null,
    error: null,
  };
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
    submissionId: null,
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
      submissionId: local.submissionId,
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
      continuationId: null, submittedCount: null, submissionId: null, error: null,
    };
  }

  return local;
}

/**
 * What one submit attempt learned. A failure carries no identity by construction, so
 * there is no shape in which "it worked" and "there is no continuation" coexist.
 */
export type SubmitOutcome =
  | {
      ok: true;
      requestId: string;
      /** SERVER-AUTHORITATIVE. Never derived from local drafts. */
      issueCount: number;
      submissionId: string | null;
      submissionDigest: string | null;
      /** The server had already submitted this session; the same continuation stands. */
      idempotent: boolean;
      /** The server adopted a continuation an earlier crashed attempt had created. */
      recovered: boolean;
      /** The server-authoritative source policy frozen into this submission. */
      sourceMode?: 'inherit' | 'reviewed_capsule' | null;
      /** True when the server safely replaced an unavailable inherit contract. */
      sourceModeDerived?: boolean;
    }
  | { ok: false; reason: SubmitRefusal; message: string | null };

/**
 * Why a submission did not produce a queued revision. Typed because the room reacts
 * differently to "the server refused" and "we could not tell what the server said" —
 * and because a refusal the user can act on must not read like a transport blip.
 */
export type SubmitRefusal =
  /** The server answered with a refusal it means: 4xx, conflict, digest mismatch. */
  | 'refused'
  /** A read the server could not make. Retryable, and it says so. */
  | 'unavailable'
  /** `ok: true` that does not carry a usable continuation identity or count. */
  | 'malformed_success'
  /** The request never completed: offline, abort, navigation. */
  | 'transport';

const isIntCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const trimmed = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/**
 * Read one submit response, and FAIL CLOSED.
 *
 * Every success shape at implexa-backend@8c0f71d, `src/routes/review.js`:
 *
 *   fresh      { ok, requestId, issueCount, brief, submissionId, submissionDigest, session }
 *   recovered  { ok, recovered: true, requestId, issueCount, brief, submissionId, submissionDigest, session }
 *   idempotent { ok, idempotent: true, requestId, session }
 *
 * Note the third: the idempotent branch returns NO `issueCount`. It is not missing
 * information — `session` is the `_publicSession` projection and carries
 * `submittedIssueIds`, which is the server's own record of what it submitted. That is
 * the authoritative count on that path, and the only fallback permitted here.
 *
 * What is never permitted is inventing one. An `ok: true` that yields neither a
 * continuation id nor a server count is reported as `malformed_success`: the drafts
 * stay, the room does not claim a revision, and the reviewer is told plainly that the
 * result could not be confirmed. Filling the gap from local drafts would be exactly
 * the local-only success the epic forbids.
 */
export function parseSubmitResponse(body: unknown, opts: { unavailable?: boolean } = {}): SubmitOutcome {
  const b = (body ?? {}) as Record<string, unknown>;
  const message = trimmed(b.error) || null;

  if (b.ok !== true) {
    // `unavailable` is the backend's own word for a read it could not make (503), and
    // the proxy sets it too when the upstream is unreachable.
    const unavailable = b.unavailable === true || opts.unavailable === true;
    return { ok: false, reason: unavailable ? 'unavailable' : 'refused', message };
  }

  const requestId = trimmed(b.requestId);
  if (!requestId) {
    return {
      ok: false, reason: 'malformed_success',
      message: 'The review service reported success without naming a revision. Nothing was sent.',
    };
  }

  const session = (b.session ?? null) as Record<string, unknown> | null;
  const submittedIds = session && Array.isArray(session.submittedIssueIds)
    ? (session.submittedIssueIds as unknown[]).filter((x) => typeof x === 'string' && x.trim())
    : null;

  const issueCount = isIntCount(b.issueCount)
    ? b.issueCount
    : submittedIds && submittedIds.length
      ? submittedIds.length
      : null;

  if (issueCount === null) {
    return {
      ok: false, reason: 'malformed_success',
      message: 'The review service confirmed a revision but not how much it sent. Reload the review before trying again.',
    };
  }

  const hasSourceMode = Object.prototype.hasOwnProperty.call(b, 'sourceMode');
  const hasSourceModeDerived = Object.prototype.hasOwnProperty.call(b, 'sourceModeDerived');
  if (hasSourceMode !== hasSourceModeDerived) {
    return {
      ok: false, reason: 'malformed_success',
      message: 'The review service returned an incomplete source policy. Nothing was sent.',
    };
  }
  const sourceMode = !hasSourceMode
    ? null
    : b.sourceMode === 'inherit' || b.sourceMode === 'reviewed_capsule'
      ? b.sourceMode
      : null;
  if (hasSourceMode && (sourceMode === null || typeof b.sourceModeDerived !== 'boolean')) {
    return {
      ok: false, reason: 'malformed_success',
      message: 'The review service returned an invalid source policy. Nothing was sent.',
    };
  }

  return {
    ok: true,
    requestId,
    issueCount,
    submissionId: trimmed(b.submissionId) || null,
    submissionDigest: trimmed(b.submissionDigest) || null,
    idempotent: b.idempotent === true,
    recovered: b.recovered === true,
    sourceMode,
    sourceModeDerived: hasSourceMode ? b.sourceModeDerived as boolean : false,
  };
}

/** The sentence shown when an attempt did not produce a revision. */
export function submitRefusalCopy(outcome: Extract<SubmitOutcome, { ok: false }>): string {
  if (outcome.message) return outcome.message;
  if (outcome.reason === 'transport') {
    return 'We could not reach the review service. Nothing was sent — your feedback is still here.';
  }
  if (outcome.reason === 'unavailable') {
    return 'The review service could not complete that just now. Nothing was sent — try again.';
  }
  return 'That did not go through. Nothing was sent — your feedback is still here.';
}

/**
 * A synchronous single-flight latch, held across renders by the caller.
 *
 * Structurally a React ref, deliberately: the same shape `beginProposalCreate` already
 * uses for this exact hazard on the generation-entry path.
 */
export type SubmissionFlight = { current: boolean };

/**
 * THE WHOLE CLICK, as one function — freeze, send, settle or fail.
 *
 * Extracted from the component on purpose. Every way this can go wrong is a way the
 * room gets stuck on "Sending…" forever, or sends twice, and none of them are
 * reachable from a test that reads JSX or asserts on a source string:
 *
 *   the request RESOLVES with a refusal            -> error, drafts kept
 *   the request RESOLVES ok but names no revision  -> error, drafts kept
 *   the request REJECTS (offline, abort, navigate) -> error, drafts kept
 *   the request RESOLVES with a continuation       -> queued, from THAT response
 *   a SECOND click arrives before the first renders -> nothing transmitted
 *
 * THE LATCH IS NOT REDUNDANT WITH THE PHASE GUARD, and this is the subtle part. A
 * real double click does not wait for React to commit `setLocalSubmission`. Both
 * invocations therefore close over the SAME pre-render `state` — still `draft` — so
 * `beginPreparing` says yes to both, `busy` has not updated, and the disabled button
 * has not re-rendered. Two requests go out for one user action. The phase guard only
 * ever stops a click that arrives after a render.
 *
 * `flight` closes that window because it is read and written synchronously, before
 * the first `await`: the second call sees `true` while the first is still suspended.
 * It is REQUIRED rather than optional so it cannot be forgotten back into existence.
 *
 * `onState` is called at most twice — once entering flight, once on the outcome — so
 * a caller can drive React state without this function knowing about React.
 */
export async function submitRevision(args: {
  state: SubmissionState;
  draftIssueIds: string[];
  submit: () => Promise<SubmitOutcome>;
  onState: (next: SubmissionState) => void;
  flight: SubmissionFlight;
}): Promise<SubmissionState> {
  const { state, draftIssueIds, submit, onState, flight } = args;

  // SYNCHRONOUS, AND BEFORE EVERY await BELOW. Async function bodies run to their
  // first await synchronously, so this check-and-set completes during the first
  // click's call — while the second click is still queued behind it.
  if (flight.current) return state;
  flight.current = true;

  try {
    // Re-entry across renders, and "nothing to send", both stop here — before
    // anything is transmitted.
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
      outcome = { ok: false, reason: 'transport', message: null };
    }

    const next = outcome.ok
      // settleQueued re-checks the continuation, so an `ok` with an empty id still
      // lands in error rather than claiming a revision that does not exist.
      ? settleQueued(sending, {
        continuationId: outcome.requestId,
        issueCount: outcome.issueCount,
        submissionId: outcome.submissionId,
      })
      // FAIL CLOSED, with the reason the parser determined. A malformed success is a
      // failure here for the same reason a refusal is: nothing may claim a revision
      // the server did not name and count.
      : failSubmission(sending, submitRefusalCopy(outcome));
    onState(next);
    return next;
  } finally {
    // RELEASED ON EVERY PATH, including the rejected one. A latch that survived a
    // failure would make the error state unretryable — the button would be offered
    // and do nothing, which is the same silent no-op this flow just removed. Re-entry
    // after a SUCCESS is refused by the phase guard instead, which is durable.
    flight.current = false;
  }
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
  /**
   * The server's structured-submission id, when it named one. Shown alongside the
   * continuation so the queued claim carries verifiable identity, not just a number.
   */
  submissionId: string | null;
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
   * Whether the composer accepts input. True against the pinned contract; the flag
   * survives so a future backend that cannot carry a note degrades to a visible,
   * honest read-only composer rather than silently dropping one.
   */
  noteEnabled: boolean;
}): SubmissionView {
  const { state, draftCount, busy, noteEnabled } = input;
  const frozenCount = state.snapshot ? state.snapshot.issueCount : null;

  const noteHint = noteEnabled
    ? null
    : 'The revision note cannot be sent to this backend, so it is not collected.';

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
      submissionId: state.submissionId,
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
      submissionId: null,
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
      submissionId: null,
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
    submissionId: null,
    resubmissionDisabled: false,
  };
}
