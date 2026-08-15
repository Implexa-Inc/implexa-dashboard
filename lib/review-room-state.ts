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
  //
  // DRAFTS OUTRANK THE HOLD (#129). If the reviewer has already written issues, the
  // question in front of them is what to do with those issues, and Review Room owns
  // that end to end. Sending them to the run's approval gate was the production
  // failure: the gate does not carry their feedback, so the continuation it created
  // went looking for the review through Computer Use. A hold with drafts therefore
  // falls through to the normal send path, and Approve next action is not offered
  // anywhere a draft exists.
  if (isApprovalHold && draftCount === 0) {
    return {
      canSubmit: false, canAccept: false, showApproveNextAction: true,
      canEditIssues: false, submitLabel: 'Request fixes',
      statusLine: 'This agent is waiting for permission to continue.',
    };
  }
  // A hold WITH drafts deliberately falls through to the accepted/frozen checks below
  // before reaching the send path. Returning early here would let a submitting or
  // accepted session look editable again merely because a hold was also set.

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
    canSubmit: draftCount > 0,
    // Never under a hold. Reaching here with one set means drafts exist, so the room
    // owns sending them — but the agent still has not delivered a result to accept.
    canAccept: !isApprovalHold,
    showApproveNextAction: false,
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

const noun = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** Exact pre-send composition copy: prior unresolved identities plus current drafts. */
export function revisionCompositionLabel(unresolvedCount: number, newCount: number): string {
  return `Send ${unresolvedCount} unresolved + ${newCount} new ${noun(newCount, 'change', 'changes')}`;
}

// ── artifact scoping ────────────────────────────────────────────────────────
//
// A run can carry many artifacts (the live stress fixture has 28). An issue belongs to
// exactly ONE of them, and the surface must respect that: an issue about video B shown
// over video A is anchored to bytes that are not on screen. Its timestamp seeks the
// wrong file, its marker sits on the wrong timeline, and its staleness is computed
// against a digest it was never made against — which can report a perfectly current
// comment as stale, or hide a genuinely stale one.

export type ScopableIssue = {
  id: string;
  artifactId?: string | null;
  anchor?: Record<string, unknown> | null;
  status?: string;
};
export type ScopableArtifact = { id: string; relativePath?: string; sha256?: string | null; status?: string | null };

/**
 * The issues that belong to ONE artifact — the only ones a viewer of that artifact may
 * render markers for, seek to, or highlight.
 *
 * A whole-file issue with no artifactId belongs to the run rather than to any one file,
 * so it is deliberately excluded from every artifact surface: drawing it on an
 * arbitrary timeline would invent a location it never had.
 */
export function issuesForArtifact<T extends ScopableIssue>(issues: T[], artifactId: string | null): T[] {
  if (!artifactId) return [];
  return issues.filter((i) => i.artifactId === artifactId);
}

/** The artifact an issue was actually made against, or null when it names none. */
export function artifactForIssue<A extends ScopableArtifact>(issue: ScopableIssue, artifacts: A[]): A | null {
  if (!issue.artifactId) return null;
  return artifacts.find((a) => a.id === issue.artifactId) ?? null;
}

/**
 * Staleness measured against the issue's OWN artifact, never the one on screen.
 *
 * Comparing against the selected artifact is how a current comment gets flagged stale
 * merely because the user switched files.
 */
export function isIssueStale<A extends ScopableArtifact>(issue: ScopableIssue, artifacts: A[]): boolean {
  const own = artifactForIssue(issue, artifacts);
  // No artifact reference: a whole-run comment cannot go stale against a file.
  if (!issue.artifactId) return false;
  if (!own) return true; // it named an artifact this packet does not contain
  if (own.status !== 'validated') return true;
  const anchor = issue.anchor && typeof issue.anchor === 'object'
    ? (issue.anchor as { version?: unknown; artifactSha256?: unknown; observedArtifactSha256?: unknown })
    : null;
  // A v2 anchor names the bytes it observed under its own key; reading the v1 key
  // there would flag every current spatial comment stale.
  const anchorSha = anchor?.version === 2 ? anchor.observedArtifactSha256 : anchor?.artifactSha256;
  if (typeof anchorSha !== 'string') return true;
  return anchorSha !== own.sha256;
}

/**
 * What clicking an issue must do. Seeking without switching would move the WRONG
 * player, so the target artifact is named explicitly and the caller switches first.
 */
export function issueClickTarget(issue: ScopableIssue, selectedArtifactId: string | null): {
  artifactId: string | null;
  needsSwitch: boolean;
  seekMs: number | null;
} {
  const anchor = (issue.anchor ?? {}) as Record<string, unknown>;
  // A v2 spatial anchor with a temporal claim seeks to its FROZEN timestamp — opening
  // the issue must land the player on the exact frame the pin was placed on. An image
  // pin has no time and seeks nowhere.
  const temporal = anchor.version === 2 && anchor.temporal && typeof anchor.temporal === 'object'
    ? (anchor.temporal as { startMs?: unknown })
    : null;
  const seekMs = temporal
    ? (Number(temporal.startMs) || 0)
    : anchor.type === 'media_time' ? (Number(anchor.timeStartMs) || 0) : null;
  const artifactId = issue.artifactId ?? null;
  return { artifactId, needsSwitch: !!artifactId && artifactId !== selectedArtifactId, seekMs };
}

