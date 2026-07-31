/**
 * lib/review-room-state.ts — what the Review Room may offer, and what it may say.
 *
 * Pure so the rules are executable rather than asserted by reading JSX. Two classes of
 * bug live here and both are user-visible:
 *
 *   CONTRADICTORY COPY — a panel that says "Accepted" while still offering "Request
 *   fixes", or that offers "Accept result" for a hold that is really asking permission
 *   to CONTINUE. The user cannot tell which statement to believe.
 *
 *   SILENT SUPPRESSION — a frozen (submitting/submitted) session that still looks
 *   editable, so a user types feedback that can never reach the agent.
 */

export type RoomSessionState = 'draft' | 'submitting' | 'submitted' | 'accepted' | 'dismissed' | null;

export type RoomActions = {
  /** Request fixes: needs at least one draft issue and an unfrozen, unaccepted session. */
  canSubmit: boolean;
  /** Accept result: never for an approval-before-action hold. */
  canAccept: boolean;
  /** Approve next action: ONLY for an approval-before-action hold. */
  showApproveNextAction: boolean;
  /** May the user still add/edit/delete issues? */
  canEditIssues: boolean;
  submitLabel: string;
  /** One status sentence, or null when there is nothing to declare. */
  statusLine: string | null;
};

export function reviewRoomActions(input: {
  sessionState: RoomSessionState;
  draftCount: number;
  isApprovalHold: boolean;
}): RoomActions {
  const { sessionState, draftCount, isApprovalHold } = input;
  const accepted = sessionState === 'accepted';
  const frozen = sessionState === 'submitting' || sessionState === 'submitted';

  // An approval hold authorizes REMAINING WORK. It is not a delivered result, so
  // "Accept result" is not merely unhelpful here — it answers a different question.
  if (isApprovalHold) {
    return {
      canSubmit: false, canAccept: false, showApproveNextAction: true,
      canEditIssues: false, submitLabel: 'Request fixes',
      statusLine: 'This agent is waiting for permission to continue.',
    };
  }

  if (accepted) {
    return {
      canSubmit: false, canAccept: false, showApproveNextAction: false,
      canEditIssues: false, submitLabel: 'Request fixes',
      statusLine: 'You accepted this result.',
    };
  }

  if (frozen) {
    return {
      canSubmit: false, canAccept: false, showApproveNextAction: false,
      canEditIssues: false, submitLabel: 'Revision queued',
      statusLine: sessionState === 'submitted'
        ? 'Your fixes were sent as one revision.'
        : 'Sending your fixes…',
    };
  }

  return {
    canSubmit: draftCount > 0, canAccept: true, showApproveNextAction: false,
    canEditIssues: true,
    submitLabel: draftCount > 0 ? `Request fixes (${draftCount})` : 'Request fixes',
    statusLine: null,
  };
}

/**
 * A human acceptance is not a machine result. This sentence is shown next to Accept so
 * the distinction is stated where the decision is made, not buried in docs.
 */
export const ACCEPT_DISCLAIMER =
  "Accepting records your judgement. It doesn't change the Judge verdict or mean the files were verified.";
