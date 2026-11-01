'use client';

/** Recording adapter for Training's shared playback and spatial annotation controls.
 * Native library custody and the historical five-key card wire stay unchanged;
 * the editor asks only for feedback and preserves earlier structured notes. */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import Modal from '../../../_components/modal';
import ReviewSpatialOverlay from '../../../_components/review-spatial-overlay';
import ReviewPlaybackControls from '../../../_components/review-playback-controls';
import { formatMs } from '@/lib/review-anchor';
import { inDesktopApp, revokePreview } from '@/lib/review-preview';
import { visualContentRect } from '@/lib/review-spatial-geometry';
import {
  CARD_FIELDS, CARD_FIELD_LABELS, CARD_FIELD_MAX, COORD_MAX, MAX_MOMENTS, MAX_MOMENT_MS, MOMENTS_NEXT_NOTE,
  addMoment, cardWarnings, createReviewRecorderClient, defaultRegionFromPointer, failureMessage, momentsDirty,
  pointerTrailAt, rangeFromDrag, rangesOverlap, recorderAvailability, recorderErrorMessage, recoverAction,
  regionFromSpatial, regionOverlayStyle, suggestMoments,
  type CardField, type Moment, type RecorderAvailability, type RecordingDetail, type RecordingPreview, type Region,
} from '@/lib/review-recorder';

const SNAP_MS = 100;
const BAR_DRAG_PX = 4;
const LEAVE_COPY = 'You have unsaved moments on this recording. If you leave now, those changes are lost.';

type Range = { startMs: number; endMs: number };

const pct = (n: number) => `${Math.round(n / (COORD_MAX / 100))}%`;
const regionLabel = (r: Region) => `${pct(r.width)} × ${pct(r.height)} at (${pct(r.x)}, ${pct(r.y)})`;
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

