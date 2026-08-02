/**
 * lib/review-timestamp-feedback.ts — where a piece of media feedback actually lands.
 *
 * THE BUG THIS MODULE EXISTS TO MAKE UNREPRESENTABLE (observed in production): the
 * player showed 00:01 while the button read "+ Add feedback at 00:03.042", and saving
 * anchored the comment at 3.042s. The button was bound to `pausedAtMs` — the last
 * PAUSE — so any scrub, or any seek that did not end in a pause, left the offer
 * pointing at a moment the reviewer was no longer looking at. The comment then landed
 * two seconds away from the thing it was about, and nothing on screen said so.
 *
 * So there are two positions here, and they are deliberately different things:
 *
 *   PLAYHEAD      one authoritative current position for the SELECTED artifact,
 *                 refreshed by every event that can move it (timeupdate, seeked,
 *                 pause, loadedmetadata). Everything the user is OFFERED reads this.
 *
 *   DRAFT ANCHOR  the exact playhead SNAPSHOTTED at the moment the composer opened.
 *                 Everything that is SAVED reads this, and nothing moves it
 *                 afterwards. Playback continuing under an open composer is normal;
 *                 it must not drag the comment along with it.
 *
 * Users are shown WHOLE SECONDS because that is the granularity they can aim at, and
 * because "00:03.042" beside a player reading 00:01 is precision about the wrong
 * number. Milliseconds are kept intact underneath, because that is what the anchor is
 * actually made of and what the backend validates.
 *
 * Pure on purpose: the seam between "what the player is doing" and "what the comment
 * is about" is exactly where the bug lived, so every rule of it is executable rather
 * than asserted by reading JSX.
 */

// ── time ────────────────────────────────────────────────────────────────────

/**
 * The second a position is DISPLAYED as. This is the bucket everything user-facing
 * agrees on: the button label, the "feedback here" match, and the composer header.
 * Floor, not round — it must equal what a player reading 00:01 is showing, and a
 * player at 1.9s reads 00:01.
 */
export function displayedSecond(ms: number | null | undefined): number | null {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return null;
  return Math.floor(Math.max(0, ms) / 1000);
}

/** MM:SS, or HH:MM:SS past an hour. Whole seconds — the user-facing granularity. */
export function formatSeconds(ms: number | null | undefined): string {
  const totalSec = displayedSecond(ms) ?? 0;
  const sec = String(totalSec % 60).padStart(2, '0');
  const totalMin = Math.floor(totalSec / 60);
  const min = String(totalMin % 60).padStart(2, '0');
  const hours = Math.floor(totalMin / 60);
  return hours > 0 ? `${String(hours).padStart(2, '0')}:${min}:${sec}` : `${min}:${sec}`;
}

/**
 * A playhead update from a media element, or null when the event must be IGNORED.
 *
 * Bound to an artifact for the same reason the preview URL and the pending seek are:
 * an event carrying a position from a element that is no longer the selected file
 * would move this artifact's playhead to a moment in a different video, and the next
 * comment would be anchored there.
 */
export function playheadFromEvent(args: {
  /** Which artifact the element that fired actually belongs to. */
  eventArtifactId: string | null;
  selectedArtifactId: string | null;
  seconds: number;
}): number | null {
  const { eventArtifactId, selectedArtifactId, seconds } = args;
  if (!eventArtifactId || eventArtifactId !== selectedArtifactId) return null;
  // NaN before metadata is not a position, and must not be reported as 00:00.
  if (!Number.isFinite(seconds)) return null;
  return Math.round(Math.max(0, seconds) * 1000);
}

// ── the draft ───────────────────────────────────────────────────────────────

export type DraftSelection = { start: number; end: number; quote: string };

export type FeedbackDraft = {
  /** The artifact this draft belongs to. A draft never survives a switch. */
  artifactId: string | null;
  /**
   * THE FROZEN POSITION, in exact milliseconds. Null when the draft is not anchored
   * to a media moment (a text selection, or a whole-file comment). Written once, at
   * open. Nothing that happens to playback afterwards may change it.
   */
  anchorMs: number | null;
  /** Exact millisecond end of a range, or null for a point comment. */
  rangeEndMs: number | null;
  selection: DraftSelection | null;
  kind: string;
  body: string;
  /** The existing DRAFT issue being edited, or null when composing a new one. */
  editingIssueId: string | null;
};

export const DEFAULT_ISSUE_KIND = 'content';

/**
 * Open a composer, FREEZING the current playhead into it.
 *
 * The freeze is the whole point: from here on the draft's position is a value, not a
 * reading taken from a player that is still moving.
 */
