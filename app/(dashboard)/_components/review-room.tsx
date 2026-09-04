'use client';

/**
 * <ReviewRoom /> — the artifact surface + issue rail + actions.
 *
 * DESIGN RULES THIS COMPONENT ENFORCES:
 *
 *  * A local file is opened ONLY through the desktop's authorized token URL. No path
 *    is ever received, stored, or rendered; `parsePreviewUrl` gates every `src`
 *    AND yields the token to revoke, so the two can never name different capabilities.
 *  * Every "cannot preview" reason gets its own words and its own buttons. An
 *    unsupported codec renders an explanation, never an empty black player.
 *  * TWO POSITIONS, NEVER ONE. The PLAYHEAD (refreshed by timeupdate/seeked/pause/
 *    loadedmetadata) drives everything the user is OFFERED; a draft's FROZEN anchor
 *    drives everything that is SAVED. Binding the offer to the last pause is what made
 *    the player read 00:01 while the button offered — and saved — 00:03.042.
 *  * The frozen position, against the artifact's validated digest, IS the identity of
 *    media feedback. Playback under an open composer must not move it.
 *  * Issues accumulate locally as DRAFTS on the server, then submit together as
 *    exactly one continuation. The submit endpoint is idempotent; this never dedupes.
 *  * "Accept result" and "Approve next action" are different questions. An
 *    approval-before-action hold never renders Accept result.
 */

import { ReviewAudioEvidence } from './review-audio-evidence';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ReviewArtifact, ReviewIssue, ReviewProduction, ReviewSession, ReviewSessionArtifact, SourceState } from '@/lib/review';
import {
  decidePreview, interpretPreviewResult, requestPreview, revokePreview,
  desktopPreviewSupported, desktopReviewHref, inDesktopApp, parsePreviewUrl,
  previewText, previewTextTruncated,
  type PreviewDecision,
} from '@/lib/review-preview';
import {
  buildMediaAnchor, buildTextAnchor, buildArtifactAnchor, anchorError, bodyError,
  anchorLabel, formatMs, sortIssues, isAnchorStale, isSpatialAnchorV2, type ReviewAnchor,
} from '@/lib/review-anchor';
import ReviewSpatialOverlay, { SPATIAL_HINT_COPY, type OverlayPin } from '@/app/(dashboard)/_components/review-spatial-overlay';
import ReviewContinuationRecovery from '@/app/(dashboard)/_components/review-continuation-recovery';
import { evidenceGate, evidenceChip, type SessionEvidenceStatus } from '@/lib/review-evidence-status';
import {
  reviewRoomActions, ACCEPT_DISCLAIMER,
  revisionCompositionLabel,
  issuesForArtifact, artifactForIssue, isIssueStale, issueClickTarget,
  reconcileArtifactSelection, resolveInitialArtifact, shouldApplySeek, shouldDropPendingSeek, type PendingSeek,
} from '@/lib/review-room-state';
import {
  finalRenderControl, preferredReviewArtifact, previewRequestIdentity, reviewableArtifacts,
  segmentForArtifact, segmentPlaybackClock,
} from '@/lib/segmented-review';
import { groupIssuesByArtifact, groupCountLabel } from '@/lib/review-chronology';
import {
  INITIAL_SUBMISSION_STATE, keepReviewing, phaseForSession, submitRevision,
  reviewSubmissionView, parseSubmitResponse, submitRefusalCopy, REVISION_NOTE_MAX,
  type SubmissionState, type SubmitOutcome,
} from '@/lib/review-submission-flow';
import { parsePatternCandidate, type ReviewPatternApplication } from '@/lib/review-actions';
import {
  artifactOptionLabel,
  latestValidatedFinalOutput,
  reviewTimestamp,
  versionForRun,
  type ReviewVersion,
} from '@/lib/review-version-identity';

import {
  beginRange, canOfferRange, canReplaceDraft, completeRange, composerHeaderLabel, draftFromIssue,
  draftIssuesAtSecond, displayedSecond, editAction, feedbackHereEditLabel, feedbackHereLabel, liveRangeError,
  openDraft, openSpatialDraft, playheadFromEvent, pointCommentLabel, rangeEndButtonLabel, rangeStartLabel,
  rangeSurvivesSelection, replaceIssue, saveActionFor, saveDraftLabel, spatialAnchorFromDraft,
  spatialReferenceLine, targetGuidance, targetLine,
  CANCEL_RANGE_LABEL, DRAFT_IN_PROGRESS, SELECT_RANGE_LABEL,
  type DraftSpatial, type FeedbackDraft, type FrozenTarget, type PendingRange, type RangeAttempt,
} from '@/lib/review-timestamp-feedback';

type Props = {
  runId: string;
  agentSlug?: string | null;
  agentName: string;
  artifacts: ReviewArtifact[];
  production: ReviewProduction;
  issues: ReviewIssue[];
  session: ReviewSession;
  reviewArtifacts: ReviewSessionArtifact[];
  sources: Record<string, SourceState>;
  isApprovalHold: boolean;
  /**
   * Open on this artifact (e.g. a generated-clip deep link). Honored only when it
   * names an artifact present in this packet; otherwise the preferred artifact is
   * used as before.
   */
  initialArtifactId?: string | null;
  /** Backend-computed lineage. Used only to identify this exact revision, never to infer one. */
  versions?: ReviewVersion[];
  currentVersionLabel?: string | null;
};

const ISSUE_KINDS = ['timing', 'content', 'visual', 'audio', 'missing', 'replacement', 'other'] as const;

type ReviewArtifactPickerResult = {
  ok: boolean;
  canceled?: boolean;
  error?: string;
  artifact?: { artifactId: string; purpose: 'review_target' | 'supporting' };
};

type ReviewArtifactBridge = {
  pickReviewArtifact?: (options: {
    sessionId: string;
    purpose: 'review_target' | 'supporting';
    selection: 'file' | 'directory';
  }) => Promise<ReviewArtifactPickerResult>;
  openPostAcceptanceCleanup?: () => Promise<{ ok: boolean; error?: string }>;
};

function reviewArtifactBridge(): ReviewArtifactBridge | null {
  if (typeof window === 'undefined') return null;
  return (window as Window & { implexaDesktop?: ReviewArtifactBridge }).implexaDesktop ?? null;
}

async function reviewAction(payload: Record<string, unknown>) {
  const res = await fetch('/api/review', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({ ok: false, error: 'Unreadable response.' }));
  return { status: res.status, body } as { status: number; body: Record<string, any> };
}

function formatSignedMs(ms: number): string {
  return `${ms < 0 ? '-' : ''}${formatMs(Math.abs(ms))}`;
}