/**
 * The artifact the room should open on when a link asked for one (e.g. a
 * generated-clip deep link `?artifact=`). The request is honored ONLY when it
 * names an artifact actually present in this packet — a stale or foreign id must
 * not leave the room stuck on "nothing selected", and must never be trusted as an
 * identity the packet did not confirm.
 */
export function resolveInitialArtifact<A extends ScopableArtifact>(
  requestedId: string | null | undefined,
  reviewable: A[],
  fallbackId: string | null,
): string | null {
  if (requestedId && reviewable.some((a) => a.id === requestedId)) return requestedId;
  return fallbackId;
}

// ── cross-artifact seeking ──────────────────────────────────────────────────
//
// Switching artifact and then seeking is a THREE-WAY agreement, and getting it wrong is
// invisible: the wrong video moves, or nothing moves and the request is silently lost.
//
// The race this exists to close: `setSelectedId(B)` and the pending seek are batched, so
// the very next render still carries artifact A's preview URL and media element. An
// effect that only checks "is there a URL and a ref?" reads A's — because a
// `setPreviewUrl(null)` scheduled by an earlier effect in the SAME flush is not visible
// to a later one — seeks A to B's timestamp, and clears the request. B then loads with
// nothing left to do.
//
// So a pending seek carries its artifact identity, and is applied only when the
// selection, the READY preview, and the request all name the same artifact.

export type PendingSeek = { artifactId: string; seekMs: number } | null;

export function shouldApplySeek(args: {
  pending: PendingSeek;
  selectedArtifactId: string | null;
  /** Which artifact the CURRENTLY LOADED preview belongs to — not merely "a URL exists". */
  readyPreviewArtifactId: string | null;
}): boolean {
  const { pending, selectedArtifactId, readyPreviewArtifactId } = args;
  if (!pending) return false;
  // The equality chain already covers "nothing loaded": a pending seek always names a
  // real artifact, so comparing it against null is false. A separate null guard here
  // would be decorative — verified by mutation.
  return pending.artifactId === selectedArtifactId && selectedArtifactId === readyPreviewArtifactId;
}

/**
 * A pending seek that can never be satisfied must be dropped, not held forever.
 *
 * If the preview for its artifact FAILED, the file will never appear, so retaining the
 * request would leave a silent promise that fires on some unrelated later load. If the
 * user has since selected a different artifact, the request is equally moot.
 */
export function shouldDropPendingSeek(args: {
  pending: PendingSeek;
  selectedArtifactId: string | null;
  /**
   * WHICH artifact's preview terminally failed, not merely "something failed".
   *
   * A bare boolean repeats the very race this module exists to close, one variable
   * over: when switching from a FAILED artifact A to issue-linked B, the render that
   * carries selected=B still carries A's failure decision, and a cleanup effect reading
   * it in that flush would drop B's perfectly valid pending seek before B ever loads.
   * Binding the failure to its artifact means only A's failure can cancel A's request.
   */
  failedArtifactId: string | null;
}): boolean {
  const { pending, selectedArtifactId, failedArtifactId } = args;
  if (!pending) return false;
  // The user moved somewhere else entirely; the request is moot either way.
  if (pending.artifactId !== selectedArtifactId) return true;
  // Its OWN preview failed, so it can never load. Another artifact's failure says
  // nothing about this one.
  return failedArtifactId !== null && failedArtifactId === pending.artifactId;
}

// ── the pre-submit expected-output roster (REV-COR05, client mirror) ────────
//
// The server freezes the requested output set from the submission's EDIT TARGETS:
// for a reference issue (observe A, change B) the target is B, otherwise the artifact
// the issue is bound to — deterministic entry order, distinct
// (run-review.service compileSubmission, `editTargetIds`). This mirror exists so the
// footer can SAY what will be requested before the click; it derives from the same
// facts the server reads and NEVER invents server state: an id the packet cannot name
// is omitted silently rather than guessed at.

/**
 * The reviewed files this submission's issues ask to change, as display names in
 * first-mention order. Empty when nothing resolves — the caller omits the line.
 */
export function expectedRevisionOutputNames(
  issues: Array<{ artifactId?: string | null; anchor?: unknown }>,
  artifacts: Array<{ id: string; relativePath: string }>,
): string[] {
  const byId = new Map(artifacts.map((a) => [String(a.id), a.relativePath]));
  const seen = new Set<string>();
  const names: string[] = [];
  for (const issue of issues) {
    const anchor = issue?.anchor as {
      version?: unknown;
      intent?: { mode?: unknown; targetArtifactId?: unknown } | null;
    } | null | undefined;
    // The EDIT target, exactly as the server derives it: a v2 reference anchor's
    // typed target wins; otherwise the issue's own artifact; an unanchored issue
    // requests no file output.
    const referenceTarget = anchor && anchor.version === 2
      && anchor.intent && anchor.intent.mode === 'reference_for_artifact'
      && typeof anchor.intent.targetArtifactId === 'string'
      ? anchor.intent.targetArtifactId
      : null;
    const editId = referenceTarget ?? (issue?.artifactId ? String(issue.artifactId) : null);
    if (!editId || seen.has(String(editId))) continue;
    seen.add(String(editId));
    const name = byId.get(String(editId));
    if (name) names.push(name);
  }
  return names;
}
