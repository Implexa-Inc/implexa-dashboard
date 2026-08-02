/**
 * lib/review-timestamp-feedback.ts — where a piece of media feedback actually lands.
 *
 * THE BUG THIS MODULE EXISTS TO MAKE UNREPRESENTABLE (observed in production): the
 * player showed 00:01 while the button read "+ Add feedback at 00:03.042", and saving
 * anchored the comment at 3.042s. The button was bound to `pausedAtMs` — the last
 * PAUSE — so any scrub, or any seek that did not end in a pause, left the offer
 * pointing at a moment the reviewer was no longer looking at.
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
 * AND A DRAFT FREEZES ITS FILE, NOT ONLY ITS TIME. A draft carries the artifact id,
 * the validated digest, the path and the role it was opened against. The digest in
 * particular has to travel with the draft: reading it from "whichever artifact is
 * selected at save time" is how a comment written about file A gets anchored to file
 * B's bytes — which the backend would happily accept, because the anchor it receives
 * is internally consistent. It is just about the wrong file.
 *
 * DISCOVERABILITY. A point comment and a range are different acts, so they are two
 * visible choices rather than one button plus a "Set end here" affordance that only
 * appears after you have already committed to a point. A range is a small state
 * machine of its own: START is frozen when you begin, END follows the playhead until
 * you take it.
 *
 * Users are shown WHOLE SECONDS for a point — the granularity they can aim at, and
 * the number the player is showing them. A RANGE shows exact milliseconds, because
 * its boundaries are a precise claim about extent rather than an aim.
 *
 * WHAT THIS MODULE DELIBERATELY DOES NOT DO: it does not model "change this file" vs
 * "reference only" as a typed value. The backend contract has no such field — see
 * docs/review-target-intent-contract.md — and `lib/review-anchor.js` upstream drops
 * unknown anchor keys silently on a 200. A dashboard-only field would look structured,
 * survive nothing, and reach the agent as nothing at all. So the room states the
 * situation in words and leaves the sentence in the reviewer's own body text.
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
 * an event carrying a position from an element that is no longer the selected file
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

// ── the frozen file ─────────────────────────────────────────────────────────

/**
 * WHICH FILE a piece of feedback is about, captured at the moment the reviewer
 * committed to writing it.
 *
 * All four fields travel together on purpose. The id addresses the row, the digest
 * anchors the bytes, the path is what the reviewer is shown, and the role is what the
 * guidance is chosen from. Re-deriving any of them from "the currently selected
 * artifact" at save time reopens the same class of bug the playhead fix closed, one
 * dimension over: right position, wrong file.
 */
export type FrozenTarget = {
  artifactId: string | null;
  sha256: string | null;
  relativePath: string | null;
  role: string | null;
};

export const NO_TARGET: FrozenTarget = { artifactId: null, sha256: null, relativePath: null, role: null };

/** The line the composer always shows, so the file is never something you infer. */
export function targetLine(target: FrozenTarget | null | undefined): string {
  const path = target?.relativePath;
  return `Feedback applies to: ${path || 'the whole run'}`;
}

/**
 * A source file is an INPUT the agent may be expected to edit in place. Saying so is
 * the whole intervention: "reference only" is a real and common intent, and the
 * failure mode is a reviewer assuming it was understood when nothing carried it.
 *
 * This is prose, not a setting. See docs/review-target-intent-contract.md for why
 * there is no typed field behind it yet, and what it would take to add one.
 */
export const REFERENCE_ONLY_SENTENCE = 'Use this section as reference; do not modify the source file.';
export const SOURCE_FILE_GUIDANCE =
  `This is a source file. Feedback added here applies to this source. If it is only a reference, say: “${REFERENCE_ONLY_SENTENCE}”`;

/** The guidance for this target, or null when none applies. Never inferred from text. */
export function targetGuidance(target: FrozenTarget | null | undefined): string | null {
  return target?.role === 'source' ? SOURCE_FILE_GUIDANCE : null;
}

// ── the draft ───────────────────────────────────────────────────────────────