export function openDraft(args: {
  artifactId: string | null;
  playheadMs: number | null;
  selection?: DraftSelection | null;
  kind?: string;
}): FeedbackDraft {
  const selection = args.selection ?? null;
  return {
    artifactId: args.artifactId,
    // A text selection anchors to characters; a time would be a second, contradictory
    // claim about where the same comment is.
    anchorMs: selection ? null : (args.playheadMs === null ? null : Math.max(0, Math.round(args.playheadMs))),
    rangeEndMs: null,
    selection,
    kind: args.kind || DEFAULT_ISSUE_KIND,
    body: '',
    editingIssueId: null,
  };
}

export type EditableIssue = {
  id: string;
  artifactId?: string | null;
  kind?: string;
  body?: string;
  status?: string;
  anchor?: Record<string, unknown> | null;
};

/**
 * Only UNSENT work is editable. Submitted feedback is part of a revision request the
 * agent is already acting on, and accepted or dismissed work is a record of a
 * decision — editing either in place would rewrite history the user cannot see.
 */
export function canEditIssue(issue: Pick<EditableIssue, 'status'> | null | undefined): boolean {
  return !!issue && issue.status === 'draft';
}

/**
 * Load an existing draft issue back into the composer — body, kind AND anchor, so the
 * edit reopens on the moment it was made about rather than wherever the player has
 * since drifted to. Returns null when the issue is not editable.
 */
export function draftFromIssue(issue: EditableIssue | null | undefined): FeedbackDraft | null {
  if (!issue || !canEditIssue(issue)) return null;
  const anchor = (issue.anchor ?? {}) as Record<string, unknown>;
  const isMedia = anchor.type === 'media_time';
  const isText = anchor.type === 'text_selection';
  return {
    artifactId: issue.artifactId ?? null,
    anchorMs: isMedia ? Math.max(0, Math.round(Number(anchor.timeStartMs) || 0)) : null,
    rangeEndMs: isMedia && anchor.timeEndMs !== null && anchor.timeEndMs !== undefined
      ? Math.max(0, Math.round(Number(anchor.timeEndMs) || 0))
      : null,
    selection: isText
      ? {
        start: Number(anchor.startOffset) || 0,
        end: Number(anchor.endOffset) || 0,
        quote: String(anchor.quote ?? ''),
      }
      : null,
    kind: issue.kind || DEFAULT_ISSUE_KIND,
    body: issue.body ?? '',
    editingIssueId: issue.id,
  };
}

/**
 * May a click on "+ Add feedback" replace the open draft?
 *
 * An empty composer carries nothing to lose, so re-anchoring it to the current
 * playhead is what the user just asked for. One with typed text does not get silently
 * discarded — that is the same class of loss as silently merging two comments.
 */
export function canReplaceDraft(draft: FeedbackDraft | null | undefined): boolean {
  return !draft || draft.body.trim() === '';
}

export const DRAFT_IN_PROGRESS =
  'Save or cancel the comment you are writing before starting another one.';

// ── ranges ──────────────────────────────────────────────────────────────────

/** Null when the end is a usable range end, else why it is refused. */
export function rangeEndError(startMs: number | null | undefined, endMs: number | null | undefined): string | null {
  if (startMs === null || startMs === undefined) return 'Add feedback at a moment first, then mark where it ends.';
  if (endMs === null || endMs === undefined || !Number.isFinite(endMs) || endMs < 0) {
    return 'That is not a valid position.';
  }
  // At-or-before the start is not a range. Equal endpoints in particular read as a
  // range on screen while marking a zero-length span the reviewer never selected.
  if (endMs <= startMs) return 'The end of the range must come after the start.';
  return null;
}

/**
 * Capture the current playhead as this draft's range end. Returns the refusal instead
 * of a mutated draft when the end is not usable — the caller shows it and the draft is
 * left exactly as it was.
 */
export function withRangeEnd(
  draft: FeedbackDraft | null,
  playheadMs: number | null,
): { draft: FeedbackDraft | null; error: string | null } {
  if (!draft) return { draft, error: 'There is no open comment to set an end for.' };
  const err = rangeEndError(draft.anchorMs, playheadMs);
  if (err) return { draft, error: err };
  return { draft: { ...draft, rangeEndMs: Math.max(0, Math.round(playheadMs as number)) }, error: null };
}

/** Whether the "Set end here" affordance can do anything from here. */
export function canSetRangeEnd(draft: FeedbackDraft | null, playheadMs: number | null): boolean {
  return !!draft && rangeEndError(draft.anchorMs, playheadMs) === null;
}

// ── matching existing feedback at this moment ───────────────────────────────

export type AnchoredIssue = {
  id: string;
  artifactId?: string | null;
  status?: string;
  anchor?: Record<string, unknown> | null;
};

/**
 * The DRAFT issues already sitting at the second the player is showing — for THIS
 * artifact only.
 *
 * Two separate rules, both load-bearing:
 *
 *   ARTIFACT IDENTITY — an issue on video B matched at video A's playhead would be
 *   offered as editable here, and the edit would rewrite a comment about a file the
 *   reviewer is not looking at.
 *
 *   DISPLAYED SECOND — the user aimed at what the player showed them. Matching on
 *   exact milliseconds would find nothing (nobody lands on 3042ms twice) and the room
 *   would keep claiming this moment is empty when it is not.
 *
 * Non-draft issues are excluded: they are immutable, so offering them here would
 * promise an edit that cannot happen.
 */
