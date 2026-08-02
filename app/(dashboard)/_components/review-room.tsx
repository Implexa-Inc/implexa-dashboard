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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ReviewArtifact, ReviewIssue, ReviewProduction, ReviewSession, SourceState } from '@/lib/review';
import {
  decidePreview, interpretPreviewResult, requestPreview, revokePreview,
  desktopPreviewSupported, desktopReviewHref, inDesktopApp, parsePreviewUrl,
  previewText, previewTextTruncated,
  type PreviewDecision,
} from '@/lib/review-preview';
import {
  buildMediaAnchor, buildTextAnchor, buildArtifactAnchor, anchorError, bodyError,
  anchorLabel, formatMs, sortIssues, isAnchorStale, type ReviewAnchor,
} from '@/lib/review-anchor';
import {
  reviewRoomActions, ACCEPT_DISCLAIMER,
  issuesForArtifact, artifactForIssue, isIssueStale, issueClickTarget,
  resolveInitialArtifact, shouldApplySeek, shouldDropPendingSeek, type PendingSeek,
} from '@/lib/review-room-state';
import {
  finalRenderControl, preferredReviewArtifact, previewRequestIdentity, reviewableArtifacts,
  segmentForArtifact, segmentPlaybackClock,
} from '@/lib/segmented-review';
import {
  beginRange, canOfferRange, canReplaceDraft, completeRange, composerHeaderLabel, draftFromIssue,
  draftIssuesAtSecond, editAction, feedbackHereEditLabel, feedbackHereLabel, openDraft,
  playheadFromEvent, pointCommentLabel, rangeEndButtonLabel, rangeStartLabel,
  rangeSurvivesSelection, replaceIssue, saveActionFor, saveDraftLabel, targetGuidance, targetLine,
  CANCEL_RANGE_LABEL, DRAFT_IN_PROGRESS, SELECT_RANGE_LABEL,
  type FeedbackDraft, type FrozenTarget, type PendingRange,
} from '@/lib/review-timestamp-feedback';

type Props = {
  runId: string;
  agentName: string;
  artifacts: ReviewArtifact[];
  production: ReviewProduction;
  issues: ReviewIssue[];
  session: ReviewSession;
  sources: Record<string, SourceState>;
  isApprovalHold: boolean;
  /**
   * Open on this artifact (e.g. a generated-clip deep link). Honored only when it
   * names an artifact present in this packet; otherwise the preferred artifact is
   * used as before.
   */
  initialArtifactId?: string | null;
};