export default function RecordingPlayer({ recordingId,ownerId,trainingSlug,embedded=false,onAnalyzeNarration,onUseFeedback,narrationUnavailable,onDirtyChange,onClose,onRecordingLoaded }: { recordingId: string; ownerId:string;trainingSlug?:string;embedded?:boolean;onAnalyzeNarration?:(recordingId:string,momentId:string|null)=>void;onUseFeedback?:(recordingId:string,moment:Moment)=>void;narrationUnavailable?:string;onDirtyChange?:(dirty:boolean)=>void;onClose?:()=>void;onRecordingLoaded?:(detail:RecordingDetail)=>void }) {
  const router = useRouter();
  const client = useMemo(() => createReviewRecorderClient(undefined,ownerId), [ownerId]);
  const [availability, setAvailability] = useState<RecorderAvailability | null>(null);
  const [detail, setDetail] = useState<RecordingDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [preview, setPreview] = useState<RecordingPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Moment[]>([]);
  const [moments, setMoments] = useState<Moment[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [markStartMs, setMarkStartMs] = useState<number | null>(null);
  const [barDraft, setBarDraft] = useState<Range | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [regionError, setRegionError] = useState<string | null>(null);
  const [showTrail, setShowTrail] = useState(true);
  const [videoDims, setVideoDims] = useState<{ w: number; h: number } | null>(null);
  const [elementSize, setElementSize] = useState<{ w: number; h: number } | null>(null);
  const [playheadMs, setPlayheadMs] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [leaveHref, setLeaveHref] = useState<string | null>(null);

  const loadedCallback=useRef(onRecordingLoaded);loadedCallback.current=onRecordingLoaded;
  const dirtyCallback=useRef(onDirtyChange);dirtyCallback.current=onDirtyChange;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const playLineRef = useRef<HTMLDivElement | null>(null);
  const barGesture = useRef<{ anchorMs: number; startX: number; dragging: boolean } | null>(null);
  const loadSeq = useRef(0);
  const busyRef = useRef(false);

  const durationMs = detail?.state === 'ready' ? detail.durationMs : null;
  const samples = detail?.pointerTrack?.samples ?? null;
  const dirty = momentsDirty(saved, moments);
  useEffect(()=>{dirtyCallback.current?.(dirty);},[dirty]);
  const selected = moments.find((m) => m.momentId === selectedId) ?? null;
  const intrinsic = videoDims
    ?? (detail?.pointerTrack ? { w: detail.pointerTrack.videoWidth, h: detail.pointerTrack.videoHeight } : null)
    ?? (detail?.width && detail?.height ? { w: detail.width, h: detail.height } : null);

  const suggestions = useMemo(
    () => (durationMs === null ? [] : suggestMoments(samples, durationMs)),
    [samples, durationMs],
  );
  const openSuggestions = suggestions.filter((s) => !moments.some((m) => rangesOverlap(m, s)));

  // ── loading ────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    // Change events can trigger overlapping loads; only the newest answer applies.
    const seq = ++loadSeq.current;
    try {
      const d = await client.get(recordingId);
      if (seq !== loadSeq.current) return;
      setDetail(d);loadedCallback.current?.(d);
      setSaved(d.moments);
      setMoments(d.moments);
      setLoadError(null);
    } catch (caught) {
      if (seq !== loadSeq.current) return;
      setLoadError(recorderErrorMessage(caught) ?? 'This recording could not be opened just now.');
    }
  }, [client, recordingId]);

  useEffect(() => {
    const a = recorderAvailability();
    setAvailability(a);
    if (a.state !== 'ready') return;
    void load();
  }, [load]);

  // While a recording is still being saved, follow the Desktop's change events. Once it
  // is ready (and editable) the list is never reloaded underneath the Coach's edits.
  const detailState = detail?.state ?? null;
  useEffect(() => {
    if (availability?.state !== 'ready' || detailState === 'ready') return;
    return client.subscribe((e) => { if (e.recordingId === recordingId) void load(); });
  }, [availability, client, detailState, load, recordingId]);

  // One preview token per mounted ready recording, always revoked.
  useEffect(() => {
    if (detailState !== 'ready') return;
    let live = true;
    let token: string | null = null;
    client.preview(recordingId).then((p) => {
      if (!live) { void revokePreview(p.token); return; }
      token = p.token;
      setPreview(p);
      setPreviewError(null);
    }).catch((caught) => {
      if (live) setPreviewError(recorderErrorMessage(caught) ?? 'This recording could not be played just now.');
    });
    return () => { live = false; setPreview(null); if (token) void revokePreview(token); };
  }, [client, detailState, recordingId]);

  // ── unsaved-changes guard ─────────────────────────────────────────────────

  useEffect(() => {
    if (!dirty) return;
    // Plain browser only. Inside Implexa Desktop (Electron) a prevented beforeunload
    // shows NO dialog: it silently blocks Cmd+Q, window close and reload. There the
    // in-app modal below is the guard.
    const guardUnload = !inDesktopApp();
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    // In-app links are intercepted before Next's Link handler sees them, so leaving
    // asks first (a rare interruption, so a modal) instead of silently dropping edits.
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return;
      e.preventDefault();
      e.stopPropagation();
      setLeaveHref(url.pathname + url.search + url.hash);
    };
    if (guardUnload) window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      if (guardUnload) window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [dirty]);

  // ── element geometry and the trail ────────────────────────────────────────

  useEffect(() => {
    const v = videoRef.current;
    if (!v || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setElementSize({ w: v.clientWidth, h: v.clientHeight }));
    ro.observe(v);
    return () => ro.disconnect();
  }, [preview]);

  useEffect(() => {
    if (!preview || durationMs === null || typeof requestAnimationFrame !== 'function') return;
    let frame = 0;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      const v = videoRef.current;
      if (!v) return;
      const tMs = v.currentTime * 1000;
      if (playLineRef.current) playLineRef.current.style.left = `${Math.min(100, (tMs / Math.max(1, durationMs)) * 100)}%`;
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) return;
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth; const h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      }
      // CSS px below; the canvas backing store is scaled once, here.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (!showTrail || !samples) return;
      const box = visualContentRect({ elementWidth: w, elementHeight: h, naturalWidth: v.videoWidth, naturalHeight: v.videoHeight });
      if (!box) return;
      const px = (x: number) => box.left + (x / COORD_MAX) * box.width;
      const py = (y: number) => box.top + (y / COORD_MAX) * box.height;
      const runs = pointerTrailAt(samples, tMs);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(250, 204, 21, 0.75)';
      for (const run of runs) {
        ctx.beginPath();
        run.forEach(([x, y], i) => (i ? ctx.lineTo(px(x), py(y)) : ctx.moveTo(px(x), py(y))));
        ctx.stroke();
      }
      const last = runs.at(-1)?.at(-1);
      if (last) {
        ctx.fillStyle = 'rgba(250, 204, 21, 0.95)';
        ctx.beginPath(); ctx.arc(px(last[0]), py(last[1]), 5, 0, Math.PI * 2); ctx.fill();
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [preview, durationMs, samples, showTrail]);

  // ── marking ───────────────────────────────────────────────────────────────

  const seek = (ms: number) => { const v = videoRef.current; if (v) v.currentTime = ms / 1000; setPlayheadMs(ms); };

  // Read through refs so the handlers below never run side effects inside a state
  // updater (StrictMode invokes updaters twice, which would mint two moments).
  const momentsRef = useRef<Moment[]>(moments);
  momentsRef.current = moments;
  const markStartRef = useRef<number | null>(null);
  const setMark = (v: number | null) => { markStartRef.current = v; setMarkStartMs(v); };

  const createMoment = useCallback((range: Range | null, region?: Region | null) => {
    if (!range || durationMs === null) return;
    const prev = momentsRef.current;
    if (prev.length >= MAX_MOMENTS) { setNotice(`A recording can hold at most ${MAX_MOMENTS} moments.`); return; }
    const momentId = crypto.randomUUID();
    const next = addMoment(prev, {
      ...range,
      region: region !== undefined ? region : defaultRegionFromPointer(samples, range.startMs, range.endMs),
    }, durationMs, { momentId, createdAt: new Date().toISOString() });
    if (!next) { setNotice('That range could not be marked.'); return; }
    momentsRef.current = next;
    setMoments(next);
    setSelectedId(momentId);
    setNotice(null);
    requestAnimationFrame(()=>document.getElementById(`${momentId}-feedback`)?.focus());
  }, [durationMs, samples]);

  useEffect(() => {
    if (durationMs === null) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || leaveHref) return;
      if (e.key === 'Escape') { setMark(null); setDrawing(false); return; }
      if (e.key !== 'm' && e.key !== 'M') return;
      e.preventDefault();
      const now = Math.round((videoRef.current?.currentTime ?? 0) * 1000);
      const start = markStartRef.current;
      if (start === null) { setMark(now); setNotice(null); return; }
      const range = rangeFromDrag(start, now, durationMs);
      // Same rule as the bar: a moment needs a span. The mark stays open.
      if (!range || range.endMs <= range.startMs) {
        setNotice('A moment needs a start and an end. Play or seek, then press M again.');
        return;
      }
      setMark(null);
      createMoment(range);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [createMoment, durationMs, leaveHref]);

  const barMs = (clientX: number) => {
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect || durationMs === null || rect.width <= 0) return 0;
    return Math.min(durationMs, Math.max(0, ((clientX - rect.left) / rect.width) * durationMs));
  };
  const onBarDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (durationMs === null || e.button !== 0) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    barGesture.current = { anchorMs: barMs(e.clientX), startX: e.clientX, dragging: false };
  };
  const onBarMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = barGesture.current;
    if (!g || durationMs === null) return;
    if (!g.dragging && Math.abs(e.clientX - g.startX) <= BAR_DRAG_PX) return;
    g.dragging = true;
    setBarDraft(rangeFromDrag(g.anchorMs, barMs(e.clientX), durationMs, SNAP_MS));
  };
  const onBarUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = barGesture.current;
    barGesture.current = null;
    if (!g || durationMs === null) return;
    if (!g.dragging) { seek(Math.round(g.anchorMs)); return; }
    const range = rangeFromDrag(g.anchorMs, barMs(e.clientX), durationMs, SNAP_MS);
    setBarDraft(null);
    if (range && range.endMs > range.startMs) createMoment(range);
  };

  // ── region drawing on the picture ─────────────────────────────────────────
  // The Review Room's own <ReviewSpatialOverlay /> does the gesture: drag threshold,
  // letterbox rejection, pointer capture, keyboard Enter/Escape. With external
  // controls the entire picture is available; drawing never toggles playback.

  const freezeForRegion = () => {
    const v = videoRef.current;
    if (!v) return null;
    v.pause();
    if (v.seeking) return null;
    return Math.round(v.currentTime * 1000);
  };
  const onRegionAnnotate = ({ spatial, frozenTimestampMs }: { frozenTimestampMs: number | null; spatial: { geometry: { kind: 'point' | 'rect'; x: number; y: number; width: number | null; height: number | null } } }) => {
    if(!drawing){
      if(frozenTimestampMs===null||durationMs===null||frozenTimestampMs<0||frozenTimestampMs>durationMs){setRegionError('Wait for the picture to finish seeking, then mark it again.');return;}
      const region=regionFromSpatial(spatial.geometry);if(!region)return;
      createMoment({startMs:frozenTimestampMs,endMs:frozenTimestampMs},region);setRegionError(null);return;
    }
    if (!selected) return;
    if (frozenTimestampMs !== selected.startMs) {
      setRegionError('The picture moved from this moment’s start. Choose Draw region again, wait for seeking to finish, then mark the picture. Your moment and notes are unchanged.');
      return;
    }
    const region = regionFromSpatial(spatial.geometry);
    if (!region) return;
    setRegion(selected.momentId, region);
    setRegionError(null);
    setDrawing(false);
  };

  useEffect(() => {
    if (!drawing) return;
    // Keyboard path: focus the overlay so Enter places a box and Escape cancels.
    (document.querySelector('[data-testid="spatial-overlay"]') as HTMLElement | null)?.focus();
  }, [drawing]);

  // ── edits ─────────────────────────────────────────────────────────────────

  const patch = (id: string, fn: (m: Moment) => Moment) => setMoments((prev) => prev.map((m) => (m.momentId === id ? fn(m) : m)));
  const setRegion = (id: string, region: Region | null) => patch(id, (m) => ({ ...m, region }));
  const setField = (id: string, field: CardField, value: string) =>
    patch(id, (m) => ({ ...m, card: { ...m.card, [field]: value.slice(0, CARD_FIELD_MAX) } }));
  const removeMoment = (id: string) => {
    setMoments((prev) => prev.filter((m) => m.momentId !== id));
    if (selectedId === id) { setSelectedId(null); setDrawing(false); }
  };
  const selectMoment = (m: Moment) => { setSelectedId(m.momentId); seek(m.startMs); };

  async function save() {
    if (busyRef.current || durationMs === null) return false;
    busyRef.current = true; setBusy('save'); setError(null);
    // What is being sent. Edits made while the save is in flight must survive it.
    const sent = momentsRef.current;
    try {
      const stored = await client.saveMoments(recordingId, sent, durationMs);
      setSaved(stored);
      if (momentsRef.current === sent) {
        // Nothing changed meanwhile: the Desktop's stored list is the truth.
        momentsRef.current = stored;
        setMoments(stored);
        if (selectedId && !stored.some((m) => m.momentId === selectedId)) setSelectedId(null);
        setNotice('Feedback saved on this Mac.');return true;
      } else {
        // Newer edits stay, and stay dirty against the stored baseline.
        setNotice('Saved. You have changed moments since; save again to keep those changes.');
      }
    } catch (caught) {
      setError(recorderErrorMessage(caught));
    } finally { busyRef.current = false; setBusy(null); }
    return false;
  }

  async function recover() {
    if (busyRef.current) return;
    busyRef.current = true; setBusy('recover'); setError(null);
    try { await client.recover(recordingId); await load(); }
    catch (caught) { setError(recorderErrorMessage(caught)); }
    finally { busyRef.current = false; setBusy(null); }
  }

  // ── render ────────────────────────────────────────────────────────────────

  const back = (
    <Link href={trainingSlug?`/training/${encodeURIComponent(trainingSlug)}`:'/review/new'} className="text-sm text-sky-400 hover:underline">{trainingSlug?'← Back to Training':'← New review'}</Link>
  );

  if (availability && availability.state !== 'ready') {
    return (
      <Shell embedded={embedded} back={back} title="Recording">
        <p role="status" className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">{availability.message}</p>
      </Shell>
    );
  }
  if (loadError) {
    return <Shell embedded={embedded} back={back} title="Recording"><p role="status" className="text-sm text-amber-300">{loadError}</p></Shell>;
  }
  if (!detail) {
    return <Shell embedded={embedded} back={back} title="Recording"><div className="h-64 animate-pulse rounded bg-ink-800/50" aria-label="Loading recording" /></Shell>;
  }
  if (detail.state !== 'ready' || durationMs === null) {
    return (
      <Shell embedded={embedded} back={back} title={detail.title || 'Recording'}>
        {error && <p role="alert" className="mb-3 text-sm text-rose-300">{error}</p>}
        <div className="rounded-lg border border-ink-800 bg-ink-900/40 p-6 text-center text-sm text-ink-200">
          {detail.state === 'recording' && <p>This recording is still in progress. Stop it from the floating control bar.</p>}
          {detail.state === 'finalizing' && <p>Saving this recording… It opens here when it is ready.</p>}
          {detail.state === 'failed' && <p>This recording could not be saved. {failureMessage(detail.failureReason)}</p>}
          {detail.state === 'interrupted' && <p>This recording stopped unexpectedly. Recover keeps what was saved before it stopped.</p>}
          {recoverAction(detail) && (
            <button type="button" disabled={busy !== null} onClick={() => void recover()}
              className="mt-3 rounded-md border border-amber-500/40 px-3 py-1.5 text-sm text-amber-200 disabled:opacity-40">
              {busy === 'recover' ? 'Working…' : recoverAction(detail)!.label}
            </button>
          )}
        </div>
      </Shell>
    );
  }

  const overlayDims = elementSize && intrinsic
    ? { elementWidth: elementSize.w, elementHeight: elementSize.h, videoWidth: intrinsic.w, videoHeight: intrinsic.h }
    : null;
  const selectedRegionStyle = selected?.region && overlayDims ? regionOverlayStyle(selected.region, overlayDims) : null;
  const pctOf = (ms: number) => `${(ms / Math.max(1, durationMs)) * 100}%`;
  const full = moments.length >= MAX_MOMENTS;

  return (
    <Shell embedded={embedded} back={back} title={detail.title || 'Recording'}>
      {error && <p role="alert" className="mb-3 rounded border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</p>}

      {embedded&&onClose&&<button type="button" className="text-xs text-ink-400 underline" onClick={onClose}>Close recording</button>}
      <div className="relative">
        {previewError && <p role="status" className="rounded border border-ink-800 bg-ink-950 p-6 text-center text-sm text-ink-200">{previewError}</p>}
        {!preview && !previewError && <div className="h-64 animate-pulse rounded bg-ink-800/50" aria-label="Loading video" />}
        {preview && (
          <ReviewPlaybackControls key={recordingId} mediaKey={recordingId} mediaRef={videoRef} onSeek={seek}>
          <>
          <div className="relative">
            <video
              ref={videoRef}
              src={preview.url}
              className="max-h-[60vh] w-full rounded bg-black object-contain"
              onLoadedMetadata={(e) => {
                const v = e.currentTarget;
                setVideoDims(v.videoWidth && v.videoHeight ? { w: v.videoWidth, h: v.videoHeight } : null);
                setElementSize({ w: v.clientWidth, h: v.clientHeight });
              }}
              onTimeUpdate={(e) => setPlayheadMs(Math.round(e.currentTarget.currentTime * 1000))}
              onSeeked={(e) => setPlayheadMs(Math.round(e.currentTarget.currentTime * 1000))}
            />
            <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true" />
            {selectedRegionStyle && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute rounded-sm border-2 border-sky-400 bg-sky-400/10"
                style={{ left: `${selectedRegionStyle.leftPct}%`, top: `${selectedRegionStyle.topPct}%`, width: `${selectedRegionStyle.widthPct}%`, height: `${selectedRegionStyle.heightPct}%` }}
              />
            )}
            {(
              <ReviewSpatialOverlay
                mediaKind="video"
                controlsMode="external"
                mediaEl={() => videoRef.current}
                enabled
                pins={moments.flatMap((m,i)=>m.region&&playheadMs>=m.startMs&&playheadMs<=m.endMs?[{issueId:m.momentId,ordinal:i+1,geometry:{kind:'rect' as const,x:m.region.x/COORD_MAX,y:m.region.y/COORD_MAX,width:m.region.width/COORD_MAX,height:m.region.height/COORD_MAX},highlighted:m.momentId===selectedId,title:m.card.whatToDo||'Feedback'}]:[])}
                draftSpatial={null}
                freezeMedia={freezeForRegion}
                onAnnotate={onRegionAnnotate}
                onNudgeDraft={() => {}}
                onCancelDraft={() => setDrawing(false)}
                onOpenIssue={id=>{const moment=moments.find(m=>m.momentId===id);if(moment){selectMoment(moment);document.getElementById(`${id}-feedback`)?.focus();}}}
              />
            )}
          </div>
          {regionError && <p role="alert" className="p-3 text-xs text-amber-300">{regionError}</p>}
          </>
          </ReviewPlaybackControls>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-400">
        <span className="font-mono">{formatMs(playheadMs)} / {formatMs(durationMs)}</span>
        <div className="flex items-center gap-3">
          {detail.hasPointerTrack && (
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={showTrail} onChange={(e) => setShowTrail(e.target.checked)} />
              Pointer trail
            </label>
          )}
          {drawing && <span className="text-sky-300">Drag a box on the picture (or click for a box around a point).</span>}
          {drawing && <button type="button" onClick={() => setDrawing(false)} className="text-sky-300 hover:underline">Cancel drawing</button>}
        </div>
      </div>

      {/* The range bar: drag to mark (≤ 30 s, snapped to 100 ms); a click seeks. */}
      <div
        ref={barRef}
        role="group"
        aria-label="Recording timeline. Drag to mark a moment; click to seek."
        onPointerDown={onBarDown}
        onPointerMove={onBarMove}
        onPointerUp={onBarUp}
        onPointerCancel={() => { barGesture.current = null; setBarDraft(null); }}
        className="relative mt-3 h-10 cursor-text select-none rounded bg-ink-800/70"
      >
        {openSuggestions.map((s) => (
          <button
            key={`s-${s.startMs}`}
            type="button"
            title={`Suggested: the pointer rested here (${formatMs(s.startMs)}–${formatMs(s.endMs)}). Click to add.`}
            disabled={full}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => createMoment({ startMs: s.startMs, endMs: s.endMs }, s.region)}
            className="absolute top-1 bottom-1 rounded-sm border border-dashed border-amber-300/70 bg-amber-300/10 hover:bg-amber-300/25"
            style={{ left: pctOf(s.startMs), width: `max(4px, ${pctOf(s.endMs - s.startMs)})` }}
          />
        ))}
        {moments.map((m, i) => (
          <button
            key={m.momentId}
            type="button"
            title={`Moment ${i + 1}: ${formatMs(m.startMs)}–${formatMs(m.endMs)}`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => selectMoment(m)}
            className={`absolute top-1 bottom-1 rounded-sm ${m.momentId === selectedId ? 'bg-sky-400/70 ring-1 ring-sky-200' : 'bg-sky-500/45 hover:bg-sky-500/60'}`}
            style={{ left: pctOf(m.startMs), width: `max(4px, ${pctOf(m.endMs - m.startMs)})` }}
          />
        ))}
        {barDraft && (
          <div className="pointer-events-none absolute top-0 bottom-0 rounded-sm border-2 border-sky-300 bg-sky-300/20"
            style={{ left: pctOf(barDraft.startMs), width: pctOf(barDraft.endMs - barDraft.startMs) }} />
        )}
        {markStartMs !== null && (
          <div className="pointer-events-none absolute top-0 bottom-0 w-0.5 bg-rose-400" style={{ left: pctOf(markStartMs) }} />
        )}
        <div ref={playLineRef} className="pointer-events-none absolute top-0 bottom-0 w-px bg-white" style={{ left: pctOf(playheadMs) }} />
      </div>
      <p className="mt-1.5 text-xs text-ink-500">
        {markStartMs !== null
          ? `Marking from ${formatMs(markStartMs)}. Press M again to end (at most ${MAX_MOMENT_MS / 1000} s), or Esc to cancel.`
          : `Drag on the bar to mark a moment, or press M to start and M again to end. Dashed marks are suggestions: click one to add it.`}
      </p>
      {barDraft && <p className="text-xs text-sky-300">{formatMs(barDraft.startMs)}–{formatMs(barDraft.endMs)} ({seconds(barDraft.endMs - barDraft.startMs)})</p>}
      <p className="mt-2 text-xs text-ink-500">Click the video to leave feedback. Drag to mark an area.</p>
      {notice && <p role="status" className="mt-2 text-xs text-ink-300">{notice}</p>}

      <section aria-label="Moments" className="mt-8">
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-lg font-medium text-ink-100">Moments <span className="text-sm font-normal text-ink-500">{moments.length} of {MAX_MOMENTS}</span></h2>
          <button
            type="button"
            disabled={!dirty || busy !== null}
            onClick={() => void save()}
            className="rounded-md bg-ink-100 px-3 py-1.5 text-sm font-medium text-ink-950 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy === 'save' ? 'Saving…' : dirty ? 'Save feedback' : 'Saved'}
          </button>
        </div>
        <p className="mb-4 text-xs text-ink-500">{embedded?'Save your feedback, then turn a mark into a learning.':MOMENTS_NEXT_NOTE}</p>

        {moments.length === 0 && (
          <p className="rounded-lg border border-ink-800 bg-ink-900/40 px-4 py-6 text-center text-sm text-ink-400">No moments yet.</p>
        )}

        <ol className="space-y-4">
          {moments.map((m, i) => {
            const isSel = m.momentId === selectedId;
            const pointerBox = defaultRegionFromPointer(samples, m.startMs, m.endMs);
            const warnings = cardWarnings(m.card);
            return (
              <li key={m.momentId} className={`rounded-lg border p-4 ${isSel ? 'border-sky-500/60 bg-ink-900/70' : 'border-ink-800 bg-ink-900/40'}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <button type="button" onClick={() => selectMoment(m)} className="font-mono text-sm text-sky-300 hover:underline">
                    {i + 1}. {formatMs(m.startMs)}–{formatMs(m.endMs)} <span className="text-ink-500">({seconds(m.endMs - m.startMs)})</span>
                  </button>
                  <button type="button" onClick={() => removeMoment(m.momentId)} className="text-xs text-ink-400 hover:text-rose-300">Delete</button>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-400">
                  <span>Region: {m.region ? regionLabel(m.region) : 'none'}</span>
                  <button type="button" onClick={() => { videoRef.current?.pause(); selectMoment(m); setRegionError(null); setDrawing(true); }} className="text-sky-300 hover:underline">Draw region</button>
                  {pointerBox && <button type="button" onClick={() => setRegion(m.momentId, pointerBox)} className="text-sky-300 hover:underline">Use pointer box</button>}
                  {m.region && <button type="button" onClick={() => setRegion(m.momentId, null)} className="text-ink-400 hover:underline">Clear region</button>}
                </div>
                <div className="mt-3"><label htmlFor={`${m.momentId}-feedback`} className="sr-only">What should change here?</label><textarea id={`${m.momentId}-feedback`} placeholder="What should change here?" rows={3} maxLength={CARD_FIELD_MAX} value={m.card.whatToDo} onFocus={()=>setSelectedId(m.momentId)} onChange={e=>setField(m.momentId,'whatToDo',e.target.value)} className="mt-1 w-full rounded border border-ink-700 bg-ink-950 px-3 py-2 text-sm text-ink-100 focus:border-sky-500 focus:outline-none"/>
                  {warnings.whatToDo&&<p data-testid="card-warning" className="mt-1 text-xs text-amber-300">{warnings.whatToDo.join(' ')}</p>}
                </div>
                {onUseFeedback&&<button type="button" className="mt-3 text-sm text-brand-400" disabled={busy!==null||dirty||!m.card.whatToDo.trim()} onClick={()=>onUseFeedback(recordingId,m)}>Turn into a learning</button>}
                {CARD_FIELDS.some(field=>field!=='whatToDo'&&m.card[field].trim())&&<details className="mt-3 text-xs text-ink-400"><summary>Previously saved notes</summary>{CARD_FIELDS.filter(field=>field!=='whatToDo'&&m.card[field].trim()).map(field=><p key={field} className="mt-2 whitespace-pre-wrap"><strong>{CARD_FIELD_LABELS[field]}:</strong> {m.card[field]}</p>)}</details>}
              </li>
            );
          })}
        </ol>
      </section>

      <section className="my-4 flex flex-wrap items-center gap-3 text-sm">
        {onAnalyzeNarration?<button type="button" className="btn-primary" disabled={busy!==null||!!narrationUnavailable} onClick={async()=>{if(dirty&&!(await save()))return;onAnalyzeNarration(recordingId,selectedId);}}>Find learnings in my narration</button>:<>{trainingSlug?<button type="button" disabled={dirty||busy!==null} onClick={()=>router.push(`/training/${encodeURIComponent(trainingSlug)}?recordingId=${recordingId}${selectedId?`&momentId=${selectedId}`:''}`)}>Use in Training</button>:<Link href={`/training?recordingId=${recordingId}`}>Choose an agent for Training</Link>}</>}
        {onAnalyzeNarration&&narrationUnavailable&&<p className="text-xs text-ink-400">{narrationUnavailable}</p>}
      </section>

      <Modal open={leaveHref !== null} onClose={() => setLeaveHref(null)} title="Leave without saving?">
        <p className="text-sm text-ink-300">{LEAVE_COPY}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={() => setLeaveHref(null)} className="rounded-md border border-ink-700 px-3 py-1.5 text-sm text-ink-200">Keep editing</button>
          <button
            type="button"
            onClick={() => { const href = leaveHref; setLeaveHref(null); if (href) router.push(href); }}
            className="rounded-md bg-rose-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-400"
          >
            Leave without saving
          </button>
        </div>
      </Modal>
    </Shell>
  );
}

function Shell({ back, title, children,embedded=false }: {embedded?:boolean; back: ReactNode; title: string; children: ReactNode }) {
  if(embedded)return <section id="recording-annotation" tabIndex={-1} aria-label="Annotate your recording" className="space-y-4"><h2 className="text-lg font-medium">Annotate your recording</h2>{children}</section>;
  return (
    <div className="min-h-screen px-6 py-10 lg:px-12">
      <div className="mx-auto max-w-4xl">
        <div className="mb-4">{back}</div>
        <h1 className="mb-5 truncate text-2xl font-semibold tracking-tight text-ink-50">{title}</h1>
        {children}
      </div>
    </div>
  );
}