export type DraftSelection = { start: number; end: number; quote: string };

export type FeedbackDraft = {
  /** The FROZEN file: id, digest, path and role, captured at open. */
  target: FrozenTarget;
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

/** What KIND of location this draft claims. Drives the header and the copy. */
export function draftMode(draft: FeedbackDraft | null | undefined): 'point' | 'range' | 'text' | 'whole' | null {
  if (!draft) return null;
  if (draft.selection) return 'text';
  if (draft.anchorMs === null) return 'whole';
  return draft.rangeEndMs === null ? 'point' : 'range';
}

/**
 * Open a composer, FREEZING the current playhead and the current file into it.
 *
 * The freeze is the whole point: from here on the draft's position and its file are
 * values, not readings taken from a player that is still moving and a selector the
 * user can still change.
 */
export function openDraft(args: {
  target: FrozenTarget;
  playheadMs: number | null;
  selection?: DraftSelection | null;
  kind?: string;
}): FeedbackDraft {
  const selection = args.selection ?? null;
  return {
    target: { ...args.target },
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
 * since drifted to.
 *
 * The target must be the issue's OWN artifact. Refusing a mismatch here rather than
 * trusting the caller means an edit can never be opened against the file that happens
 * to be on screen: that would re-anchor the comment to different bytes on save, which
 * is exactly the failure the frozen target exists to prevent.
 */
export function draftFromIssue(
  issue: EditableIssue | null | undefined,
  target: FrozenTarget,
): FeedbackDraft | null {
  if (!issue || !canEditIssue(issue)) return null;
  if ((issue.artifactId ?? null) !== (target.artifactId ?? null)) return null;
  const anchor = (issue.anchor ?? {}) as Record<string, unknown>;
  const isMedia = anchor.type === 'media_time';
  const isText = anchor.type === 'text_selection';
  return {
    target: { ...target },
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
 * May a click on a new-comment affordance replace the open draft?
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

/** Append the reference-only sentence to the body. The reviewer's words, one tap. */
export function withReferenceSentence(draft: FeedbackDraft | null): FeedbackDraft | null {
  if (!draft) return draft;
  if (draft.body.includes(REFERENCE_ONLY_SENTENCE)) return draft;
  const existing = draft.body.trim();
  return { ...draft, body: existing ? `${existing} ${REFERENCE_ONLY_SENTENCE}` : REFERENCE_ONLY_SENTENCE };
}

// ── ranges ──────────────────────────────────────────────────────────────────

/**
 * A range in progress. START is frozen — including the file and its digest — the
 * moment the reviewer commits to marking a range; END is still the playhead, and
 * follows it until they take it.
 */
export type PendingRange = { target: FrozenTarget; startMs: number } | null;

/** Null when the end is a usable range end, else why it is refused. */
export function rangeEndError(startMs: number | null | undefined, endMs: number | null | undefined): string | null {
  if (startMs === null || startMs === undefined) return 'Start a range at a moment first, then mark where it ends.';
  if (endMs === null || endMs === undefined || !Number.isFinite(endMs) || endMs < 0) {
    return 'That is not a valid position.';
  }
  // At-or-before the start is not a range. Equal endpoints in particular read as a
  // range on screen while marking a zero-length span the reviewer never selected.
  if (endMs <= startMs) return 'The end of the range must come after the start.';
  return null;
}

/** Begin a range at the current playhead, freezing the start and the file. */
export function beginRange(args: {
  target: FrozenTarget;
  playheadMs: number | null;
}): { range: PendingRange; error: string | null } {
  if (args.playheadMs === null) {
    return { range: null, error: 'Move to the moment the range should start, then select a range.' };
  }
  return { range: { target: { ...args.target }, startMs: Math.max(0, Math.round(args.playheadMs)) }, error: null };
}

/**
 * Take the current playhead as the end and hand back a composer for the whole span.
 *
 * A REFUSAL RETURNS NO DRAFT AND LEAVES THE RANGE ALONE. Returning a partly-built
 * draft on the error path is how a rejected end still ends up stored — the caller
 * assigns what it was handed, and the refusal message becomes decoration.
 */
export function completeRange(
  range: PendingRange,
  playheadMs: number | null,
): { draft: FeedbackDraft | null; error: string | null } {
  if (!range) return { draft: null, error: 'There is no range in progress.' };
  const err = rangeEndError(range.startMs, playheadMs);
  if (err) return { draft: null, error: err };
  return {
    draft: {
      target: { ...range.target },
      anchorMs: range.startMs,
      rangeEndMs: Math.max(0, Math.round(playheadMs as number)),
      selection: null,
      kind: DEFAULT_ISSUE_KIND,
      body: '',
      editingIssueId: null,
    },
    error: null,
  };
}

/**
 * A range in progress belongs to ONE file. Selecting another artifact ends it rather
 * than carrying a start time from video A into video B's timeline.
 */
export function rangeSurvivesSelection(range: PendingRange, selectedArtifactId: string | null): boolean {
  return !!range && range.target.artifactId === selectedArtifactId;
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
 * The POINT offer, in the reviewer's terms. Reads the PLAYHEAD, never a stale pause —
 * this label is the surface the production bug was visible on.
 */
export function pointCommentLabel(args: { playheadMs: number | null; existingCount?: number }): string {
  const { playheadMs } = args;
  const existing = args.existingCount ?? 0;
  // No media position at all (an image, a text file, a player that never loaded).
  if (playheadMs === null) return '+ Add feedback';
  const at = formatSeconds(playheadMs);
  // Something is already here. Saying "+ Point comment" again would suggest this moment
  // is empty, and the natural next assumption is that the previous comment was lost.
  return existing > 0 ? `+ Add another point at ${at}` : `+ Point comment at ${at}`;
}

/** The RANGE offer, standing beside the point offer rather than hidden behind it. */
export const SELECT_RANGE_LABEL = 'Select a range';

/** A range needs a starting position, so it is offered only where one exists. */
export function canOfferRange(playheadMs: number | null): boolean {
  return playheadMs !== null;
}

/** MM:SS.mmm — exact, because a range's boundaries are a claim about extent. */
function exactMs(ms: number): string {
  const total = Math.max(0, Math.floor(Number(ms) || 0));
  const msPart = String(total % 1000).padStart(3, '0');
  const totalSec = Math.floor(total / 1000);
  const sec = String(totalSec % 60).padStart(2, '0');
  const totalMin = Math.floor(totalSec / 60);
  const min = String(totalMin % 60).padStart(2, '0');
  const hours = Math.floor(totalMin / 60);
  return hours > 0 ? `${String(hours).padStart(2, '0')}:${min}:${sec}.${msPart}` : `${min}:${sec}.${msPart}`;
}

/** The frozen start of a range in progress. */
export function rangeStartLabel(range: PendingRange): string {
  return range ? `Start ${exactMs(range.startMs)}` : '';
}

/** The end button, which FOLLOWS the playhead while the start stays put. */
export function rangeEndButtonLabel(playheadMs: number | null): string {
  return playheadMs === null ? 'Set end' : `Set end at ${exactMs(playheadMs)}`;
}

export const CANCEL_RANGE_LABEL = 'Cancel range';

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
 * The composer's own header. It names WHICH KIND of location the comment claims and
 * states the FROZEN position, so what the comment will attach to stays legible while
 * the player keeps moving underneath it.
 */
export function composerHeaderLabel(draft: FeedbackDraft | null): string {
  if (!draft) return '';
  const editing = draft.editingIssueId ? 'Editing · ' : '';
  switch (draftMode(draft)) {
    case 'text':
      return `${editing}Characters ${draft.selection!.start}–${draft.selection!.end}`;
    case 'range':
      return `${editing}Range comment · ${exactMs(draft.anchorMs!)}–${exactMs(draft.rangeEndMs!)}`;
    case 'point':
      return `${editing}Point comment · ${formatSeconds(draft.anchorMs)}`;
    default:
      return `${editing}Whole file`;
  }
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