const ISSUE_KINDS = ['timing', 'content', 'visual', 'audio', 'missing', 'replacement', 'other'] as const;

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
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    return resolveInitialArtifact(
      props.initialArtifactId ?? null,
      reviewableArtifacts(artifacts, production),
      preferredReviewArtifact(artifacts, production)?.id ?? null,
    );
  });
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

  const [issues, setIssues] = useState<ReviewIssue[]>(props.issues);
  const [session, setSession] = useState<ReviewSession>(props.session);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [textTruncated, setTextTruncated] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // A seek requested for an artifact that is not on screen. It carries the artifact id
  // so it can never be applied to a different file.
  const [pendingSeek, setPendingSeek] = useState<PendingSeek>(null);

  const drafts = useMemo(() => issues.filter((i) => i.status === 'draft'), [issues]);
  const ordered = useMemo(() => sortIssues(issues), [issues]);
  // The single source of truth for what may be offered and said. Re-deriving these
  // inline is how a panel ends up claiming "Accepted" beside a live "Request fixes".
  const acts = reviewRoomActions({
    sessionState: (session?.state as never) ?? null,
    draftCount: drafts.length,
    isApprovalHold,
  });
  const visible = useMemo(() => ordered.filter((i) => i.status !== 'dismissed'), [ordered]);
  // ONLY this artifact's issues may be drawn on it. An issue about another file has no
  // position on this timeline, and rendering it there invents one.
  const surfaceIssues = useMemo(
    () => issuesForArtifact(visible, selectedId),
    [visible, selectedId],
  );
  const frozen = proxyPreview || (!acts.canEditIssues && session?.state !== 'accepted' && !isApprovalHold);
  const accepted = session?.state === 'accepted';

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
    setRangeError(null);

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
    if (d.selection) return buildTextAnchor(sha, d.selection.start, d.selection.end, d.selection.quote);
    if (d.anchorMs !== null) {
      return buildMediaAnchor(sha, d.anchorMs / 1000, d.rangeEndMs === null ? null : d.rangeEndMs / 1000);
    }
    return buildArtifactAnchor(sha);
  }, []);

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
        setDraft(null); setRangeError(null);
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
      setDraft(null); setRangeError(null);
    } finally { setBusy(false); }
    // NOT `artifact`: every identity this path writes now comes from the draft.
  }, [buildAnchor, draft, ensureSession]);

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

  /** Open a NEW point composer, freezing the current playhead and file into it. */
  const openPointComment = useCallback(() => {
    setError(null); setRangeError(null);
    if (!canReplaceDraft(draft)) { setError(DRAFT_IN_PROGRESS); return; }
    setPendingRange(null);
    setDraft(openDraft({ target: targetIdentity, playheadMs }));
  }, [draft, targetIdentity, playheadMs]);

  /** Begin a range: the start and its file freeze here, the end follows the playhead. */
  const startRange = useCallback(() => {
    setError(null); setRangeError(null);
    if (!canReplaceDraft(draft)) { setError(DRAFT_IN_PROGRESS); return; }
    const begun = beginRange({ target: targetIdentity, playheadMs });
    if (begun.error) { setRangeError(begun.error); return; }
    setDraft(null);
    setPendingRange(begun.range);
  }, [draft, targetIdentity, playheadMs]);

  /** Take the current playhead as the end. A refusal changes nothing. */
  const finishRange = useCallback(() => {
    setError(null);
    const done = completeRange(pendingRange, playheadMs);
    setRangeError(done.error);
    if (done.error || !done.draft) return;
    setDraft(done.draft);
    setPendingRange(null);
  }, [pendingRange, playheadMs]);

  const cancelRange = useCallback(() => { setPendingRange(null); setRangeError(null); }, []);

  /** Reopen an existing DRAFT issue on its own file, anchor, body and kind. */
  const startEdit = useCallback((issue: ReviewIssue) => {
    setError(null); setRangeError(null);
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
    if (target.needsSwitch && target.artifactId) {
      setSelectedId(target.artifactId);
      // Identity travels WITH the request, so a further switch before B loads cannot
      // apply B's timestamp to C.
      setPendingSeek(target.seekMs === null ? null : { artifactId: target.artifactId, seekMs: target.seekMs });
      return;
    }
    if (target.seekMs !== null) seekTo(target.seekMs);
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
      setRangeError(null);
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
  const onSubmit = useCallback(async () => {
    setBusy(true); setError(null); setNotice(null);
    try {
      const sid = session?.id;
      if (!sid) { setError('Nothing to submit yet.'); return; }
      const { body } = await reviewAction({ action: 'submit', sessionId: sid });
      if (!body?.ok) { setError(body?.error || 'Could not request fixes.'); return; }
      setNotice(body.idempotent
        ? 'These fixes were already requested — showing the existing revision.'
        : 'Revision queued.');
      router.refresh();
    } finally { setBusy(false); }
  }, [session, router]);

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
      router.refresh();
    } finally { setBusy(false); }
  }, [ensureSession, router, selectedId]);

  const issuesUnavailable = sources.issues === 'unavailable';
  const playbackClock = production && selectedSegment
    ? segmentPlaybackClock(production, selectedSegment, playheadMs ?? 0)
    : null;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      {/* ── artifact surface ─────────────────────────────────────────────── */}
      <section className="rounded-lg border border-ink-800 bg-ink-900/40 p-4">
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

        {validated.length > 1 && (
          <label className="mb-3 block text-xs text-ink-400">
            File
            <select
              value={selectedId ?? ''}
              onChange={(e) => setSelectedId(e.target.value)}
              className="mt-1 block w-full rounded border border-ink-700 bg-ink-950 px-2 py-1.5 text-sm text-ink-100"
            >
              {validated.map((a) => (
                <option key={a.id} value={a.id}>{a.relativePath}{a.role ? ` — ${a.role}` : ''}</option>
              ))}
            </select>
          </label>
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
          issues={surfaceIssues}
          onPlayhead={onPlayhead}
          onSelectText={(s) => {
            if (!canReplaceDraft(draft)) { setError(DRAFT_IN_PROGRESS); return; }
            setPendingRange(null);
            setDraft(openDraft({ target: targetIdentity, playheadMs, selection: s }));
          }}
          onSeek={seekTo}
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
                does not say what the comment is about. */}
            <p className="mb-2 truncate text-xs text-ink-400" title={draft.target.relativePath ?? undefined}>
              {targetLine(draft.target)}
            </p>

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
                onClick={() => { setDraft(null); setRangeError(null); }}
                className="rounded-md border border-ink-700 px-3 py-1.5 text-sm text-ink-300"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>

      {/* ── issue rail ───────────────────────────────────────────────────── */}
      <aside className="rounded-lg border border-ink-800 bg-ink-900/40 p-4">
        <h2 className="text-sm font-medium text-ink-200">Review issues</h2>
        {proxyPreview && (
          <p className="mt-2 text-xs text-sky-300">
            This is a validated segment proxy. Segment feedback, approval, and repair are not enabled in this first slice.
          </p>
        )}

        {issuesUnavailable ? (
          // NOT an empty rail: we could not read them.
          <p className="mt-2 text-xs text-amber-300">
            We couldn&apos;t load this review&apos;s issues. This list is not empty — it&apos;s unknown.
          </p>
        ) : ordered.filter((i) => i.status !== 'dismissed').length === 0 ? (
          <p className="mt-2 text-xs text-ink-500">
            {/* Not "pause and add feedback" any more — pausing was never the requirement,
                and saying so is what made a stale pause position look authoritative. */}
            {proxyPreview ? 'No parent-run issues are attached to this proxy.' : 'No issues yet. Move to a moment and add feedback.'}
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {visible.map((i) => {
              // Measured against the issue's OWN artifact. Comparing to the selected one
              // flags a current comment as stale merely because the user switched files.
              const stale = isIssueStale(i, artifacts);
              const own = artifactForIssue(i, artifacts);
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
                  {/* WHICH FILE this issue is about. With many artifacts, a timestamp
                      alone is ambiguous — and the rail deliberately shows every issue
                      rather than hiding the ones for other files. */}
                  <div className="mt-0.5 flex items-center gap-1 text-[11px] text-ink-500">
                    <span className="truncate">{own ? own.relativePath : 'Whole run'}</span>
                    {elsewhere && <span className="shrink-0 text-sky-400">· opens another file</span>}
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-ink-200">{i.body}</p>
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
        )}

        {error && <p role="alert" className="mt-3 text-xs text-red-300">{error}</p>}
        {notice && <p role="status" className="mt-3 text-xs text-emerald-300">{notice}</p>}

        <div className="mt-4 space-y-2 border-t border-ink-800 pt-4">
          {proxyPreview ? (
            <p className="text-xs text-ink-500">Final render remains unavailable while required segments are unresolved.</p>
          ) : acts.statusLine && !acts.canSubmit && !acts.canAccept && !acts.showApproveNextAction ? (
            <p className="text-xs text-emerald-300">{acts.statusLine}</p>
          ) : accepted ? (
            <p className="text-xs text-emerald-300">You accepted this result.</p>
          ) : acts.showApproveNextAction ? (
            // An approval hold authorizes REMAINING work. It is not a delivered result,
            // so "Accept result" is never offered here.
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
              <button
                type="button"
                disabled={busy || !acts.canSubmit}
                onClick={onSubmit}
                className="w-full rounded-md bg-ink-100 px-3 py-2 text-sm font-medium text-ink-950 disabled:opacity-40"
              >
                {acts.submitLabel}
              </button>

              {confirmDiscard ? (
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
              ) : (
                <button
                  type="button" disabled={busy || !acts.canAccept} onClick={() => onAccept(false)}
                  className="w-full rounded-md border border-ink-700 px-3 py-2 text-sm text-ink-200 disabled:opacity-40"
                >
                  Accept result
                </button>
              )}
              <p className="text-[11px] leading-snug text-ink-500">{ACCEPT_DISCLAIMER}</p>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

/** The viewer. Every non-ready state renders words and buttons, never a dead player. */
function ArtifactSurface({
  runId, decision, previewUrl, textContent, textTruncated, mediaRef, issues, onSelectText, onSeek,
  onMediaReady, onPlayhead, mediaKey,
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
  issues: ReviewIssue[];
  onSelectText: (s: { start: number; end: number; quote: string }) => void;
  onSeek: (ms: number) => void;
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
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={previewUrl} alt="Artifact under review" className="max-h-[60vh] w-full rounded object-contain" />;
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