export default function ReviewRoom(props: Props) {
  const router = useRouter();
  const { runId, artifacts, production, sources, isApprovalHold } = props;

  const allArtifacts = useMemo(() => reviewableArtifacts(artifacts, production), [artifacts, production]);
  const validated = useMemo(() => allArtifacts.filter((a) => a.status === 'validated'), [allArtifacts]);
  const preferredArtifactId = useMemo(
    () => preferredReviewArtifact(artifacts, production)?.id ?? null,
    [artifacts, production],
  );
  const currentVersion = useMemo(() => versionForRun(runId, props.versions ?? []), [runId, props.versions]);
  const latestFinalOutput = useMemo(() => latestValidatedFinalOutput(artifacts), [artifacts]);
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    return resolveInitialArtifact(
      props.initialArtifactId ?? null,
      reviewableArtifacts(artifacts, production),
      preferredArtifactId,
    );
  });
  useEffect(() => {
    setSelectedId((current) => reconcileArtifactSelection(current, allArtifacts, preferredArtifactId));
  }, [allArtifacts, preferredArtifactId]);
  const artifact = useMemo(() => allArtifacts.find((a) => a.id === selectedId) ?? null, [allArtifacts, selectedId]);
  const selectedSegment = useMemo(() => segmentForArtifact(production, selectedId), [production, selectedId]);
  const proxyPreview = selectedSegment !== null;
  const renderControl = useMemo(() => finalRenderControl(production), [production]);

  // BOUND to its artifact, for the same reason `preview` is: an unbound decision is
  // read by the cleanup effect in the flush where selection has already moved on, and
  // artifact A's failure then cancels artifact B's pending seek.
  const [decision, setDecision] = useState<{ artifactId: string | null; value: PreviewDecision } | null>(null);
  // The URL is BOUND to the artifact it was minted for. A bare string cannot tell
  // you which file is on screen, which is what made the seek race possible.
  const [preview, setPreview] = useState<{ url: string; artifactId: string } | null>(null);
  const tokenRef = useRef<string | null>(null);
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);
  // The still-image element, so the spatial overlay can measure it the same way it
  // measures a video. Separate from mediaRef: an image is not a media element and
  // must never receive playhead reads.
  const imageRef = useRef<HTMLImageElement | null>(null);
  const railListRef = useRef<HTMLDivElement | null>(null);
  /**
   * SINGLE-FLIGHT ACROSS CLICKS, not across renders — a ref because it must be
   * readable and writable before React commits anything. Same pattern, and the same
   * hazard, as `createFlight`/`beginProposalCreate` on the generation-entry path.
   */
  const submitFlightRef = useRef(false);
  const resolutionFlightRef = useRef(false);

  const [issues, setIssues] = useState<ReviewIssue[]>(props.issues);
  const [session, setSession] = useState<ReviewSession>(props.session);
  const [busy, setBusy] = useState(false);
  const [cleanupPrompt, setCleanupPrompt] = useState(false);
  const [cleanupBusy, setCleanupBusy] = useState(false);
  const cleanupDialogRef = useRef<HTMLDivElement | null>(null);
  const cleanupDismissRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!cleanupPrompt) return;
    const dialog = cleanupDialogRef.current;
    cleanupDismissRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !cleanupBusy) {
        event.preventDefault();
        setCleanupPrompt(false);
        return;
      }
      if (event.key !== 'Tab' || !dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled])'));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [cleanupBusy, cleanupPrompt]);

  /**
   * ADOPT THE DURABLE SESSION WHEN THE SERVER SENDS A NEWER ONE.
   *
   * `session` is seeded from props ONCE. Next keeps this component mounted across
   * `router.refresh()`, so without this the room would keep answering from the row it
   * read on first render — a submitted session would still look like a draft, and a
   * second tab would go on offering to send work that has already been sent.
   *
   * Guarded by identity: a session this tab created with `ensureSession` must not be
   * replaced by a stale `null`, and two different sessions never overwrite each other.
   */
  useEffect(() => {
    const incoming = props.session;
    if (!incoming) return;
    setSession((current) => (!current || current.id === incoming.id || ['draft', 'submitting'].includes(incoming.state)
      ? incoming : current));
  }, [props.session]);
  useEffect(() => { setIssues(props.issues); }, [props.issues]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [artifactPicker, setArtifactPicker] = useState<null | 'review_target' | 'supporting_file' | 'supporting_folder'>(null);
  const [pendingExternalArtifactId, setPendingExternalArtifactId] = useState<string | null>(null);

  useEffect(() => {
    if (!pendingExternalArtifactId || !allArtifacts.some((entry) => entry.id === pendingExternalArtifactId)) return;
    setSelectedId(pendingExternalArtifactId);
    setPendingExternalArtifactId(null);
  }, [allArtifacts, pendingExternalArtifactId]);

  // ── the two positions ─────────────────────────────────────────────────────
  //
  // THE AUTHORITATIVE PLAYHEAD for the selected artifact. Null means this artifact has
  // no media position at all (an image, a text file, a player that never loaded) —
  // which is a different fact from "at zero", and the copy says so.
  //
  // There is deliberately no `pausedAtMs` any more. A last-pause position offered as
  // the place feedback will land is the production bug: scrub to 1s after pausing at
  // 3.042s and the button both said and meant 00:03.042.
  const [playheadMs, setPlayheadMs] = useState<number | null>(null);
  // The composer, carrying its FROZEN anchor. Its presence IS "the composer is open" —
  // an open flag separate from the anchor is how a composer ends up on screen with a
  // position nobody snapshotted.
  const [draft, setDraft] = useState<FeedbackDraft | null>(null);
  // A range in progress: START frozen (with its file and digest), END still following
  // the playhead. A separate state from the draft because until the end is taken there
  // is nothing to write yet — and because an abandoned range must be visibly abandoned,
  // not silently become a point comment.
  const [pendingRange, setPendingRange] = useState<PendingRange>(null);
  // ONLY that the user pressed something — never the refusal itself. A stored refusal
  // outlives the state it described: "The end of the range must come after the start."
  // stayed on screen beside `Start 00:00.000 → Set end at 03:42.147`, telling a reviewer
  // who had already fixed it by scrubbing that they had not.
  const [rangeAttempt, setRangeAttempt] = useState<RangeAttempt>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [textTruncated, setTextTruncated] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // A seek requested for an artifact that is not on screen. It carries the artifact id
  // so it can never be applied to a different file.
  const [pendingSeek, setPendingSeek] = useState<PendingSeek>(null);
  // The spatial issue the reviewer OPENED (clicked in the rail or on a pin) — its
  // geometry renders on the surface even when the playhead is not on its second.
  const [openedIssueId, setOpenedIssueId] = useState<string | null>(null);
  // The last evidence-status poll, verbatim. Null = no successful read yet, which the
  // gate treats as UNKNOWN (blocked), never as "no evidence required".
  const [evidenceStatus, setEvidenceStatus] = useState<SessionEvidenceStatus>(null);

  const reviewerResolved = useMemo(() => issues.filter((i) => !!i.reviewerResolution), [issues]);
  const activeIssues = useMemo(
    () => issues.filter((i) => i.status !== 'dismissed' && !i.reviewerResolution),
    [issues],
  );
  const drafts = useMemo(() => activeIssues.filter((i) => i.status === 'draft'), [activeIssues]);
  const unresolvedPrior = useMemo(() => activeIssues.filter((i) => i.status !== 'draft'), [activeIssues]);
  const revisionIssueIds = useMemo(() => activeIssues.map((i) => i.id), [activeIssues]);
  const ordered = useMemo(() => sortIssues(issues), [issues]);
  // The single source of truth for what may be offered and said. Re-deriving these
  // inline is how a panel ends up claiming "Accepted" beside a live "Request fixes".
  const acts = reviewRoomActions({
    sessionState: (session?.state as never) ?? null,
    draftCount: activeIssues.length,
    isApprovalHold,
  });
  const visible = useMemo(() => ordered.filter((i) => i.status !== 'dismissed' && !i.reviewerResolution), [ordered]);
  // THE RAIL'S CONTENTS. File-first, then each file's own clock — never one global
  // timestamp order across files, which interleaved Chapter1/2/3 as though they shared
  // a timeline. `visible` is already filtered, so every group's count is exactly what
  // that group renders.
  const groups = useMemo(() => groupIssuesByArtifact(visible, artifacts), [visible, artifacts]);

  // ── the send-changes action ───────────────────────────────────────────────
  // Local intent only. The DURABLE session row outranks it, so a reload or a second
  // tab reads the queued revision instead of re-offering the send button.
  const [localSubmission, setLocalSubmission] = useState<SubmissionState>(INITIAL_SUBMISSION_STATE);
  // THE REVISION FINISHED (2026-08-23). `submitted` on the session row is durable
  // and correct — it says the fixes WERE sent — but it is not a statement about
  // what happened next, and this block treated it as one: a continuation that had
  // already delivered nine artifacts and a final MP4 kept rendering "Revision
  // queued" with a retry offer beneath it, forever. The recovery panel reads the
  // exact request and knows better; this is where it gets to say so.
  const [revisionCompleted, setRevisionCompleted] =
    useState<{ runId: string | null; completedAt: string | null } | null>(null);
  const [revisionNote, setRevisionNote] = useState('');
  // Review is file-first by default. The exact reviewed/attached artifact set is a
  // complete immutable handoff even when the originating run predates input-context
  // capture. `inherit` remains an explicit advanced choice for a reviewer who knows
  // the original run has a complete durable input contract.
  const [revisionMode, setRevisionMode] = useState<'inherit' | 'selected_files'>('selected_files');
  const [patternSourceIssueIds, setPatternSourceIssueIds] = useState<string[]>([]);
  const [patternCandidate, setPatternCandidate] = useState<ReviewPatternApplication | null>(null);
  const [patternCandidateEvidenceKey, setPatternCandidateEvidenceKey] = useState<string | null>(null);
  const [patternBusy, setPatternBusy] = useState(false);
  const submission = phaseForSession({
    sessionState: session?.state ?? null,
    submittedRequestId: session?.submittedRequestId ?? null,
    submittedIssueIds: session?.submittedIssueIds ?? null,
    local: localSubmission,
  });
  // PINNED AND CARRIED. implexa-backend@8c0f71d takes the note as `revisionNote` on
  // the submit body, trims it and bounds it at REVISION_NOTE_MAX; `resolveReviewAction`
  // applies the same rules before anything leaves the browser, so what the reviewer
  // sees, what is sent, and what is stored are the same string.
  const NOTE_ENABLED = true;
  const submitView = reviewSubmissionView({
    state: submission, draftCount: activeIssues.length, busy, noteEnabled: NOTE_ENABLED,
  });
  // ONLY this artifact's issues may be drawn on it. An issue about another file has no
  // position on this timeline, and rendering it there invents one.
  const surfaceIssues = useMemo(
    () => issuesForArtifact(visible, selectedId),
    [visible, selectedId],
  );
  // EDITING CLOSES THE MOMENT A SUBMISSION IS IN FLIGHT, not merely once the durable
  // row catches up. `acts` reads the session row, which still says `draft` while this
  // tab's request is open — leaving the rail editable over a set that is already being
  // snapshotted server-side.
  const submissionInFlight = submission.phase === 'preparing' || submission.phase === 'submitting';
  const frozen = proxyPreview || submissionInFlight
    || (!acts.canEditIssues && session?.state !== 'accepted' && !isApprovalHold);
  const accepted = session?.state === 'accepted';
  const canAttachReviewFiles = sources.review_artifacts === 'ready'
    && (!session || session.state === 'draft') && !submissionInFlight && !accepted;
  // An externally opened review target is not part of the original run lineage. It
  // therefore cannot truthfully use `inherit`, even if the reviewer never opens the
  // advanced revision options. The durable target binding is the authority here; a
  // transient picker result or local selection is not.
  const hasExternalReviewTarget = (props.reviewArtifacts ?? [])
    .some((entry) => entry.purpose === 'review_target');
  const effectiveRevisionMode = hasExternalReviewTarget ? 'selected_files' : revisionMode;
  const supportingReviewFiles = (props.reviewArtifacts ?? []).filter((entry) => entry.purpose === 'supporting');

  // The reviewer, not the model, chooses which exact comments demonstrate a shared
  // defect. Only active artifact-bound comments are eligible. The ordered issue rail
  // fixes disclosure order, so checking the same set twice sends byte-identical
  // evidence regardless of click order.
  const activeIssueIds = useMemo(() => new Set(activeIssues.map((issue) => issue.id)), [activeIssues]);
  const patternEligibleIssues = useMemo(
    () => ordered.filter((issue) => activeIssueIds.has(issue.id) && !!issue.artifactId),
    [ordered, activeIssueIds],
  );
  const patternEligibleIssueIds = useMemo(
    () => new Set(patternEligibleIssues.map((issue) => issue.id)),
    [patternEligibleIssues],
  );
  const patternSourceIssues = useMemo(() => {
    const selected = new Set(patternSourceIssueIds);
    return patternEligibleIssues.filter((issue) => selected.has(issue.id));
  }, [patternEligibleIssues, patternSourceIssueIds]);
  const patternEvidenceKey = useMemo(() => JSON.stringify(patternSourceIssues.map((issue) => ({
    id: issue.id,
    artifactId: issue.artifactId,
    kind: issue.kind,
    anchor: issue.anchor,
    body: issue.body,
  }))), [patternSourceIssues]);

  useEffect(() => {
    if (patternCandidate && patternCandidateEvidenceKey !== patternEvidenceKey) {
      setPatternCandidate(null);
      setPatternCandidateEvidenceKey(null);
    }
  }, [patternCandidate, patternCandidateEvidenceKey, patternEvidenceKey]);

  // ── preview lifecycle ─────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const prevToken = tokenRef.current;
    // Switching artifact or version revokes the previous token immediately rather than
    // leaving a live capability pointing at a file the user is no longer reviewing.
    if (prevToken) { revokePreview(prevToken); tokenRef.current = null; }
    setPreview(null);
    setTextContent(null);
    setTextTruncated(false);
    // Per-artifact draft state does not survive a switch: a position captured in the
    // previous file would anchor the next comment to a moment in a different video, and
    // an in-progress composer carried across would attach to the new file at a moment
    // it was never about. The playhead goes back to "no position", not to zero — the
    // new file has not told us anything yet.
    setPlayheadMs(null);
    setDraft(null);
    // An unfinished range dies with the file it was started in. Carrying a start time
    // into the next video would mark a span nobody selected.
    setPendingRange(null);
    setRangeAttempt(null);
    // The opened spatial issue is NOT cleared here: opening an issue on another file
    // switches first, and the highlight must survive that switch. Retargeting is
    // impossible anyway — the render below only draws it on the issue's OWN artifact.

    const base = decidePreview({
      artifact,
      inDesktop: inDesktopApp(),
      bridgeSupported: desktopPreviewSupported(),
    });
    setDecision({ artifactId: artifact?.id ?? null, value: base });
    if (base.state !== 'loading' || !artifact) return;

    (async () => {
      const identity = previewRequestIdentity(artifact);
      const result = await requestPreview(identity.runId, identity.artifactId);
      if (cancelled) return;
      const next = interpretPreviewResult(result, base.kind);
      setDecision({ artifactId: artifact.id, value: next });
      if (next.state !== 'ready') return;
      const url = (result as { url?: string }).url;
      // ONE SOURCE FOR THE TOKEN: the URL we are actually going to load.
      //
      // Previously the token was read from a separate `result.token` field, so a
      // malformed bridge response could put token B in the URL while cleanup revoked
      // token A — displaying one capability and releasing another, leaving the displayed
      // one live until it expired. Deriving it from the parsed URL makes that
      // unrepresentable rather than merely unlikely.
      const parsed = parsePreviewUrl(url);
      if (!parsed) {
        setDecision({ artifactId: artifact.id, value: { ...next, state: 'unavailable', message: 'The preview link was not in an expected form, so it was not opened.' } });
        return;
      }
      tokenRef.current = parsed.token;
      setPreview({ url: url!, artifactId: artifact.id });
      if (base.kind === 'text') {
        // The text comes back ON THE BRIDGE RESPONSE, not from the preview URL.
        //
        // This used to be `fetch(url)`, which can never work: Chromium refuses fetch()
        // to a non-http(s) scheme from an http(s) page before any handler runs, so every
        // markdown/json/txt/csv preview failed with an opaque "Failed to fetch". Media
        // and image elements are no-cors and unaffected, which is why it looked fine.
        const text = previewText(result);
        if (text === null) {
          if (!cancelled) setDecision({ artifactId: artifact.id, value: { ...next, state: 'unavailable', message: 'Implexa could not read this file for review just now. That does not mean the file is gone.' } });
          return;
        }
        if (!cancelled) { setTextContent(text); setTextTruncated(previewTextTruncated(result)); }
      }
    })();

    return () => {
      cancelled = true;
      if (tokenRef.current) { revokePreview(tokenRef.current); tokenRef.current = null; }
    };
  }, [artifact, runId]);

  // ── issue creation ────────────────────────────────────────────────────────
  /**
   * The session's selected artifact is NOT decoration, and it is NOT free to be the
   * live selection when a draft is being saved.
   *
   * `session.selected_artifact_id` is the ONLY file the compiled revision brief names
   * — it prints one "Primary artifact" line and never each issue's own path. So a
   * session opened for file B while the issue is recorded against file A hands the
   * agent a brief that names the wrong file, with no per-issue path to contradict it.
   * The caller therefore passes the identity it is actually writing about: the FROZEN
   * draft target for an issue, the live selection for a session-level act like accept.
   */
  const ensureSession = useCallback(async (artifactId: string | null): Promise<string | null> => {
    if (session?.id) return session.id;
    const { body } = await reviewAction({ action: 'ensure_session', runId, artifactId });
    if (body?.ok && body.session) { setSession(body.session); return body.session.id as string; }
    setError(body?.error || 'Could not open a review session.');
    return null;
  }, [session, runId]);

  const pickReviewArtifact = useCallback(async (
    purpose: 'review_target' | 'supporting', selection: 'file' | 'directory',
  ) => {
    const bridge = reviewArtifactBridge();
    if (!bridge?.pickReviewArtifact) {
      setError('Open Review Room in the Implexa desktop app to choose a local file or folder.');
      return;
    }
    setError(null);
    const pickerState = purpose === 'review_target' ? 'review_target'
      : selection === 'directory' ? 'supporting_folder' : 'supporting_file';
    setArtifactPicker(pickerState);
    try {
      const sessionId = await ensureSession(selectedId);
      if (!sessionId) return;
      const result = await bridge.pickReviewArtifact({ sessionId, purpose, selection });
      if (!result?.ok) {
        if (!result?.canceled) setError(result?.error || 'That review file could not be safely attached.');
        return;
      }
      if (!result.artifact?.artifactId || result.artifact.purpose !== purpose) {
        setError('The attached review file could not be verified. Reload before continuing.');
        return;
      }
      if (purpose === 'review_target') setPendingExternalArtifactId(result.artifact.artifactId);
      setNotice(purpose === 'review_target'
        ? 'Other file added to this review.'
        : selection === 'directory' ? 'Folder frozen and attached to this revision.' : 'File attached to this revision.');
      router.refresh();
    } catch {
      setError('That review file could not be safely attached.');
    } finally {
      setArtifactPicker(null);
    }
  }, [ensureSession, router, selectedId]);

  /**
   * A submitted session carries a REQUEST id, not necessarily a run id. Resolve it
   * before navigating: a completed continuation opens its child Review Room; a failed
   * request with no child opens the agent's request-aware runs surface.
   */
  const openSubmittedRevision = useCallback(async () => {
    if (!session?.id) return;
    setError(null);
    setBusy(true);
    try {
      const { body } = await reviewAction({ action: 'continuation_status', sessionId: session.id });
      if (!body?.ok) { setError(body?.error || 'Could not locate that revision attempt.'); return; }
      if (body.resultRunId) {
        router.push(`/review/${encodeURIComponent(String(body.resultRunId))}`);
        return;
      }
      if (props.agentSlug && body.requestId) {
        router.push(`/workflows/${encodeURIComponent(props.agentSlug)}?tab=runs&retryRequest=${encodeURIComponent(String(body.requestId))}`);
        return;
      }
      setError(body.failureReason || 'This revision did not create a result run. Its request is shown above for support and retry.');
    } catch {
      setError('Could not locate that revision attempt.');
    } finally {
      setBusy(false);
    }
  }, [session, router, props.agentSlug]);

  /**
   * Preserve the submitted round and open an editable successor only when the backend
   * proves the exact bound continuation is terminal failure/cancellation. The server
   * carries the submitted issue snapshot forward; the browser never reconstructs it.
   */
  const amendFailedRevision = useCallback(async () => {
    if (!session?.id) return;
    setError(null);
    setBusy(true);
    try {
      const { body } = await reviewAction({ action: 'amend_failed_revision', sessionId: session.id });
      if (!body?.ok) {
        if (body?.resultRunId) router.push(`/review/${encodeURIComponent(String(body.resultRunId))}`);
        else setError(body?.error || 'Could not open another feedback round.');
        return;
      }
      if (!body.session?.id || !Array.isArray(body.issues)) {
        setError('The new feedback round could not be verified. Reload before editing.');
        return;
      }
      setSession(body.session as ReviewSession);
      setIssues(body.issues as ReviewIssue[]);
      setLocalSubmission(INITIAL_SUBMISSION_STATE);
      setRevisionNote('');
      setEvidenceStatus(null);
      setDraft(null);
      setNotice(`${Number(body.carriedIssueCount) || body.issues.length} submitted change${body.issues.length === 1 ? '' : 's'} carried into a new draft. Add more feedback, then send one replacement revision.`);
      router.refresh();
    } catch {
      setError('Could not open another feedback round. Your submitted feedback is unchanged.');
    } finally {
      setBusy(false);
    }
  }, [session, router]);

  const addMoreFeedback = useCallback(async () => {
    setError(null); setNotice(null); setBusy(true);
    try {
      const action = session?.id
        ? { action: 'add_feedback', sessionId: session.id }
        : { action: 'ensure_session', runId, artifactId: selectedId };
      const { body } = await reviewAction(action);
      if (!body?.ok || !body.session?.id) {
        setError(body?.error || 'Could not open a feedback round.');
        return;
      }
      setSession(body.session as ReviewSession);
      setLocalSubmission(INITIAL_SUBMISSION_STATE);
      setRevisionNote('');
      setEvidenceStatus(null);
      setNotice('Add feedback when you’re ready. Unresolved earlier issues will stay in the next revision.');
      router.refresh();
    } catch {
      setError('Could not open a feedback round. Existing feedback is unchanged.');
    } finally { setBusy(false); }
  }, [session, runId, selectedId, router]);

  const resolveIssues = useCallback(async (issueIds: string[]) => {
    if (!session?.id || !issueIds.length || resolutionFlightRef.current) return;
    resolutionFlightRef.current = true;
    setError(null); setNotice(null); setBusy(true);
    try {
      const { body } = await reviewAction({ action: 'resolve_issues', sessionId: session.id, issueIds });
      if (!body?.ok || !Array.isArray(body.resolutions)) {
        setError(body?.error || 'Could not mark that feedback resolved.');
        return;
      }
      const byIssue = new Map(body.resolutions.map((r: Record<string, unknown>) => [String(r.issueId), r]));
      setIssues((current) => current.map((issue) => {
        const resolution = byIssue.get(issue.id);
        return resolution ? { ...issue, reviewerResolution: resolution as ReviewIssue['reviewerResolution'] } : issue;
      }));
      setLocalSubmission(INITIAL_SUBMISSION_STATE);
      setNotice(issueIds.length === 1 ? 'Marked as resolved.' : `${issueIds.length} issues marked as resolved.`);
      router.refresh();
    } catch {
      setError('Could not verify the resolution. Reload before trying again.');
    } finally {
      resolutionFlightRef.current = false;
      setBusy(false);
    }
  }, [session, router]);

  /**
   * The anchor is built from the DRAFT, never from the player.
   *
   * `mediaRef.current.currentTime` read at save time is the same bug one layer down:
   * the reviewer opened the composer at 00:01, wrote a sentence while the clip kept
   * playing, and the comment landed wherever playback happened to be when they hit
   * Save. The frozen value is the one they aimed at.
   */
  const buildAnchor = useCallback((d: FeedbackDraft | null): ReviewAnchor | null => {
    // THE DRAFT'S OWN DIGEST, not the selected artifact's. Reading `artifact.sha256`
    // here would anchor a comment written about file A to file B's bytes the moment the
    // selection moved — an anchor that is internally valid and about the wrong file, so
    // the backend accepts it and nothing downstream can tell.
    const sha = d?.target.sha256;
    if (!sha || !d) return null;
    // A spatial draft ALSO carries a frozen time (video) — the on-picture mark decides
    // the anchor version, and the v2 builder folds that time into `temporal`.
    if (d.spatial) return spatialAnchorFromDraft(d);
    if (d.selection) return buildTextAnchor(sha, d.selection.start, d.selection.end, d.selection.quote);
    if (d.anchorMs !== null) {
      return buildMediaAnchor(sha, d.anchorMs / 1000, d.rangeEndMs === null ? null : d.rangeEndMs / 1000);
    }
    return buildArtifactAnchor(sha);
  }, []);

  /**
   * A saved spatial issue immediately asks the backend for its screenshot evidence
   * (0155 review_request_evidence). Fire-and-forget on purpose: the capture is the
   * Desktop's job and the submit gate polls for the outcome — a failed request here
   * surfaces through that poll as "waiting", never as a lost save.
   */
  const requestEvidence = useCallback(async (issueId: string) => {
    try {
      const { body } = await reviewAction({ action: 'request_evidence', issueId });
      if (body?.ok && session?.id) {
        const { body: status } = await reviewAction({ action: 'evidence_status', sessionId: session.id });
        if (status?.ok) setEvidenceStatus({ state: status.state, issues: status.issues || [] });
      }
    } catch { /* the poll owns the outcome */ }
  }, [session]);

  const submitIssue = useCallback(async () => {
    setError(null);
    const d = draft;
    const anchor = buildAnchor(d);
    const aErr = anchorError(anchor);
    if (aErr) { setError(aErr); return; }
    const bErr = bodyError(d?.body ?? '');
    if (bErr) { setError(bErr); return; }
    setBusy(true);
    try {
      // EDITING an existing draft is an UPDATE, never a second create. A create here is
      // the edit-as-create regression: the rail shows the comment twice and the agent
      // is asked to fix the same thing twice, once with the text the user replaced.
      const route = saveActionFor(d);
      const editingId = route?.action === 'update_issue' ? route.issueId : null;
      if (editingId) {
        const { body } = await reviewAction({
          action: 'update_issue', issueId: editingId,
          kind: d!.kind, anchor, body: d!.body.trim(),
        });
        if (!body?.ok) {
          setError(body?.staleAnchor
            ? 'This file changed since you opened it, so the comment could not be re-anchored. Reload to review the current version.'
            : (body?.error || 'Could not save that change.'));
          return;
        }
        setIssues((prev) => {
          const existing = prev.find((i) => i.id === editingId);
          // A response that omits the row is not a licence to invent one: fall back to
          // the values we just sent, still keyed to the SAME id.
          const updated = (body.issue && body.issue.id)
            ? body.issue
            : { ...(existing as ReviewIssue), kind: d!.kind, anchor: anchor as never, body: d!.body.trim() };
          return replaceIssue(prev, editingId, updated);
        });
        setDraft(null); setRangeAttempt(null);
        // An edit may have moved the pin, which revoked the old frame server-side.
        // Re-request so the issue does not sit blocked on a capture nobody re-asked for.
        if (anchor && isSpatialAnchorV2(anchor)) void requestEvidence(editingId);
        return;
      }

      // THE FROZEN FILE, here too. A session opened for the live selection while this
      // issue is recorded against the draft's file puts the wrong "Primary artifact"
      // at the head of the revision brief — the one place the agent is told what it is
      // looking at.
      const sid = await ensureSession(d!.target.artifactId);
      if (!sid) return;
      const { body } = await reviewAction({
        // The FROZEN file, for the same reason as the digest above.
        action: 'create_issue', sessionId: sid, artifactId: d!.target.artifactId,
        kind: d!.kind, anchor, body: d!.body.trim(),
      });
      if (!body?.ok) {
        setError(body?.staleAnchor
          ? 'This file changed since you opened it, so the comment could not be anchored. Reload to review the current version.'
          : (body?.error || 'Could not save that issue.'));
        return;
      }
      setIssues((prev) => [...prev, body.issue]);
      setDraft(null); setRangeAttempt(null);
      // A saved spatial issue starts its evidence capture NOW — waiting for submit to
      // ask would serialize every capture behind the reviewer's slowest comment.
      if (body.issue?.id && anchor && isSpatialAnchorV2(anchor)) void requestEvidence(body.issue.id);
    } finally { setBusy(false); }
    // NOT `artifact`: every identity this path writes now comes from the draft.
  }, [buildAnchor, draft, ensureSession, requestEvidence]);

  const dismissIssue = useCallback(async (issueId: string) => {
    setBusy(true); setError(null);
    try {
      const { body } = await reviewAction({ action: 'dismiss_issue', issueId });
      if (!body?.ok) { setError(body?.error || 'Could not delete that issue.'); return; }
      setIssues((prev) => prev.map((i) => (i.id === issueId ? { ...i, status: 'dismissed' } : i)));
    } finally { setBusy(false); }
  }, []);

  /**
   * Moves the PLAYHEAD only. An open draft's frozen anchor is untouched on purpose:
   * jumping to another comment to compare it must not silently re-point the one being
   * written.
   */
  const seekTo = useCallback((ms: number) => {
    const el = mediaRef.current;
    if (!el) return;
    el.currentTime = ms / 1000;
    el.pause();
    setPlayheadMs(ms);
  }, []);

  /**
   * The ONE place the playhead moves in response to the player: timeupdate, seeked,
   * pause and loadedmetadata all land here. Scrubbing without ever pausing is the case
   * the old code could not see, and it is the common one.
   */
  const onPlayhead = useCallback((eventArtifactId: string, seconds: number) => {
    const next = playheadFromEvent({ eventArtifactId, selectedArtifactId: selectedId, seconds });
    if (next === null) return;
    setPlayheadMs(next);
  }, [selectedId]);

  const hereIssues = useMemo(
    () => draftIssuesAtSecond(issues, selectedId, playheadMs),
    [issues, selectedId, playheadMs],
  );

  // ── screenshot evidence (Wave 2) ──────────────────────────────────────────
  //
  // THE SUBMIT GATE. Every spatial draft must hold VALIDATED evidence before the send
  // action unlocks — decided by the pure gate module from the last status poll, and
  // enforced again server-side (the compile refuses) and at the executor (fail
  // closed). The browser's own instant pin preview is never called verified.
  const gate = evidenceGate({ draftIssues: activeIssues, status: evidenceStatus });

  useEffect(() => {
    // Poll only while there is something to wait FOR: an open session, spatial drafts,
    // and a submission that has not left draft. 4s is fast enough to unlock promptly
    // and slow enough to be polite to the packet-sized read.
    const sid = session?.id;
    if (!sid || gate.reason === 'none_required' || submissionInFlight || submission.phase !== 'draft') return;
    let cancelled = false;
    const tick = async () => {
      const { body } = await reviewAction({ action: 'evidence_status', sessionId: sid });
      if (cancelled) return;
      if (body?.ok) setEvidenceStatus({ state: body.state, issues: body.issues || [] });
    };
    void tick();
    const timer = setInterval(tick, 4000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [session?.id, gate.reason, submissionInFlight, submission.phase]);

  /** Retry every failed capture — re-request, then let the poll report the outcome. */
  const retryEvidence = useCallback(async () => {
    for (const issueId of gate.retryIssueIds) await requestEvidence(issueId);
  }, [gate.retryIssueIds, requestEvidence]);

  // The freshest per-issue evidence view: the poll wins over the packet projection,
  // because the packet is only as new as the last full page load.
  const evidenceForIssue = useCallback((issue: ReviewIssue): { status?: string; ready?: boolean } | null => {
    const polled = evidenceStatus?.state === 'ready'
      ? evidenceStatus.issues.find((e) => String(e.issueId) === String(issue.id))?.evidence
      : undefined;
    if (polled !== undefined) return polled ?? null;
    return (issue as { evidence?: { status?: string; ready?: boolean } | null }).evidence ?? null;
  }, [evidenceStatus]);

  // ── the annotation surface's pins ─────────────────────────────────────────
  // Numbered within THIS artifact's spatial issues, in rail order, so the pin a
  // reviewer sees and the card they read agree about which mark is which. For video,
  // a pin shows on its own frozen second (and always when opened); an image shows all.
  const spatialSurfaceIssues = useMemo(
    () => surfaceIssues.filter((i) => isSpatialAnchorV2(i.anchor as never)),
    [surfaceIssues],
  );
  const overlayPins = useMemo<OverlayPin[]>(() => {
    const second = displayedSecond(playheadMs);
    return spatialSurfaceIssues.map((issue, index) => {
      const anchor = issue.anchor as never as {
        temporal: { startMs: number } | null;
        geometry: OverlayPin['geometry'];
      };
      const visible = !anchor.temporal
        || issue.id === openedIssueId
        || (second !== null && displayedSecond(anchor.temporal.startMs) === second);
      return visible ? {
        issueId: issue.id,
        ordinal: index + 1,
        geometry: anchor.geometry,
        highlighted: issue.id === openedIssueId,
        title: issue.body,
      } : null;
    }).filter((p): p is OverlayPin => p !== null);
  }, [spatialSurfaceIssues, playheadMs, openedIssueId]);

  // DERIVED, not stored. Scrubbing past the start clears "the end must come after the
  // start" by itself, because the sentence is only ever a reading of the state it is
  // about — never a note left behind by an earlier one.
  const rangeError = liveRangeError({ attempt: rangeAttempt, range: pendingRange, playheadMs });

  /**
   * WHICH FILE the next comment is about, captured whole. Everything a draft or a
   * range freezes comes from here, so the four fields can never disagree with each
   * other about which artifact they describe.
   */
  const targetIdentity = useMemo<FrozenTarget>(() => ({
    artifactId: artifact?.id ?? null,
    sha256: artifact?.sha256 ?? null,
    relativePath: artifact?.relativePath ?? null,
    role: artifact?.role ?? null,
  }), [artifact]);

  /**
   * THE SPATIAL FREEZE, invoked synchronously inside the overlay's pointer-down. For
   * video it pauses playback IMMEDIATELY and reads the exact timestamp in the same
   * synchronous turn — the frame the reviewer pressed on, not wherever playback
   * drifted by pointer-up or React's next commit. For an image there is no clock and
   * the answer is null.
   */
  const freezeMediaForAnnotation = useCallback((): number | null => {
    const el = mediaRef.current;
    if (!el || !(el instanceof HTMLVideoElement)) return null;
    el.pause();
    const ms = Math.round(Math.max(0, el.currentTime) * 1000);
    setPlayheadMs(ms);
    return ms;
  }, []);

  /** A completed click/drag on the picture: open the composer over the frozen mark. */
  const onSpatialAnnotate = useCallback((args: { spatial: DraftSpatial; frozenTimestampMs: number | null }) => {
    setError(null); setRangeAttempt(null);
    if (!canReplaceDraft(draft)) { setError(DRAFT_IN_PROGRESS); return; }
    setPendingRange(null);
    setOpenedIssueId(null);
    setDraft(openSpatialDraft({
      target: targetIdentity,
      frozenTimestampMs: args.frozenTimestampMs,
      spatial: args.spatial,
    }));
  }, [draft, targetIdentity]);

  /** Arrow-key nudge of an unsaved point — the keyboard's half of placement. */
  const onNudgeDraft = useCallback((next: { x: number; y: number }) => {
    setDraft((d) => (d?.spatial && d.spatial.geometry.kind === 'point'
      ? { ...d, spatial: { ...d.spatial, geometry: { ...d.spatial.geometry, x: next.x, y: next.y } } }
      : d));
  }, []);

  /**
   * Escape cancels an UNSAVED annotation. One with typed text keeps the no-silent-loss
   * rule every other affordance follows: the composer's own Cancel is the explicit act
   * for that.
   */
  const cancelSpatialDraft = useCallback(() => {
    setDraft((d) => (d?.spatial && d.body.trim() === '' ? null : d));
  }, []);

  /** Open a NEW point composer, freezing the current playhead and file into it. */
  const openPointComment = useCallback(() => {
    setError(null); setRangeAttempt(null);
    if (!canReplaceDraft(draft)) { setError(DRAFT_IN_PROGRESS); return; }
    setPendingRange(null);
    setDraft(openDraft({ target: targetIdentity, playheadMs }));
  }, [draft, targetIdentity, playheadMs]);

  /** Begin a range: the start and its file freeze here, the end follows the playhead. */
  const startRange = useCallback(() => {
    setError(null); setRangeAttempt(null);
    if (!canReplaceDraft(draft)) { setError(DRAFT_IN_PROGRESS); return; }
    const begun = beginRange({ target: targetIdentity, playheadMs });
    // Record only THAT it was refused. Which refusal to show — if any still applies —
    // is re-decided from live state every render.
    if (begun.error) { setRangeAttempt('begin'); return; }
    setDraft(null);
    setPendingRange(begun.range);
  }, [draft, targetIdentity, playheadMs]);

  /** Take the current playhead as the end. A refusal changes nothing. */
  const finishRange = useCallback(() => {
    setError(null);
    const done = completeRange(pendingRange, playheadMs);
    if (done.error || !done.draft) { setRangeAttempt('end'); return; }
    setRangeAttempt(null);
    setDraft(done.draft);
    setPendingRange(null);
  }, [pendingRange, playheadMs]);

  const cancelRange = useCallback(() => { setPendingRange(null); setRangeAttempt(null); }, []);

  /** Reopen an existing DRAFT issue on its own file, anchor, body and kind. */
  const startEdit = useCallback((issue: ReviewIssue) => {
    setError(null); setRangeAttempt(null);
    // The target is the issue's OWN file. draftFromIssue refuses a mismatch, so an edit
    // can never be opened against whatever happens to be on screen.
    const next = draftFromIssue(issue as never, targetIdentity);
    if (!next) { setError('Only unsent feedback about the file you are viewing can be edited here.'); return; }
    if (!canReplaceDraft(draft)) { setError(DRAFT_IN_PROGRESS); return; }
    setPendingRange(null);
    setDraft(next);
  }, [draft, targetIdentity]);

  /**
   * Clicking an issue. If it belongs to another artifact we SWITCH FIRST and seek once
   * the new player exists — seeking now would move the wrong file to that timestamp.
   */
  const goToIssue = useCallback((issue: ReviewIssue) => {
    const target = issueClickTarget(issue, selectedId);
    // Opening a SPATIAL issue also renders its geometry on the surface — after the
    // switch and the seek land, the pin must be visible at its frozen place.
    const spatial = isSpatialAnchorV2(issue.anchor as never);
    if (target.needsSwitch && target.artifactId) {
      setSelectedId(target.artifactId);
      // Identity travels WITH the request, so a further switch before B loads cannot
      // apply B's timestamp to C.
      setPendingSeek(target.seekMs === null ? null : { artifactId: target.artifactId, seekMs: target.seekMs });
      setOpenedIssueId(spatial ? issue.id : null);
      return;
    }
    if (target.seekMs !== null) seekTo(target.seekMs);
    setOpenedIssueId(spatial ? issue.id : null);
  }, [selectedId, seekTo]);

  /**
   * Apply the pending seek WHEN THE NEW PLAYER REPORTS READY (loadedmetadata), not from
   * an effect that races the preview lifecycle. The three-way agreement is checked here:
   * the request, the selection, and the loaded preview must all name the same artifact.
   */
  const onMediaReady = useCallback(() => {
    if (!shouldApplySeek({
      pending: pendingSeek,
      selectedArtifactId: selectedId,
      readyPreviewArtifactId: preview?.artifactId ?? null,
    })) return;
    seekTo(pendingSeek!.seekMs);
    setPendingSeek(null);
  }, [pendingSeek, selectedId, preview, seekTo]);

  // BELT AND BRACES on the range's file. The preview lifecycle already clears it on a
  // switch; this makes "a range belongs to one artifact" true of the state itself, so a
  // future edit to that effect cannot quietly leave a start time pointing at video A
  // while video B is on screen.
  useEffect(() => {
    if (pendingRange && !rangeSurvivesSelection(pendingRange, selectedId)) {
      setPendingRange(null);
      setRangeAttempt(null);
    }
  }, [pendingRange, selectedId]);

  // A pending seek that can never be satisfied is dropped rather than held: retaining it
  // would fire on some unrelated later load.
  useEffect(() => {
    // A decision only speaks for the artifact it was made about. While a stale one from
    // the previous artifact is still in state, it names THAT artifact — so it cannot
    // cancel a request for the newly selected one.
    const terminal = !!decision && decision.value.state !== 'ready' && decision.value.state !== 'loading';
    const failedArtifactId = terminal ? decision!.artifactId : null;
    if (shouldDropPendingSeek({ pending: pendingSeek, selectedArtifactId: selectedId, failedArtifactId })) {
      setPendingSeek(null);
    }
  }, [pendingSeek, selectedId, decision]);

  // ── actions ───────────────────────────────────────────────────────────────
  /**
   * THE REAL SUBMISSION, against implexa-backend@8c0f71d.
   *
   * Carries the revision note under the backend's own key (`revisionNote`, trimmed and
   * bounded at 2000 in `resolveReviewAction`), and reads the reply through
   * `parseSubmitResponse`, which FAILS CLOSED: no continuation id, or no
   * server-authoritative issue count, is a failure — never a success filled in from
   * local drafts.
   *
   * The transport itself is the one thing this function owns. Everything about what
   * the answer MEANS lives in the flow module, where it is executable in a test.
   */
  const onSubmit = useCallback(async (): Promise<SubmitOutcome> => {
    setBusy(true); setError(null); setNotice(null);
    try {
      const sid = session?.id;
      if (!sid) {
        setError('Nothing to submit yet.');
        return { ok: false, reason: 'refused', message: 'Nothing to submit yet.' };
      }
      const confirmedPattern = patternCandidate?.confirmedByUser
        && patternCandidateEvidenceKey === patternEvidenceKey
        ? patternCandidate
        : null;
      const { status, body } = await reviewAction({
        action: 'submit', sessionId: sid,
        // The composer's live text. `resolveReviewAction` trims it and refuses an
        // over-long note before anything leaves the browser.
        revisionNote,
        revisionMode: effectiveRevisionMode,
        ...(confirmedPattern ? { patternApplication: confirmedPattern } : {}),
      });
      // 5xx is a read the service could not make, not a verdict on the review.
      const outcome = parseSubmitResponse(body, { unavailable: status >= 500 });
      if (!outcome.ok) {
        setError(submitRefusalCopy(outcome));
        return outcome;
      }
      setNotice(outcome.idempotent
        ? 'These fixes were already requested — showing the existing revision.'
        : outcome.recovered
          ? 'An earlier attempt had already started this revision — showing that one.'
          : 'Revision queued.');
      // Refreshes the server props for everything else on the page. The queued state
      // does NOT wait for it: `session` is client state seeded once from props, so a
      // refresh alone would never move this room out of submitting.
      router.refresh();
      return outcome;
    } catch {
      // A REQUEST THAT NEVER COMPLETED — offline, navigation, abort. `fetch` rejects,
      // and without this the rejection escapes the click handler and the room sits on
      // "Sending…" with no way back to the action.
      const outcome: SubmitOutcome = { ok: false, reason: 'transport', message: null };
      setError(submitRefusalCopy(outcome));
      return outcome;
    } finally { setBusy(false); }
  }, [session, router, revisionNote, effectiveRevisionMode, patternCandidate, patternCandidateEvidenceKey, patternEvidenceKey]);

  const togglePatternSource = useCallback((issueId: string, selected: boolean) => {
    setPatternSourceIssueIds((current) => selected
      ? (current.includes(issueId) ? current : [...current, issueId])
      : current.filter((id) => id !== issueId));
    // A candidate is authority over its exact evidence set. Changing that set makes
    // it stale immediately; it may not survive until React's fingerprint effect.
    setPatternCandidate(null);
    setPatternCandidateEvidenceKey(null);
  }, []);

  const onSynthesizePattern = useCallback(async () => {
    if (!session?.id || patternSourceIssues.length < 2) return;
    setPatternBusy(true); setError(null);
    try {
      const sourceIssueIds = patternSourceIssues.map((issue) => issue.id);
      const targetArtifactIds = [...new Set(patternSourceIssues.map((issue) => issue.artifactId as string))];
      const { status, body } = await reviewAction({
        action: 'pattern_candidate',
        sessionId: session.id,
        sourceIssueIds,
      });
      if (status >= 400 || !body?.ok || !body?.candidate) {
        setError(body?.error || 'Could not synthesize a safe shared pattern.');
        return;
      }
      const candidate = parsePatternCandidate(body.candidate, { sourceIssueIds, targetArtifactIds });
      if (!candidate) {
        setError('Pattern synthesis returned a candidate outside your selected comments. Nothing was changed.');
        return;
      }
      setPatternCandidate(candidate);
      setPatternCandidateEvidenceKey(patternEvidenceKey);
      setNotice('Pattern candidate ready. Review and confirm it before sending.');
    } catch {
      setError('Pattern synthesis is unavailable. Your exact comments are unchanged.');
    } finally {
      setPatternBusy(false);
    }
  }, [session?.id, patternSourceIssues, patternEvidenceKey]);

  const onAccept = useCallback(async (discard: boolean) => {
    setBusy(true); setError(null); setNotice(null);
    try {
      // Accepting is a SESSION-level judgement about the result on screen, not about
      // one draft — so the live selection is the honest identity here. There is no
      // frozen target to prefer: this path never writes an issue.
      const sid = await ensureSession(selectedId);
      if (!sid) return;
      const { body } = await reviewAction({ action: 'accept', sessionId: sid, discardOpenIssues: discard });
      if (body?.needsDiscardConfirmation) { setConfirmDiscard(true); return; }
      if (!body?.ok) { setError(body?.error || 'Could not accept this result.'); return; }
      setConfirmDiscard(false);
      setNotice('Result accepted.');
      setCleanupPrompt(true);
      router.refresh();
    } finally { setBusy(false); }
  }, [ensureSession, router, selectedId]);

  const openPostAcceptanceCleanup = useCallback(async () => {
    const bridge = reviewArtifactBridge();
    if (!bridge?.openPostAcceptanceCleanup) {
      setCleanupPrompt(false);
      setNotice('Open Implexa Desktop → Storage to review local cleanup.');
      return;
    }
    setCleanupBusy(true);
    try {
      const result = await bridge.openPostAcceptanceCleanup();
      if (!result?.ok) {
        setError(result?.error || 'Could not open local storage cleanup.');
        return;
      }
      setCleanupPrompt(false);
    } catch {
      setError('Could not open local storage cleanup.');
    } finally {
      setCleanupBusy(false);
    }
  }, []);

  /**
   * THE ONE ACTION. draft -> preparing -> submitting -> revision_queued, all of it in
   * this room. There is no second approval page: the previous flow sent the reviewer
   * to the run's approval gate, which does not carry their issues.
   *
   * ONE DECISIVE CLICK. It freezes the count and sends that set in the same action,
   * so nothing the reviewer can do lands between the two.
   *
   * It cannot run twice. Note that `busy` and the disabled button are NOT what makes
   * that true: a real double click does not wait for React to commit either of them,
   * so both handlers would close over the same pre-render `draft` state and both
   * would transmit. `submitFlightRef` is read and written synchronously inside
   * `submitRevision`, before its first await, which is the only guard that closes
   * that window.
   */
  const onPrimary = useCallback(async () => {
    if (submitView.mode === 'accept_result') { await onAccept(false); return; }
    // The orchestration lives in the flow module, where every branch — refusal,
    // missing continuation, rejected request, concurrent second click — is executable
    // in a test rather than asserted by reading this file.
    await submitRevision({
      state: submission,
      draftIssueIds: revisionIssueIds,
      submit: onSubmit,
      onState: setLocalSubmission,
      flight: submitFlightRef,
    });
  }, [submitView.mode, submission, revisionIssueIds, onAccept, onSubmit]);

  const issuesUnavailable = sources.issues === 'unavailable';
  const resolutionsUnavailable = sources.reviewer_resolutions !== 'ready';
  const playbackClock = production && selectedSegment
    ? segmentPlaybackClock(production, selectedSegment, playheadMs ?? 0)
    : null;

  return (
    /* THE WORKSPACE IS VIEWPORT-BOUNDED, so feedback volume cannot push the actions
       off screen. Every new issue used to grow the rail, which grew the page: at 100
       issues the submission footer was several screens down.

       `min-h` keeps it usable on short laptops and at high browser zoom — below that
       the workspace stops shrinking and the PAGE scrolls instead, which is why the
       footer is also sticky. `minmax(0,1fr)` on both axes is what actually permits the
       children to be smaller than their content; without it a grid/flex item's
       automatic minimum size is its content and nothing scrolls internally. */
    <div className="grid gap-4 lg:h-[calc(100vh-13rem)] lg:min-h-[34rem] lg:grid-cols-[minmax(0,1fr)_22rem] lg:grid-rows-[minmax(0,1fr)]">
      {/* ── artifact surface ─────────────────────────────────────────────── */}
      <section className="min-h-0 overflow-y-auto rounded-lg border border-ink-800 bg-ink-900/40 p-4">
        {production && (
          <div className="mb-4 border-b border-ink-800 pb-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-medium text-ink-100">Segment review</h2>
                <p className="mt-0.5 text-xs text-ink-500">Professional preview pass</p>
              </div>
              <button
                type="button"
                disabled
                title={renderControl.reason ?? 'Final assembly is not enabled in this first slice.'}
                className="rounded-md border border-ink-700 px-3 py-1.5 text-xs font-medium text-ink-300 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Final render
              </button>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-1 sm:grid-cols-6" aria-label="Production segments">
              {production.segments.map((segment) => {
                const selected = segment.artifact?.id === selectedId;
                const ready = segment.state === 'preview_ready' && segment.artifact;
                const tone = segment.state === 'qa_failed'
                  ? 'border-red-500/50 text-red-300'
                  : segment.state === 'preview_ready'
                    ? 'border-emerald-500/50 text-emerald-300'
                    : segment.state === 'rendering'
                      ? 'border-sky-500/50 text-sky-300'
                      : 'border-ink-800 text-ink-500';
                return (
                  <button
                    key={segment.id}
                    type="button"
                    disabled={!ready}
                    onClick={() => ready && setSelectedId(segment.artifact!.id)}
                    aria-pressed={selected}
                    className={`min-w-0 rounded border px-2 py-2 text-left ${tone} ${selected ? 'bg-ink-800' : 'bg-ink-950'} disabled:cursor-not-allowed`}
                  >
                    <span className="block truncate text-xs font-medium">{segment.ordinal + 1}. {segment.label}</span>
                    <span className="mt-0.5 block truncate text-[11px]">{segment.state.replace('_', ' ')}</span>
                  </button>
                );
              })}
            </div>
            {!renderControl.enabled && renderControl.reason && (
              <p className="mt-2 text-xs text-ink-500">Final render unavailable: {renderControl.reason}</p>
            )}
          </div>
        )}

        <div className="mb-3 rounded-md border border-ink-800 bg-ink-950/50 px-3 py-2.5" aria-label="Review version identity">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-medium text-ink-200">
                Reviewing {currentVersion?.label || props.currentVersionLabel || 'version unavailable'}
              </p>
              <p className="mt-1 text-[11px] text-ink-500">
                Started {reviewTimestamp(currentVersion?.startedAt)} · run {runId.slice(0, 12)}…
              </p>
              {latestFinalOutput ? (
                <p className="mt-1 truncate text-[11px] text-emerald-300" title={latestFinalOutput.relativePath}>
                  Latest validated final output: {latestFinalOutput.relativePath.split('/').at(-1)} · verified {reviewTimestamp(latestFinalOutput.validatedAt)} · sha256 {latestFinalOutput.sha256?.slice(0, 12)}…
                </p>
              ) : (
                <p className="mt-1 text-[11px] text-amber-300">A latest validated final output could not be identified for this revision.</p>
              )}
            </div>
            {latestFinalOutput && latestFinalOutput.id !== selectedId && (
              <button
                type="button"
                onClick={() => setSelectedId(latestFinalOutput.id)}
                className="shrink-0 rounded border border-emerald-500/40 px-2.5 py-1 text-xs text-emerald-300 hover:bg-emerald-500/10"
              >
                Review latest final
              </button>
            )}
          </div>
        </div>

        <div className="mb-3 flex items-end gap-2">
          {validated.length > 0 && (
            <label className="min-w-0 flex-1 text-xs text-ink-400">
              File
              <select
                value={selectedId ?? ''}
                onChange={(e) => setSelectedId(e.target.value)}
                className="mt-1 block w-full rounded border border-ink-700 bg-ink-950 px-2 py-1.5 text-sm text-ink-100"
              >
                {validated.map((a) => (
                  <option key={a.id} value={a.id}>
                    {artifactOptionLabel(a, a.role === 'review_input' ? 'Attached review file' : (currentVersion?.label || props.currentVersionLabel || null))}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            type="button"
            disabled={!canAttachReviewFiles || artifactPicker !== null}
            onClick={() => void pickReviewArtifact('review_target', 'file')}
            className="shrink-0 rounded border border-ink-700 px-3 py-1.5 text-sm text-sky-300 hover:border-sky-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {artifactPicker === 'review_target' ? 'Freezing file…' : 'Open other file'}
          </button>
        </div>
        {sources.review_artifacts !== 'ready' && (
          <p role="status" className="mb-3 text-xs text-amber-300">
            Other review files are unavailable right now. Reload before attaching or sending them.
          </p>
        )}

        <ArtifactSurface
          runId={runId}
          // A decision for a DIFFERENT artifact must not be rendered over this one —
          // otherwise A's failure message shows while B is loading.
          decision={decision && decision.artifactId === selectedId ? decision.value : null}
          previewUrl={preview?.url ?? null}
          onMediaReady={onMediaReady}
          mediaKey={selectedId ?? 'none'}
          textContent={textContent}
          textTruncated={textTruncated}
          mediaRef={mediaRef}
          imageRef={imageRef}
          issues={surfaceIssues}
          onPlayhead={onPlayhead}
          onSelectText={(s) => {
            if (!canReplaceDraft(draft)) { setError(DRAFT_IN_PROGRESS); return; }
            setPendingRange(null);
            setDraft(openDraft({ target: targetIdentity, playheadMs, selection: s }));
          }}
          onSeek={seekTo}
          spatial={{
            enabled: !frozen && !accepted && artifact?.status === 'validated',
            pins: overlayPins,
            draftSpatial: draft?.spatial ?? null,
            freezeMedia: freezeMediaForAnnotation,
            onAnnotate: onSpatialAnnotate,
            onNudgeDraft,
            onCancelDraft: cancelSpatialDraft,
            onOpenIssue: (issueId) => {
              const issue = issues.find((i) => i.id === issueId);
              if (issue) goToIssue(issue);
            },
          }}
        />

        {artifact && (
          <div className="mt-3 text-xs text-ink-500">
            <p className="truncate">
              {proxyPreview && <span className="mr-2 rounded bg-sky-500/15 px-1.5 py-0.5 text-sky-300">Review proxy</span>}
              {artifact.relativePath}
              {artifact.sha256 && <span className="ml-2 font-mono">sha256 {artifact.sha256.slice(0, 12)}…</span>}
            </p>
            {playbackClock && (
              <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-ink-400">
                <span>Segment {formatSignedMs(playbackClock.segmentMs)}</span>
                <span>Global {formatMs(playbackClock.globalMs)}</span>
                <span>Writable starts at {formatMs(playbackClock.writableOffsetMs)}</span>
              </p>
            )}
          </div>
        )}

        {/* Persistent, keyboard-reachable. Not a modal that ambushes every pause. */}
        {!frozen && !accepted && artifact?.status === 'validated' && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {/* TWO EXPLICIT CHOICES, side by side. A range used to be reachable only
                by opening a point comment first and noticing a "Set end here" button
                appear — so the people who needed it most never found it, and the ones
                who did had already committed to a point. */}
            <button
              type="button"
              onClick={openPointComment}
              // The EXACT position, for anyone who needs it. The label shows the second
              // because that is the number on the player next to it.
              title={playheadMs === null ? undefined : `Exact position ${formatMs(playheadMs)}`}
              className="rounded-md border border-ink-700 px-3 py-1.5 text-sm text-ink-200 hover:border-ink-500"
            >
              {pointCommentLabel({ playheadMs, existingCount: hereIssues.length })}
            </button>

            {canOfferRange(playheadMs) && !pendingRange && (
              <button
                type="button"
                onClick={startRange}
                className="rounded-md border border-ink-700 px-3 py-1.5 text-sm text-ink-200 hover:border-ink-500"
              >
                {SELECT_RANGE_LABEL}
              </button>
            )}

            {/* Something is ALREADY here. Never merged into it, never overwritten — the
                count is stated and each one can be reopened. */}
            {hereIssues.length > 0 && (
              <span className="flex flex-wrap items-center gap-1 text-xs text-ink-400">
                <span>{feedbackHereLabel(hereIssues.length)}</span>
                {hereIssues.map((i, n) => (
                  <span key={i.id} className="flex items-center gap-1">
                    <span aria-hidden="true">·</span>
                    <button
                      type="button"
                      onClick={() => startEdit(i)}
                      className="text-sky-400 hover:underline"
                    >
                      {feedbackHereEditLabel(n, hereIssues.length)}
                    </button>
                  </span>
                ))}
              </span>
            )}

            {rangeError && <span role="alert" className="text-xs text-amber-300">{rangeError}</span>}
          </div>
        )}

        {/* ── a range in progress ──────────────────────────────────────────
            An obvious selection state, because a half-made range is a mode: the
            start is fixed, the end is whatever you scrub to next, and either you
            take it or you cancel. Nothing here is written until "Set end". */}
        {pendingRange && !frozen && !accepted && (
          <div className="mt-3 flex flex-wrap items-center gap-3 rounded-md border border-sky-500/40 bg-sky-500/10 p-3">
            <span className="font-mono text-sm text-sky-200">{rangeStartLabel(pendingRange)}</span>
            <span aria-hidden="true" className="text-sky-300">→</span>
            <button
              type="button"
              // FOLLOWS the playhead while the start stays frozen. Deliberately not
              // disabled on an invalid end: a silently dead button teaches nothing,
              // and completeRange refuses in words without touching anything.
              onClick={finishRange}
              className="rounded-md bg-sky-400/90 px-3 py-1.5 font-mono text-sm font-medium text-ink-950 hover:bg-sky-300"
            >
              {rangeEndButtonLabel(playheadMs)}
            </button>
            <button
              type="button"
              onClick={cancelRange}
              className="rounded-md border border-ink-700 px-3 py-1.5 text-sm text-ink-300 hover:border-ink-500"
            >
              {CANCEL_RANGE_LABEL}
            </button>
            <span className="w-full text-xs text-sky-200/80">
              Scrub to where this should end, then take it. The start stays where you set it.
            </span>
          </div>
        )}

        {draft && !frozen && !accepted && (
          <div className="mt-3 rounded-md border border-ink-700 bg-ink-950 p-3">
            <div className="mb-2 flex items-center gap-2 text-xs text-ink-400">
              {/* The FROZEN position. It does not move while the clip keeps playing. */}
              <span title={draft.anchorMs === null ? undefined : `Exact position ${formatMs(draft.anchorMs)}`}>
                {composerHeaderLabel(draft)}
              </span>
              <select
                value={draft.kind}
                onChange={(e) => setDraft({ ...draft, kind: e.target.value })}
                className="ml-auto rounded border border-ink-700 bg-ink-900 px-1.5 py-0.5 text-xs text-ink-200"
                aria-label="Issue type"
              >
                {ISSUE_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </div>

            {/* WHICH FILE, from the draft's own frozen identity — never from whatever
                is selected now. With several artifacts in a review, a timestamp alone
                does not say what the comment is about. A spatial reference draft
                states BOTH roles: where the mark sits and what the change applies to. */}
            <p className="mb-2 truncate text-xs text-ink-400" title={draft.target.relativePath ?? undefined}>
              {draft.spatial ? spatialReferenceLine(draft) : targetLine(draft.target)}
            </p>

            {/* REFERENCE MODE (v2 only): observe A, change B — a typed, validated
                backend field on the spatial anchor, not prose. Default is change mode:
                the marked file IS the file to change. Geometry always belongs to the
                marked (observed) file either way. */}
            {draft.spatial && validated.some((a) => a.id !== draft.target.artifactId && a.sha256) && (
              <label className="mb-2 block text-xs text-ink-400">
                This mark asks for a change to
                <select
                  aria-label="File this annotation applies to"
                  value={draft.referenceTarget?.artifactId ?? ''}
                  onChange={(e) => {
                    const targetId = e.target.value;
                    if (!targetId) { setDraft({ ...draft, referenceTarget: null }); return; }
                    const t = validated.find((a) => a.id === targetId);
                    if (!t?.sha256) return;
                    setDraft({
                      ...draft,
                      referenceTarget: { artifactId: t.id, sha256: t.sha256, relativePath: t.relativePath },
                    });
                  }}
                  className="mt-1 block w-full rounded border border-ink-700 bg-ink-900 px-1.5 py-1 text-xs text-ink-200"
                >
                  <option value="">{`${draft.target.relativePath || 'this file'} — the marked file itself`}</option>
                  {validated.filter((a) => a.id !== draft.target.artifactId && a.sha256).map((a) => (
                    <option key={a.id} value={a.id}>
                      {`${a.relativePath} — the mark is a reference for it`}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {/* A source file is an INPUT the agent may edit in place. Reference-only is
                a real intent and nothing in the contract carries it as a field (see
                docs/review-target-intent-contract.md), so the room states the situation
                and leaves the wording to the reviewer. It is never inferred.

                DELIBERATELY NO ONE-CLICK SENTENCE. A canned "use this as reference"
                is unsafe while the brief names only the session's artifact: it would
                arrive under a heading naming a different file, reading as precise. */}
            {targetGuidance(draft.target) && (
              <p className="mb-2 rounded border border-amber-500/30 bg-amber-500/10 p-2 text-xs leading-snug text-amber-200">
                {targetGuidance(draft.target)}
              </p>
            )}

            {draft.kind === 'audio' && draft.anchorMs !== null && draft.target.relativePath && (
              <ReviewAudioEvidence
                key={`${draft.target.artifactId}:${draft.anchorMs}:${draft.editingIssueId || 'new'}`}
                reviewedFile={draft.target.relativePath}
                anchorMs={draft.anchorMs}
                onInsert={(text) => setDraft({ ...draft, body: draft.body.includes(text) ? draft.body : [draft.body.trim(), text].filter(Boolean).join('\n\n') })}
              />
            )}

            <textarea
              autoFocus
              value={draft.body}
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
              rows={3}
              placeholder="What should change here?"
              className="w-full rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-sm text-ink-100"
            />
            <div className="mt-2 flex gap-2">
              <button
                type="button" disabled={busy} onClick={submitIssue}
                className="rounded-md bg-ink-100 px-3 py-1.5 text-sm font-medium text-ink-950 disabled:opacity-50"
              >
                {saveDraftLabel(draft)}
              </button>
              <button
                type="button"
                // Cancelling clears the frozen anchor with the draft. Leaving it behind
                // would silently anchor the NEXT comment to the abandoned moment.
                onClick={() => { setDraft(null); setRangeAttempt(null); }}
                className="rounded-md border border-ink-700 px-3 py-1.5 text-sm text-ink-300"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>

      {/* ── issue rail ───────────────────────────────────────────────────────
          A THREE-PART FLEX COLUMN: a header that never scrolls away, ONE internally
          scrolling list, and a footer pinned to the bottom. `min-h-0` on the column
          and on the list is the whole trick — a flex item defaults to a minimum size
          of its content, so without it the list refuses to shrink and the overflow
          lands on the page instead of inside the rail.

          On narrow/stacked layouts the rail is capped in viewport units rather than by
          the grid row, so issue scrolling stays bounded there too. */}
      <aside className="flex max-h-[70vh] min-h-0 flex-col rounded-lg border border-ink-800 bg-ink-900/40 lg:max-h-none">
        <div className="shrink-0 border-b border-ink-800 px-4 py-3">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-sm font-medium text-ink-200">Review issues</h2>
            {!issuesUnavailable && !resolutionsUnavailable && visible.length > 0 && (
              <span className="shrink-0 text-xs tabular-nums text-ink-500">{groupCountLabel(visible.length)}</span>
            )}
          </div>
          {!issuesUnavailable && !resolutionsUnavailable && unresolvedPrior.length > 1 && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void resolveIssues(unresolvedPrior.map((issue) => issue.id))}
              className="mt-2 text-xs text-sky-400 hover:underline disabled:opacity-50"
            >
              Mark all as resolved
            </button>
          )}
          {proxyPreview && (
            <p className="mt-2 text-xs text-sky-300">
              This is a validated segment proxy. Segment feedback, approval, and repair are not enabled in this first slice.
            </p>
          )}
        </div>

        {/* THE ONLY SCROLLING REGION IN THE RAIL. Focusable so "Keep reviewing" can
            hand the keyboard back to the list it is telling the user to return to. */}
        <div ref={railListRef} tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {issuesUnavailable ? (
          // NOT an empty rail: we could not read them.
          <p className="text-xs text-amber-300">
            We couldn&apos;t load this review&apos;s issues. This list is not empty — it&apos;s unknown.
          </p>
        ) : resolutionsUnavailable ? (
          <p className="text-xs text-amber-300">
            We couldn&apos;t verify which feedback is resolved. Refresh before resolving or sending this revision.
          </p>
        ) : visible.length === 0 ? (
          <p className="text-xs text-ink-500">
            {/* Not "pause and add feedback" any more — pausing was never the requirement,
                and saying so is what made a stale pause position look authoritative. */}
            {proxyPreview ? 'No parent-run issues are attached to this proxy.' : 'No issues yet. Move to a moment and add feedback.'}
          </p>
        ) : (
          groups.map((group) => (
          <section key={group.artifactId ?? 'whole-run'} className="mb-4 last:mb-0">
            {/* THE STICKY FILE HEADER. Timestamps below it are local to THIS file, and
                the heading is what makes that legible while scrolling. Opaque on
                purpose: a translucent header lets the rows it covers bleed through. */}
            <h3 className="sticky top-0 z-10 -mx-4 -mt-3 mb-2 flex items-baseline justify-between gap-2 border-b border-ink-800/80 bg-ink-900 px-4 py-1.5">
              <button
                type="button"
                // Selecting the group's file is the same action as clicking one of its
                // issues, minus the seek. Disabled for whole-run and for artifacts this
                // packet does not contain — there is nothing to switch to.
                disabled={!group.artifact}
                onClick={() => group.artifact && setSelectedId(group.artifact.id)}
                className="truncate text-left text-xs font-medium text-ink-200 hover:text-sky-300 disabled:cursor-default disabled:hover:text-ink-200"
                title={group.displayName}
              >
                {group.displayName}
              </button>
              <span className="shrink-0 text-[11px] tabular-nums text-ink-500">{groupCountLabel(group.count)}</span>
            </h3>
            {group.unavailable && (
              <p className="mb-2 text-[11px] text-amber-300">
                These comments name a file this review no longer lists.
              </p>
            )}
          <ul className="space-y-2">
            {group.issues.map((i) => {
              // Measured against the issue's OWN artifact. Comparing to the selected one
              // flags a current comment as stale merely because the user switched files.
              const stale = isIssueStale(i, artifacts);
              const elsewhere = !!i.artifactId && i.artifactId !== selectedId;
              // Null for anything already sent, accepted or dismissed.
              const edit = editAction(i as never, selectedId);
              return (
                <li key={i.id} className="rounded border border-ink-800 p-2">
                  <div className="flex items-center gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => goToIssue(i)}
                      className="font-mono text-sky-400 hover:underline"
                    >
                      {anchorLabel(i.anchor as Record<string, unknown>)}
                    </button>
                    <span className="rounded bg-ink-800 px-1 py-0.5 text-ink-400">{i.kind}</span>
                    <span className="ml-auto text-ink-500">{i.status}</span>
                  </div>
                  {/* WHICH FILE this issue is about is now the group heading above, so
                      the card no longer repeats it. What the heading cannot say is that
                      acting on this one moves the player to a different file. */}
                  {elsewhere && (
                    <p className="mt-0.5 text-[11px] text-sky-400">Opens another file</p>
                  )}
                  <p className="mt-1 whitespace-pre-wrap text-sm text-ink-200">{i.body}</p>
                  {submitView.mode === 'send_changes' && patternEligibleIssueIds.has(i.id) && (
                    <label className="mt-2 flex items-start gap-2 rounded border border-violet-500/20 bg-violet-500/5 px-2 py-1.5 text-[11px] text-ink-300">
                      <input
                        type="checkbox"
                        checked={patternSourceIssueIds.includes(i.id)}
                        disabled={frozen || patternBusy || submissionInFlight}
                        onChange={(event) => togglePatternSource(i.id, event.target.checked)}
                        className="mt-0.5"
                      />
                      <span>Use this exact comment as a repeated-pattern example</span>
                    </label>
                  )}
                  {i.status !== 'draft' && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void resolveIssues([i.id])}
                      className="mt-1 text-xs text-sky-400 hover:underline disabled:opacity-50"
                    >
                      Mark as resolved
                    </button>
                  )}
                  {/* The capture's honest state, for spatial issues only. "Verified"
                      appears ONLY for the backend's validated projection — the local
                      pin preview is never called evidence. */}
                  {isSpatialAnchorV2(i.anchor as never) && i.status === 'draft' && (() => {
                    const chip = evidenceChip(evidenceForIssue(i));
                    if (!chip) return null;
                    const tone = chip.tone === 'ok' ? 'text-emerald-300' : chip.tone === 'failed' ? 'text-amber-300' : 'text-ink-500';
                    return <p className={`mt-1 text-[11px] ${tone}`}>{chip.label}</p>;
                  })()}
                  {stale && (
                    <p className="mt-1 text-xs text-amber-300">
                      This file changed since the comment was made — the highlight may no longer match.
                    </p>
                  )}
                  {/* Only DRAFTS are editable. Submitted, accepted and dismissed work is
                      a record of something already acted on or decided — editAction
                      returns null for those rather than offering a promise we'd refuse.
                      A draft on ANOTHER file says so: its composer belongs over its own
                      artifact, so the affordance opens that file instead of quietly
                      attaching an editor to the one on screen. */}
                  {!frozen && !accepted && edit && (
                    <div className="mt-1 flex gap-3">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => (edit.opensElsewhere ? goToIssue(i) : startEdit(i))}
                        className="text-xs text-sky-400 hover:underline disabled:opacity-50"
                      >
                        {edit.label}
                      </button>
                      <button
                        type="button" disabled={busy} onClick={() => dismissIssue(i.id)}
                        className="text-xs text-ink-500 hover:text-red-300 disabled:opacity-50"
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          </section>
          ))
        )}
        {!issuesUnavailable && !resolutionsUnavailable && reviewerResolved.length > 0 && (
          <details className="mt-4 border-t border-ink-800 pt-3">
            <summary className="cursor-pointer text-xs font-medium text-ink-400">
              Resolved ({reviewerResolved.length})
            </summary>
            <ul className="mt-2 space-y-2">
              {reviewerResolved.map((issue) => (
                <li key={issue.id} className="rounded border border-ink-800/70 p-2 opacity-80">
                  <div className="flex items-center gap-2 text-xs text-ink-500">
                    <span className="font-mono">{anchorLabel(issue.anchor as Record<string, unknown>)}</span>
                    <span>{issue.kind}</span>
                    <span className="ml-auto">Resolved by reviewer</span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-ink-300">{issue.body}</p>
                </li>
              ))}
            </ul>
          </details>
        )}
        </div>

        {/* ── submission footer ─────────────────────────────────────────────
            STICKY AND ALWAYS REACHABLE. `shrink-0` keeps it at full height when the
            list is long; `sticky bottom-0` keeps it against the viewport edge on short
            screens and at high zoom, where the rail itself outgrows the window and the
            page scrolls. Opaque, because the issue list slides underneath it. */}
        <div className="sticky bottom-0 shrink-0 space-y-2 border-t border-ink-800 bg-ink-900 px-4 py-3">
          {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
          {notice && <p role="status" className="text-xs text-emerald-300">{notice}</p>}

          {resolutionsUnavailable ? (
            <p role="alert" className="text-xs text-amber-300">
              Resolution status is unavailable. Refresh before resolving or sending feedback.
            </p>
          ) : proxyPreview ? (
            <p className="text-xs text-ink-500">Final render remains unavailable while required segments are unresolved.</p>
          ) : accepted ? (
            <p className="text-xs text-emerald-300">You accepted this result.</p>
          ) : activeIssues.length === 0 && reviewerResolved.length > 0 ? (
            <div className="rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-2">
              <p className="text-xs font-medium text-emerald-300">Review complete</p>
              <p className="mt-1 text-[11px] text-ink-400">All feedback is marked resolved. No revision is waiting to be sent.</p>
            </div>
          ) : submitView.mode === 'queued' ? (
            // TERMINAL. Resubmission is closed here as well as at the backend, and
            // every number and identity below came back from the server — none of it
            // is inferred from local drafts or from a refreshed prop.
            <>
              <p className="text-xs text-emerald-300">
                {revisionCompleted
                  // Past tense, and about the RESULT rather than the queue. The
                  // count still comes from the server; only the tense changes.
                  ? `${submitView.statusLine} The revised result was delivered.`
                  : submitView.statusLine}
              </p>
              <dl className="rounded border border-ink-800 bg-ink-950 px-2 py-1.5 text-[11px] text-ink-500">
                <div className="flex items-baseline justify-between gap-2">
                  <dt>Continuation</dt>
                  <dd className="truncate font-mono text-ink-300" title={submitView.continuationId ?? undefined}>
                    {submitView.continuationId}
                  </dd>
                </div>
                {submitView.submissionId && (
                  <div className="mt-0.5 flex items-baseline justify-between gap-2">
                    <dt>Submission</dt>
                    <dd className="truncate font-mono text-ink-300" title={submitView.submissionId}>
                      {submitView.submissionId}
                    </dd>
                  </div>
                )}
              </dl>
              {submitView.continuationId && (
                <>
                  {/* A submitted Review Room continuation can die before it creates a
                      child run. The process-ledger recovery UI used to exist only on
                      the generic run page, so this screen kept calling the older
                      "amend failed" RPC and displaying its truthful but unactionable
                      ambiguity refusal. Read the exact request here too: once Desktop
                      proves the attempt ended, this offers the safe idempotent retry
                      of the immutable submission without asking for the review again. */}
                  <ReviewContinuationRecovery
                    requestId={submitView.continuationId}
                    onAmendCancelled={amendFailedRevision}
                    onAnswer={() => void addMoreFeedback()}
                    onQueued={() => {
                      setError(null);
                      setRevisionCompleted(null);
                      setNotice('Revision queued again with the same submitted feedback and evidence.');
                    }}
                    onCompleted={setRevisionCompleted}
                  />
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => void openSubmittedRevision()}
                      disabled={busy}
                      className="rounded-md border border-ink-700 px-3 py-2 text-center text-sm text-ink-200 hover:border-ink-600 disabled:opacity-50"
                    >
                      {/* "Attempt" is the right word while the outcome is unknown and
                          the wrong one once the work has landed. */}
                      {revisionCompleted ? 'Open the revised result' : 'Open revision attempt'}
                    </button>
                  </div>
                </>
              )}
            </>
          ) : acts.showApproveNextAction ? (
            // An approval hold with NO drafts. It authorizes remaining work, which is a
            // different question from accepting a result — and, unlike before, this is
            // the only place the gate is ever offered. The moment a draft exists, the
            // room owns the decision and shows the send action instead.
            <>
              <p className="text-xs text-ink-400">
                This agent is waiting for permission to continue. That&apos;s a different question from
                accepting a finished result.
              </p>
              <a
                href={`/runs/${runId}`}
                className="block rounded-md bg-violet-500/90 px-3 py-2 text-center text-sm font-medium text-white hover:bg-violet-500"
              >
                Approve next action
              </a>
            </>
          ) : (
            <>
              {/* Optional revision context must not consume the issue rail by
                  default. The issue chronology is the primary review surface; this
                  disclosure keeps instructions and supporting files close to the
                  send action without permanently shrinking that chronology. */}
              {(submitView.showNote || submitView.mode === 'send_changes') && (
                <details className="rounded border border-ink-800 bg-ink-950/60">
                  <summary className="cursor-pointer px-2 py-1.5 text-xs text-ink-300">
                    <span className="font-medium">Revision options</span>
                    <span className="ml-2 text-ink-500">
                      {revisionNote.trim() && supportingReviewFiles.length > 0
                        ? `Instructions · ${supportingReviewFiles.length} attached`
                        : revisionNote.trim()
                          ? 'Instructions added'
                          : supportingReviewFiles.length > 0
                            ? `${supportingReviewFiles.length} attached`
                            : 'Optional'}
                    </span>
                  </summary>
                  <div className="space-y-2 border-t border-ink-800 p-2">
                    {submitView.mode === 'send_changes' && (
                      <div className="space-y-2 rounded border border-violet-500/30 bg-violet-500/5 p-2">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <span className="block text-xs font-medium text-violet-100">Apply a repeated pattern</span>
                            <span className="mt-0.5 block text-[11px] leading-snug text-ink-500">
                              Select two or more exact comments in the issue list. Implexa discloses only those comments to compile one bounded rule for this revision. Nothing becomes future training.
                            </span>
                          </div>
                          <button
                            type="button"
                            disabled={patternBusy || patternSourceIssues.length < 2 || submissionInFlight}
                            onClick={() => void onSynthesizePattern()}
                            aria-describedby="pattern-selection-status"
                            className="shrink-0 rounded border border-violet-400/50 px-2 py-1 text-[11px] text-violet-100 disabled:opacity-40"
                          >
                            {patternBusy ? 'Synthesizing…' : patternCandidate ? 'Synthesize again' : 'Synthesize'}
                          </button>
                        </div>
                        <p id="pattern-selection-status" className="text-[11px] text-ink-500">
                          {patternSourceIssues.length === 0
                            ? 'No pattern examples selected.'
                            : `${patternSourceIssues.length} exact ${patternSourceIssues.length === 1 ? 'comment' : 'comments'} selected.`}
                          {patternSourceIssues.length < 2 ? ' Select at least two demonstrating the same correction.' : ''}
                        </p>
                        {patternCandidate && (
                          <div className="space-y-2 border-t border-violet-500/20 pt-2">
                            <label className="block">
                              <span className="text-[11px] text-ink-400">Candidate rule — edit before confirming</span>
                              <textarea
                                value={patternCandidate.rule}
                                maxLength={2000}
                                rows={3}
                                disabled={submissionInFlight}
                                onChange={(event) => setPatternCandidate((current) => current ? {
                                  ...current, rule: event.target.value, confirmedByUser: false,
                                } : current)}
                                className="mt-1 block w-full rounded border border-ink-700 bg-ink-950 px-2 py-1.5 text-xs text-ink-100"
                              />
                            </label>
                            <label className="block">
                              <span className="text-[11px] text-ink-400">Search scope</span>
                              <select
                                value={patternCandidate.scope}
                                disabled={submissionInFlight}
                                onChange={(event) => setPatternCandidate((current) => current ? {
                                  ...current,
                                  scope: event.target.value as ReviewPatternApplication['scope'],
                                  confirmedByUser: false,
                                } : current)}
                                className="mt-1 block w-full rounded border border-ink-700 bg-ink-950 px-2 py-1.5 text-xs text-ink-100"
                              >
                                <option value="full_artifact">Complete target artifact</option>
                                <option value="after_last_explicit_issue">After the latest explicit comment</option>
                              </select>
                            </label>
                            <label className="flex items-start gap-2 text-[11px] text-ink-300">
                              <input
                                type="checkbox"
                                checked={patternCandidate.confirmedByUser}
                                disabled={!patternCandidate.rule.trim() || submissionInFlight}
                                onChange={(event) => setPatternCandidate((current) => current ? {
                                  ...current, confirmedByUser: event.target.checked,
                                } : current)}
                                className="mt-0.5"
                              />
                              <span>
                                Confirm this run-local rule. The worker must propose and verify every generalized change separately from the exact comments.
                              </span>
                            </label>
                            <button
                              type="button"
                              disabled={submissionInFlight}
                              onClick={() => {
                                setPatternCandidate(null);
                                setPatternCandidateEvidenceKey(null);
                              }}
                              className="text-[11px] text-ink-500 hover:text-red-300 disabled:opacity-40"
                            >
                              Discard candidate
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                    {/* THE REVISION NOTE supplements the structured issues and never
                        replaces them. The backend trims it before storing, so the
                        counter measures the trimmed length too. */}
                    {submitView.showNote && (
                      <label className="block">
                        <span className="text-xs text-ink-400">Additional instructions for this revision</span>
                        <textarea
                          value={revisionNote}
                          onChange={(e) => setRevisionNote(e.target.value)}
                          disabled={!submitView.noteEnabled}
                          rows={2}
                          maxLength={REVISION_NOTE_MAX}
                          placeholder="Optional. Adds context to the issues above — it doesn't replace them."
                          className="mt-1 block w-full rounded border border-ink-700 bg-ink-950 px-2 py-1.5 text-sm text-ink-100 placeholder:text-ink-600 disabled:cursor-not-allowed disabled:opacity-50"
                        />
                        <span className="mt-1 block text-[11px] leading-snug text-ink-500">
                          {submitView.noteHint
                            ?? `Optional. ${revisionNote.trim().length}/${REVISION_NOTE_MAX} characters.`}
                        </span>
                      </label>
                    )}

                    {submitView.mode === 'send_changes' && (
                      <div className="space-y-3">
                        <label className="flex items-start gap-2 rounded border border-ink-800 bg-ink-950 p-2 text-xs text-ink-300">
                          <input
                            type="checkbox"
                            checked={effectiveRevisionMode === 'selected_files'}
                            disabled={hasExternalReviewTarget}
                            onChange={(event) => setRevisionMode(event.target.checked ? 'selected_files' : 'inherit')}
                            className="mt-0.5"
                          />
                          <span>
                            <span className="block font-medium text-ink-100">Start with reviewed and attached files only</span>
                            <span className="mt-0.5 block text-ink-500">
                              {hasExternalReviewTarget
                                ? 'Required automatically because this review includes a file opened outside the original run.'
                                : 'Recommended. This starts from the exact files in this review and works even when older run inputs were not recorded. Turn it off only to inherit a complete original-run input contract.'}
                            </span>
                          </span>
                        </label>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="mr-auto text-xs text-ink-400">Files the revision may use</span>
                          <button
                            type="button"
                            disabled={!canAttachReviewFiles || artifactPicker !== null}
                            onClick={() => void pickReviewArtifact('supporting', 'file')}
                            className="rounded border border-ink-700 px-2 py-1 text-xs text-sky-300 hover:border-sky-500 disabled:opacity-40"
                          >
                            {artifactPicker === 'supporting_file' ? 'Freezing file…' : 'Attach file'}
                          </button>
                          <button
                            type="button"
                            disabled={!canAttachReviewFiles || artifactPicker !== null}
                            onClick={() => void pickReviewArtifact('supporting', 'directory')}
                            className="rounded border border-ink-700 px-2 py-1 text-xs text-sky-300 hover:border-sky-500 disabled:opacity-40"
                          >
                            {artifactPicker === 'supporting_folder' ? 'Freezing folder…' : 'Attach folder'}
                          </button>
                        </div>
                        {supportingReviewFiles.length > 0 ? (
                          <ul className="mt-2 space-y-1 text-xs text-ink-300">
                            {supportingReviewFiles.map((entry) => <li key={entry.artifactId}>✓ {entry.displayName}</li>)}
                          </ul>
                        ) : (
                          <p className="mt-2 text-[11px] text-ink-500">Optional replacement images, references, or a folder frozen as ZIP.</p>
                        )}
                      </div>
                    )}
                  </div>
                </details>
              )}

              {/* THE FROZEN SNAPSHOT, visible before it is sent. */}
              {submitView.mode === 'send_changes' && (
                <p className="rounded border border-sky-500/30 bg-sky-500/10 px-2 py-1.5 text-xs text-sky-200">
                  {revisionCompositionLabel(unresolvedPrior.length, drafts.length)}
                </p>
              )}
              {submitView.frozenCount !== null && submitView.statusLine && (
                <p className="rounded border border-ink-700 bg-ink-950 px-2 py-1.5 text-xs text-ink-300">
                  {submitView.statusLine}
                </p>
              )}
              {!error && submitView.errorLine && (
                <p role="alert" className="text-xs text-red-300">{submitView.errorLine}</p>
              )}

              {/* THE EVIDENCE GATE (Wave 2). Sending only unlocks when every spatial
                  draft holds VALIDATED evidence — the backend refuses anyway; this is
                  the honest button over that rule, with a retry for failed captures. */}
              {submitView.mode !== 'accept_result' && gate.blocked && gate.statusLine && (
                <p role="status" className="text-xs text-sky-300">{gate.statusLine}</p>
              )}
              {submitView.mode !== 'accept_result' && gate.reason === 'failed' && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={retryEvidence}
                  className="w-full rounded-md border border-amber-400/60 px-3 py-2 text-sm text-amber-200 hover:border-amber-300 disabled:opacity-40"
                >
                  Retry screenshot capture
                </button>
              )}

              <button
                type="button"
                disabled={
                  !submitView.primaryEnabled
                  || (submitView.mode === 'accept_result' ? !acts.canAccept : !acts.canSubmit)
                  || (submitView.mode !== 'accept_result' && gate.blocked)
                  // The exact revision manifest includes every session-bound
                  // supporting file. If that source cannot be read, sending would
                  // either omit authority or rely on the backend to surprise the
                  // user with a late refusal. Fail closed at the visible boundary.
                  || (submitView.mode === 'send_changes' && sources.review_artifacts !== 'ready')
                }
                onClick={onPrimary}
                className="w-full rounded-md bg-ink-100 px-3 py-2 text-sm font-medium text-ink-950 disabled:opacity-40"
              >
                {submitView.mode === 'send_changes'
                  ? revisionCompositionLabel(unresolvedPrior.length, drafts.length)
                  : submitView.primaryLabel}
              </button>

              {submitView.secondaryLabel && (
                <button
                  type="button"
                  disabled={!submitView.secondaryEnabled}
                  // The explicit alternative to sending. It clears a failed attempt
                  // and returns the keyboard to the list — it never touches drafts or
                  // the note, and it cannot recall a request already in flight.
                  onClick={() => {
                    setLocalSubmission(keepReviewing(submission));
                    setError(null);
                    setNotice(null);
                    railListRef.current?.focus();
                  }}
                  className="w-full rounded-md border border-ink-700 px-3 py-2 text-sm text-ink-200 disabled:opacity-40"
                >
                  {submitView.secondaryLabel}
                </button>
              )}

              {submitView.mode === 'accept_result' && (
                <p className="text-[11px] leading-snug text-ink-500">{ACCEPT_DISCLAIMER}</p>
              )}

              {/* The backend's own guard, surfaced verbatim. Accept is only offered
                  with zero drafts, so this fires only when a draft appeared between
                  the read and the write (another tab, another device) — and even then
                  written feedback is never discarded without a confirmed answer. */}
              {confirmDiscard && (
                <div className="rounded border border-amber-500/40 bg-amber-500/10 p-2">
                  <p className="text-xs text-amber-200">
                    Accepting discards {drafts.length} unsent {drafts.length === 1 ? 'issue' : 'issues'}.
                  </p>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button" disabled={busy} onClick={() => onAccept(true)}
                      className="rounded bg-amber-400 px-2 py-1 text-xs font-medium text-ink-950"
                    >
                      Accept and discard {drafts.length}
                    </button>
                    <button
                      type="button" onClick={() => setConfirmDiscard(false)}
                      className="rounded border border-ink-700 px-2 py-1 text-xs text-ink-300"
                    >
                      Keep them
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          <button
            type="button"
            disabled={busy}
            onClick={() => void addMoreFeedback()}
            className="w-full rounded-md border border-sky-500/40 px-3 py-2 text-center text-sm text-sky-300 hover:border-sky-400 disabled:opacity-50"
          >
            Add more feedback
          </button>
        </div>
      </aside>

      {cleanupPrompt && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="post-acceptance-cleanup-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
        >
          <div ref={cleanupDialogRef} className="w-full max-w-md rounded-xl border border-ink-700 bg-ink-950 p-5 shadow-2xl">
            <h2 id="post-acceptance-cleanup-title" className="text-lg font-semibold text-ink-100">
              Free up local storage?
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-300">
              Implexa can remove redundant review copies and rejected render intermediates that are no longer referenced.
            </p>
            <p className="mt-2 rounded border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs leading-relaxed text-emerald-200">
              Your accepted final, editable project, learned decision traces, and original source stay protected.
            </p>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button
                ref={cleanupDismissRef}
                type="button"
                disabled={cleanupBusy}
                onClick={() => setCleanupPrompt(false)}
                className="rounded-md border border-ink-700 px-3 py-2 text-sm text-ink-300 disabled:opacity-40"
              >
                Keep for now
              </button>
              <button
                type="button"
                disabled={cleanupBusy}
                onClick={() => void openPostAcceptanceCleanup()}
                className="rounded-md bg-emerald-400 px-3 py-2 text-sm font-medium text-ink-950 disabled:opacity-40"
              >
                {cleanupBusy ? 'Opening cleanup…' : 'Review cleanup'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Everything the spatial annotation overlay needs, threaded as one bundle. */
type SpatialSurfaceProps = {
  enabled: boolean;
  pins: OverlayPin[];
  draftSpatial: DraftSpatial | null;
  freezeMedia: () => number | null;
  onAnnotate: (args: { spatial: DraftSpatial; frozenTimestampMs: number | null }) => void;
  onNudgeDraft: (next: { x: number; y: number }) => void;
  onCancelDraft: () => void;
  onOpenIssue: (issueId: string) => void;
};

/** The viewer. Every non-ready state renders words and buttons, never a dead player. */
function ArtifactSurface({
  runId, decision, previewUrl, textContent, textTruncated, mediaRef, imageRef, issues, onSelectText, onSeek,
  onMediaReady, onPlayhead, mediaKey, spatial,
}: {
  runId: string;
  decision: PreviewDecision | null;
  previewUrl: string | null;
  /** Fired on loadedmetadata — the only safe moment to apply a cross-artifact seek. */
  onMediaReady: () => void;
  /**
   * Every event that can move the position, reported WITH the artifact the element
   * belongs to. One handler, so there is no way for a subset of them (the old
   * pause-only binding) to leave the offered position behind the visible one.
   */
  onPlayhead: (artifactId: string, seconds: number) => void;
  /** Remounts the element per artifact, so loadedmetadata fires for the NEW file. */
  mediaKey: string;
  textContent: string | null;
  textTruncated: boolean;
  mediaRef: React.MutableRefObject<HTMLVideoElement | HTMLAudioElement | null>;
  imageRef: React.MutableRefObject<HTMLImageElement | null>;
  issues: ReviewIssue[];
  onSelectText: (s: { start: number; end: number; quote: string }) => void;
  onSeek: (ms: number) => void;
  spatial: SpatialSurfaceProps;
}) {
  if (!decision) return <div className="h-48 animate-pulse rounded bg-ink-800/50" />;

  if (decision.state !== 'ready' && decision.state !== 'loading') {
    return (
      <div className="rounded border border-ink-800 bg-ink-950 p-6 text-center">
        <p className="text-sm text-ink-200">{decision.message}</p>
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          {decision.offerOpenInDesktop && desktopReviewHref(runId) && (
            <a
              href={desktopReviewHref(runId)!}
              className="rounded-md bg-ink-100 px-3 py-1.5 text-sm font-medium text-ink-950"
            >
              Open in Implexa Desktop
            </a>
          )}
          {decision.state === 'update_required' && (
            <a href="/get-app" className="rounded-md border border-ink-700 px-3 py-1.5 text-sm text-ink-200">
              Get the update
            </a>
          )}
        </div>
      </div>
    );
  }

  if (decision.state === 'loading' || !previewUrl) {
    return <div className="h-48 animate-pulse rounded bg-ink-800/50" aria-label="Loading preview" />;
  }

  const markers = issues.filter((i) => (i.anchor as Record<string, unknown>)?.type === 'media_time');

  if (decision.kind === 'video' || decision.kind === 'audio') {
    const Tag = (decision.kind === 'video' ? 'video' : 'audio') as 'video' | 'audio';
    return (
      <div>
        {/* RELATIVE WRAPPER so the annotation overlay can sit exactly over the player.
            Audio gets no overlay — there is no picture to point at. */}
        <div className={decision.kind === 'video' ? 'relative' : undefined}>
        <Tag
          // KEYED BY ARTIFACT. Without this React reuses the element across a switch and
          // loadedmetadata may never fire for the new file, so a pending seek would hang.
          key={mediaKey}
          ref={mediaRef as never}
          src={previewUrl}
          controls
          className={decision.kind === 'video'
            ? 'max-h-[60vh] w-full rounded bg-black object-contain'
            : 'w-full'}
          // Playhead first, THEN the pending cross-artifact seek: the seek sets the
          // playhead itself, and must win over the position the file happened to load at.
          onLoadedMetadata={(e) => {
            onPlayhead(mediaKey, (e.currentTarget as HTMLMediaElement).currentTime);
            onMediaReady();
          }}
          onTimeUpdate={(e) => onPlayhead(mediaKey, (e.currentTarget as HTMLMediaElement).currentTime)}
          // SEEKED is the one the old code was missing. Scrubbing the control bar to a
          // new position fires this and not `pause`, so the offered timestamp stayed at
          // whatever the last pause had been.
          onSeeked={(e) => onPlayhead(mediaKey, (e.currentTarget as HTMLMediaElement).currentTime)}
          onPause={(e) => onPlayhead(mediaKey, (e.currentTarget as HTMLMediaElement).currentTime)}
        />
        {decision.kind === 'video' && (
          <ReviewSpatialOverlay
            mediaKind="video"
            mediaEl={() => (mediaRef.current instanceof HTMLVideoElement ? mediaRef.current : null)}
            enabled={spatial.enabled}
            pins={spatial.pins}
            draftSpatial={spatial.draftSpatial}
            freezeMedia={spatial.freezeMedia}
            onAnnotate={spatial.onAnnotate}
            onNudgeDraft={spatial.onNudgeDraft}
            onCancelDraft={spatial.onCancelDraft}
            onOpenIssue={spatial.onOpenIssue}
          />
        )}
        </div>
        {/* The OUTSIDE-the-player information affordance (Wave 2 discoverability):
            always visible next to the player, never floating over content. */}
        {decision.kind === 'video' && (
          <p className="mt-2 flex items-start gap-1.5 text-xs text-ink-500" data-testid="spatial-hint">
            <span aria-hidden="true" className="mt-px inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-ink-600 text-[10px]">i</span>
            <span>{SPATIAL_HINT_COPY}</span>
          </p>
        )}
        {markers.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {markers.map((i) => {
              const ms = Number((i.anchor as Record<string, unknown>).timeStartMs) || 0;
              return (
                <button
                  key={i.id}
                  type="button"
                  onClick={() => onSeek(ms)}
                  title={i.body}
                  className="rounded bg-ink-800 px-1.5 py-0.5 font-mono text-[11px] text-ink-300 hover:bg-ink-700"
                >
                  {formatMs(ms)}
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  if (decision.kind === 'image') {
    return (
      <div>
        <div className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={imageRef}
            src={previewUrl}
            alt="Artifact under review"
            className="max-h-[60vh] w-full rounded object-contain"
          />
          <ReviewSpatialOverlay
            mediaKind="image"
            mediaEl={() => imageRef.current}
            enabled={spatial.enabled}
            pins={spatial.pins}
            draftSpatial={spatial.draftSpatial}
            freezeMedia={spatial.freezeMedia}
            onAnnotate={spatial.onAnnotate}
            onNudgeDraft={spatial.onNudgeDraft}
            onCancelDraft={spatial.onCancelDraft}
            onOpenIssue={spatial.onOpenIssue}
          />
        </div>
        <p className="mt-2 flex items-start gap-1.5 text-xs text-ink-500" data-testid="spatial-hint">
          <span aria-hidden="true" className="mt-px inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-ink-600 text-[10px]">i</span>
          <span>{SPATIAL_HINT_COPY}</span>
        </p>
      </div>
    );
  }

  if (decision.kind === 'text') {
    const body = (
      <pre
        className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded bg-ink-950 p-3 text-sm text-ink-200"
        onMouseUp={() => {
          const sel = typeof window !== 'undefined' ? window.getSelection() : null;
          const quote = sel?.toString() ?? '';
          if (!quote.trim() || !textContent) return;
          const start = textContent.indexOf(quote);
          if (start < 0) return;
          onSelectText({ start, end: start + quote.length, quote });
        }}
      >
        {textContent ?? ''}
      </pre>
    );
    return textTruncated ? (
      <div>
        {body}
        {/* A clipped file must never read as a whole one — a reviewer would otherwise
            sign off on an ending they were never shown. */}
        <p className="mt-2 text-xs text-ink-400">
          Showing the first 2 MB of this file. The rest is not displayed here.
        </p>
      </div>
    ) : body;
  }

  // pdf and anything else that reached ready
  return (
    <div className="rounded border border-ink-800 bg-ink-950 p-6 text-center text-sm text-ink-300">
      This file is ready, but inline viewing isn&apos;t supported yet. Open it externally to review.
    </div>
  );
}
