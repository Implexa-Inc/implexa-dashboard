'use client';

/**
 * <ReviewRoom /> — the artifact surface + issue rail + actions.
 *
 * DESIGN RULES THIS COMPONENT ENFORCES:
 *
 *  * A local file is opened ONLY through the desktop's authorized token URL. No path
 *    is ever received, stored, or rendered; `isSafePreviewUrl` gates every `src`.
 *  * Every "cannot preview" reason gets its own words and its own buttons. An
 *    unsupported codec renders an explanation, never an empty black player.
 *  * Pausing captures the exact position (currentTime * 1000, rounded) against the
 *    artifact's validated digest — that pair IS the identity of media feedback.
 *  * Issues accumulate locally as DRAFTS on the server, then submit together as
 *    exactly one continuation. The submit endpoint is idempotent; this never dedupes.
 *  * "Accept result" and "Approve next action" are different questions. An
 *    approval-before-action hold never renders Accept result.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ReviewArtifact, ReviewIssue, ReviewSession, SourceState } from '@/lib/review';
import {
  decidePreview, interpretPreviewResult, requestPreview, revokePreview,
  desktopPreviewSupported, inDesktopApp, isSafePreviewUrl,
  type PreviewDecision,
} from '@/lib/review-preview';
import {
  buildMediaAnchor, buildTextAnchor, buildArtifactAnchor, anchorError, bodyError,
  anchorLabel, formatMs, sortIssues, isAnchorStale, type ReviewAnchor,
} from '@/lib/review-anchor';
import {
  reviewRoomActions, ACCEPT_DISCLAIMER,
  issuesForArtifact, artifactForIssue, isIssueStale, issueClickTarget,
} from '@/lib/review-room-state';

type Props = {
  runId: string;
  agentName: string;
  artifacts: ReviewArtifact[];
  issues: ReviewIssue[];
  session: ReviewSession;
  sources: Record<string, SourceState>;
  isApprovalHold: boolean;
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

export default function ReviewRoom(props: Props) {
  const router = useRouter();
  const { runId, artifacts, sources, isApprovalHold } = props;

  // Prefer the delivered result; fall back to the first validated artifact.
  const validated = useMemo(() => artifacts.filter((a) => a.status === 'validated'), [artifacts]);
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    const final = validated.find((a) => a.role === 'final_output');
    return (final || validated[0])?.id ?? null;
  });
  const artifact = useMemo(() => artifacts.find((a) => a.id === selectedId) ?? null, [artifacts, selectedId]);

  const [decision, setDecision] = useState<PreviewDecision | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const tokenRef = useRef<string | null>(null);
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);

  const [issues, setIssues] = useState<ReviewIssue[]>(props.issues);
  const [session, setSession] = useState<ReviewSession>(props.session);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // draft composer
  const [pausedAtMs, setPausedAtMs] = useState<number | null>(null);
  const [rangeEndMs, setRangeEndMs] = useState<number | null>(null);
  const [selection, setSelection] = useState<{ start: number; end: number; quote: string } | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [draftKind, setDraftKind] = useState<string>('content');
  const [draftBody, setDraftBody] = useState('');
  const [textContent, setTextContent] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // A seek requested for an artifact that is not on screen: the switch remounts the
  // media element, so the position is applied once the new one is ready.
  const [pendingSeekMs, setPendingSeekMs] = useState<number | null>(null);

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
  const frozen = !acts.canEditIssues && session?.state !== 'accepted' && !isApprovalHold;
  const accepted = session?.state === 'accepted';

  // ── preview lifecycle ─────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const prevToken = tokenRef.current;
    // Switching artifact or version revokes the previous token immediately rather than
    // leaving a live capability pointing at a file the user is no longer reviewing.
    if (prevToken) { revokePreview(prevToken); tokenRef.current = null; }
    setPreviewUrl(null);
    setTextContent(null);
    // Per-artifact draft state does not survive a switch: a position captured in the
    // previous file would anchor the next comment to a moment in a different video.
    setPausedAtMs(null);
    setRangeEndMs(null);
    setSelection(null);
    setComposerOpen(false);

    const base = decidePreview({
      artifact,
      inDesktop: inDesktopApp(),
      bridgeSupported: desktopPreviewSupported(),
    });
    setDecision(base);
    if (base.state !== 'loading' || !artifact) return;

    (async () => {
      const result = await requestPreview(runId, artifact.id);
      if (cancelled) return;
      const next = interpretPreviewResult(result, base.kind);
      setDecision(next);
      if (next.state !== 'ready') return;
      const url = (result as { url?: string; token?: string }).url;
      const token = (result as { token?: string }).token ?? null;
      // Belt and braces: never put anything but an opaque protocol URL in a src.
      if (!isSafePreviewUrl(url)) {
        setDecision({ ...next, state: 'unavailable', message: 'The preview link was not in an expected form, so it was not opened.' });
        return;
      }
      tokenRef.current = token;
      setPreviewUrl(url!);
      if (base.kind === 'text') {
        try {
          const r = await fetch(url!);
          const t = await r.text();
          if (!cancelled) setTextContent(t);
        } catch {
          if (!cancelled) setDecision({ ...next, state: 'unavailable', message: 'Implexa could not read this file for review just now. That does not mean the file is gone.' });
        }
      }
    })();

    return () => {
      cancelled = true;
      if (tokenRef.current) { revokePreview(tokenRef.current); tokenRef.current = null; }
    };
  }, [artifact, runId]);

  // ── issue creation ────────────────────────────────────────────────────────
  const ensureSession = useCallback(async (): Promise<string | null> => {
    if (session?.id) return session.id;
    const { body } = await reviewAction({ action: 'ensure_session', runId, artifactId: artifact?.id });
    if (body?.ok && body.session) { setSession(body.session); return body.session.id as string; }
    setError(body?.error || 'Could not open a review session.');
    return null;
  }, [session, runId, artifact]);

  const buildAnchor = useCallback((): ReviewAnchor | null => {
    const sha = artifact?.sha256;
    if (!sha) return null;
    if (selection) return buildTextAnchor(sha, selection.start, selection.end, selection.quote);
    if (pausedAtMs !== null) {
      return buildMediaAnchor(sha, pausedAtMs / 1000, rangeEndMs === null ? null : rangeEndMs / 1000);
    }
    return buildArtifactAnchor(sha);
  }, [artifact, selection, pausedAtMs, rangeEndMs]);

  const submitIssue = useCallback(async () => {
    setError(null);
    const anchor = buildAnchor();
    const aErr = anchorError(anchor);
    if (aErr) { setError(aErr); return; }
    const bErr = bodyError(draftBody);
    if (bErr) { setError(bErr); return; }
    setBusy(true);
    try {
      const sid = await ensureSession();
      if (!sid) return;
      const { body } = await reviewAction({
        action: 'create_issue', sessionId: sid, artifactId: artifact?.id,
        kind: draftKind, anchor, body: draftBody.trim(),
      });
      if (!body?.ok) {
        setError(body?.staleAnchor
          ? 'This file changed since you opened it, so the comment could not be anchored. Reload to review the current version.'
          : (body?.error || 'Could not save that issue.'));
        return;
      }
      setIssues((prev) => [...prev, body.issue]);
      setDraftBody(''); setComposerOpen(false); setSelection(null); setRangeEndMs(null);
    } finally { setBusy(false); }
  }, [buildAnchor, draftBody, draftKind, ensureSession, artifact]);

  const dismissIssue = useCallback(async (issueId: string) => {
    setBusy(true); setError(null);
    try {
      const { body } = await reviewAction({ action: 'dismiss_issue', issueId });
      if (!body?.ok) { setError(body?.error || 'Could not delete that issue.'); return; }
      setIssues((prev) => prev.map((i) => (i.id === issueId ? { ...i, status: 'dismissed' } : i)));
    } finally { setBusy(false); }
  }, []);

  const seekTo = useCallback((ms: number) => {
    const el = mediaRef.current;
    if (!el) return;
    el.currentTime = ms / 1000;
    el.pause();
    setPausedAtMs(ms);
  }, []);

  /**
   * Clicking an issue. If it belongs to another artifact we SWITCH FIRST and seek once
   * the new player exists — seeking now would move the wrong file to that timestamp.
   */
  const goToIssue = useCallback((issue: ReviewIssue) => {
    const target = issueClickTarget(issue, selectedId);
    if (target.needsSwitch && target.artifactId) {
      setSelectedId(target.artifactId);
      setPendingSeekMs(target.seekMs);
      return;
    }
    if (target.seekMs !== null) seekTo(target.seekMs);
  }, [selectedId, seekTo]);

  // Apply a seek that was requested before this artifact was on screen.
  useEffect(() => {
    if (pendingSeekMs === null) return;
    if (!previewUrl || !mediaRef.current) return;
    seekTo(pendingSeekMs);
    setPendingSeekMs(null);
  }, [pendingSeekMs, previewUrl, seekTo]);

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
      const sid = await ensureSession();
      if (!sid) return;
      const { body } = await reviewAction({ action: 'accept', sessionId: sid, discardOpenIssues: discard });
      if (body?.needsDiscardConfirmation) { setConfirmDiscard(true); return; }
      if (!body?.ok) { setError(body?.error || 'Could not accept this result.'); return; }
      setConfirmDiscard(false);
      setNotice('Result accepted.');
      router.refresh();
    } finally { setBusy(false); }
  }, [ensureSession, router]);

  const issuesUnavailable = sources.issues === 'unavailable';

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      {/* ── artifact surface ─────────────────────────────────────────────── */}
      <section className="rounded-lg border border-ink-800 bg-ink-900/40 p-4">
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
          decision={decision}
          previewUrl={previewUrl}
          textContent={textContent}
          mediaRef={mediaRef}
          issues={surfaceIssues}
          onPause={(sec) => setPausedAtMs(Math.round(sec * 1000))}
          onSelectText={(s) => { setSelection(s); setComposerOpen(true); }}
          onSeek={seekTo}
        />

        {artifact && (
          <p className="mt-3 truncate text-xs text-ink-500">
            {artifact.relativePath}
            {artifact.sha256 && <span className="ml-2 font-mono">sha256 {artifact.sha256.slice(0, 12)}…</span>}
          </p>
        )}

        {/* Persistent, keyboard-reachable. Not a modal that ambushes every pause. */}
        {!frozen && !accepted && artifact?.status === 'validated' && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setComposerOpen(true)}
              className="rounded-md border border-ink-700 px-3 py-1.5 text-sm text-ink-200 hover:border-ink-500"
            >
              {pausedAtMs !== null ? `+ Add feedback at ${formatMs(pausedAtMs)}` : '+ Add feedback'}
            </button>
            {pausedAtMs !== null && (
              <>
                <button
                  type="button"
                  onClick={() => setRangeEndMs(Math.round((mediaRef.current?.currentTime ?? 0) * 1000))}
                  className="rounded-md border border-ink-800 px-2 py-1 text-xs text-ink-400 hover:border-ink-600"
                >
                  Set end here
                </button>
                {rangeEndMs !== null && <span className="text-xs text-ink-500">→ {formatMs(rangeEndMs)}</span>}
              </>
            )}
          </div>
        )}

        {composerOpen && !frozen && !accepted && (
          <div className="mt-3 rounded-md border border-ink-700 bg-ink-950 p-3">
            <div className="mb-2 flex items-center gap-2 text-xs text-ink-400">
              <span>
                {selection ? `Characters ${selection.start}–${selection.end}`
                  : pausedAtMs !== null ? `At ${formatMs(pausedAtMs)}${rangeEndMs !== null ? ` – ${formatMs(rangeEndMs)}` : ''}`
                  : 'Whole file'}
              </span>
              <select
                value={draftKind}
                onChange={(e) => setDraftKind(e.target.value)}
                className="ml-auto rounded border border-ink-700 bg-ink-900 px-1.5 py-0.5 text-xs text-ink-200"
                aria-label="Issue type"
              >
                {ISSUE_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </div>
            <textarea
              autoFocus
              value={draftBody}
              onChange={(e) => setDraftBody(e.target.value)}
              rows={3}
              placeholder="What should change here?"
              className="w-full rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-sm text-ink-100"
            />
            <div className="mt-2 flex gap-2">
              <button
                type="button" disabled={busy} onClick={submitIssue}
                className="rounded-md bg-ink-100 px-3 py-1.5 text-sm font-medium text-ink-950 disabled:opacity-50"
              >
                Save issue
              </button>
              <button
                type="button"
                onClick={() => { setComposerOpen(false); setDraftBody(''); setSelection(null); }}
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

        {issuesUnavailable ? (
          // NOT an empty rail: we could not read them.
          <p className="mt-2 text-xs text-amber-300">
            We couldn&apos;t load this review&apos;s issues. This list is not empty — it&apos;s unknown.
          </p>
        ) : ordered.filter((i) => i.status !== 'dismissed').length === 0 ? (
          <p className="mt-2 text-xs text-ink-500">No issues yet. Pause and add feedback.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {visible.map((i) => {
              // Measured against the issue's OWN artifact. Comparing to the selected one
              // flags a current comment as stale merely because the user switched files.
              const stale = isIssueStale(i, artifacts);
              const own = artifactForIssue(i, artifacts);
              const elsewhere = !!i.artifactId && i.artifactId !== selectedId;
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
                  {i.status === 'draft' && !frozen && !accepted && (
                    <button
                      type="button" disabled={busy} onClick={() => dismissIssue(i.id)}
                      className="mt-1 text-xs text-ink-500 hover:text-red-300 disabled:opacity-50"
                    >
                      Delete
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {error && <p role="alert" className="mt-3 text-xs text-red-300">{error}</p>}
        {notice && <p role="status" className="mt-3 text-xs text-emerald-300">{notice}</p>}

        <div className="mt-4 space-y-2 border-t border-ink-800 pt-4">
          {acts.statusLine && !acts.canSubmit && !acts.canAccept && !acts.showApproveNextAction ? (
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
  decision, previewUrl, textContent, mediaRef, issues, onPause, onSelectText, onSeek,
}: {
  decision: PreviewDecision | null;
  previewUrl: string | null;
  textContent: string | null;
  mediaRef: React.MutableRefObject<HTMLVideoElement | HTMLAudioElement | null>;
  issues: ReviewIssue[];
  onPause: (seconds: number) => void;
  onSelectText: (s: { start: number; end: number; quote: string }) => void;
  onSeek: (ms: number) => void;
}) {
  if (!decision) return <div className="h-48 animate-pulse rounded bg-ink-800/50" />;

  if (decision.state !== 'ready' && decision.state !== 'loading') {
    return (
      <div className="rounded border border-ink-800 bg-ink-950 p-6 text-center">
        <p className="text-sm text-ink-200">{decision.message}</p>
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          {decision.offerOpenInDesktop && (
            <a
              href="implexa://review"
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
          ref={mediaRef as never}
          src={previewUrl}
          controls
          className={decision.kind === 'video' ? 'w-full rounded bg-black' : 'w-full'}
          onPause={(e) => onPause((e.currentTarget as HTMLMediaElement).currentTime)}
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
    return (
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
  }

  // pdf and anything else that reached ready
  return (
    <div className="rounded border border-ink-800 bg-ink-950 p-6 text-center text-sm text-ink-300">
      This file is ready, but inline viewing isn&apos;t supported yet. Open it externally to review.
    </div>
  );
}