export function draftIssuesAtSecond<T extends AnchoredIssue>(
  issues: T[],
  artifactId: string | null,
  playheadMs: number | null,
): T[] {
  const second = displayedSecond(playheadMs);
  if (!artifactId || second === null) return [];
  return issues.filter((i) => {
    if (!canEditIssue(i)) return false;
    if (i.artifactId !== artifactId) return false;
    const anchor = (i.anchor ?? {}) as Record<string, unknown>;
    if (anchor.type !== 'media_time') return false;
    return displayedSecond(Number(anchor.timeStartMs)) === second;
  });
}

/**
 * Replace one issue in place. NEVER appends.
 *
 * An update that appends is the edit-as-create regression: the rail then shows the
 * comment twice, the draft count is wrong, and the revision request carries a
 * duplicate of feedback the user believed they had corrected. An id that is not
 * present is left alone rather than added — this list is not where it belongs.
 */
export function replaceIssue<T extends { id: string }>(issues: T[], targetId: string, updated: T): T[] {
  let found = false;
  const next = issues.map((i) => {
    if (i.id !== targetId) return i;
    found = true;
    return updated;
  });
  return found ? next : issues;
}

// ── copy ────────────────────────────────────────────────────────────────────

/**
 * The offer, in the reviewer's terms. Reads the PLAYHEAD, never a stale pause — this
 * label is the surface the production bug was visible on.
 */
export function addFeedbackLabel(args: { playheadMs: number | null; existingCount?: number }): string {
  const { playheadMs } = args;
  const existing = args.existingCount ?? 0;
  // No media position at all (an image, a text file, a player that never loaded).
  if (playheadMs === null) return '+ Add feedback';
  const at = formatSeconds(playheadMs);
  // Something is already here. Saying "+ Add feedback" again would suggest this moment
  // is empty, and the natural next assumption is that the previous comment was lost.
  return existing > 0 ? `+ Add another at ${at}` : `+ Add feedback at ${at}`;
}

/** How many comments are already at this second, or null when there are none. */
export function feedbackHereLabel(count: number): string | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  return count === 1 ? '1 feedback here' : `${count} feedback items here`;
}

/** Disambiguates the edit affordances when several comments share one second. */
export function feedbackHereEditLabel(index: number, total: number): string {
  return total <= 1 ? 'Edit' : `Edit ${index + 1}`;
}

/**
 * What the rail may offer for one issue. A draft belonging to another file is not
 * editable FROM HERE — the composer would attach to the artifact on screen. It gets an
 * affordance that says what it will actually do: open that file.
 */
export function editAction(
  issue: EditableIssue,
  selectedArtifactId: string | null,
): { label: string; opensElsewhere: boolean } | null {
  if (!canEditIssue(issue)) return null;
  const elsewhere = !!issue.artifactId && issue.artifactId !== selectedArtifactId;
  return { label: elsewhere ? 'Open to edit' : 'Edit', opensElsewhere: elsewhere };
}

/**
 * The composer's own header. It states the FROZEN position, so the moment the comment
 * will attach to is legible while the player keeps moving underneath it.
 */
export function composerHeaderLabel(draft: FeedbackDraft | null): string {
  if (!draft) return '';
  const editing = draft.editingIssueId ? 'Editing · ' : '';
  if (draft.selection) return `${editing}Characters ${draft.selection.start}–${draft.selection.end}`;
  if (draft.anchorMs === null) return `${editing}Whole file`;
  const start = formatSeconds(draft.anchorMs);
  return draft.rangeEndMs === null
    ? `${editing}At ${start}`
    : `${editing}At ${start} – ${formatSeconds(draft.rangeEndMs)}`;
}

/** Save label. An edit that says "Save issue" reads like it will make a second one. */
export function saveDraftLabel(draft: FeedbackDraft | null): string {
  return draft?.editingIssueId ? 'Save changes' : 'Save issue';
}

// ── saving ──────────────────────────────────────────────────────────────────

/**
 * WHICH write a save performs. An edit routed to create_issue is the edit-as-create
 * regression at its source: the server never learns the original was superseded, so
 * the rail shows both, the draft count is wrong, and the revision request asks the
 * agent to fix the same moment twice — once from text the user thought they replaced.
 */
export function saveActionFor(
  draft: FeedbackDraft | null | undefined,
): { action: 'create_issue' } | { action: 'update_issue'; issueId: string } | null {
  if (!draft) return null;
  return draft.editingIssueId
    ? { action: 'update_issue', issueId: draft.editingIssueId }
    : { action: 'create_issue' };
}
