'use client';

/** Recording adapter for Training's shared playback and spatial annotation controls.
 * Native library custody and the historical five-key card wire stay unchanged;
 * the editor asks only for feedback and preserves earlier structured notes. */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Modal from '../../../_components/modal';
import PageHeader from '@/components/page-header';
import AnnotationWorkspace from '../../../_components/annotation-workspace';
import AnnotationTimeline,{useTimelineFramePreview} from '../../../_components/annotation-timeline';
import {useAnnotationNotePlacement} from '../../../_components/use-annotation-note-placement';
import ReviewSpatialOverlay from '../../../_components/review-spatial-overlay';
import ReviewPlaybackControls from '../../../_components/review-playback-controls';
import TrainerVoiceNote from '../../../_components/trainer-voice-note';
import { formatMs as preciseTime, formatMediaTime as formatMs } from '@/lib/review-anchor';
import { inDesktopApp, revokePreview } from '@/lib/review-preview';
import { visualContentRect } from '@/lib/review-spatial-geometry';
import {
  CARD_FIELDS, CARD_FIELD_LABELS, CARD_FIELD_MAX, COORD_MAX, MAX_MOMENTS, MAX_MOMENT_MS, MOMENTS_NEXT_NOTE,
  addMoment, momentAt, cardWarnings, createReviewRecorderClient, defaultRegionFromPointer, failureMessage, momentsDirty,
  pointerTrailAt, rangeFromDrag, rangesOverlap, recorderAvailability, recorderErrorMessage, recoverAction,
  regionFromSpatial, regionOverlayStyle, suggestMoments,
  type CardField, type Moment, type RecorderAvailability, type RecordingDetail, type RecordingPreview, type Region,
} from '@/lib/review-recorder';

const SNAP_MS = 100;
const LEAVE_COPY = 'Your latest changes are still saving or couldn’t be saved. Leaving now may lose them.';

type Range = { startMs: number; endMs: number };

const pct = (n: number) => `${Math.round(n / (COORD_MAX / 100))}%`;
const regionLabel = (r: Region) => `${pct(r.width)} × ${pct(r.height)} at (${pct(r.x)}, ${pct(r.y)})`;
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/** Keep the whole picture note visible when opening it from below the video. */
function focusPictureNote(momentId:string){
  window.setTimeout(()=>{
    const field=document.getElementById(`${momentId}-feedback`);
    field?.closest<HTMLElement>('.recording-note')?.scrollIntoView?.({block:'nearest'});
    field?.focus({preventScroll:true});
  },0);
}

export default function RecordingPlayer({ recordingId,ownerId,trainingSlug,embedded=false,fullPage=false,feedbackSaveUnavailable,initialMomentId,onAnalyzeNarration,onAnalyzeTool,onUseFeedback,onDoneTeaching,onTrainerNarrationChange,trainerNarration=false,narrationUnavailable,onDirtyChange,onClose,onRecordingLoaded,trainingReview,trainingFrames }: { recordingId: string; ownerId:string;trainingSlug?:string;embedded?:boolean;fullPage?:boolean;feedbackSaveUnavailable?:string;initialMomentId?:string;onAnalyzeNarration?:(recordingId:string,momentId:string|null)=>void;onAnalyzeTool?:(recordingId:string,momentId:string|null)=>void;onUseFeedback?:(recordingId:string,moment:Moment)=>void;onDoneTeaching?:(recordingId:string,moments:Moment[])=>void;trainerNarration?:boolean;onTrainerNarrationChange?:(enabled:boolean)=>void;narrationUnavailable?:string;onDirtyChange?:(dirty:boolean)=>void;onClose?:()=>void;onRecordingLoaded?:(detail:RecordingDetail)=>void;trainingReview?:ReactNode;trainingFrames?:Array<{timeMs:number;image:string}> }) {
  const router = useRouter();
  const client = useMemo(() => createReviewRecorderClient(undefined,ownerId), [ownerId]);
  const [availability, setAvailability] = useState<RecorderAvailability | null>(null);
  const [detail, setDetail] = useState<RecordingDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [preview, setPreview] = useState<RecordingPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Moment[]>([]);
  const [moments, setMoments] = useState<Moment[]>([]);
  const [voiceDirty,setVoiceDirty]=useState<Set<string>>(()=>new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const noteSnapshot = useRef<{id:string;before:Moment|null}|null>(null);
  const [hoverMs,setHoverMs] = useState<number|null>(null);
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
  const workspaceRef=useRef<HTMLDivElement|null>(null),noteRef=useRef<HTMLDivElement|null>(null);

  const playLineRef = useRef<HTMLDivElement | null>(null);
  const resizeGesture = useRef<{moment:Moment;edge:'startMs'|'endMs'}|null>(null);
  const loadSeq = useRef(0);
  const busyRef = useRef(false);
  const scope=`${ownerId}:${recordingId}`;
  const scopeRef=useRef(scope);scopeRef.current=scope;
  const loadedScope=useRef<string|null>(null);
  const failedAutoSave=useRef<Moment[]|null>(null);

  useLayoutEffect(()=>{
    if(loadedScope.current===scope)return;
    setDetail(null);setSaved([]);setMoments([]);setSelectedId(null);setVoiceDirty(new Set());noteSnapshot.current=null;setError(null);failedAutoSave.current=null;
  },[scope]);

  const durationMs = detail?.state === 'ready' ? detail.durationMs : null;
  const samples = detail?.pointerTrack?.samples ?? null;
  const dirty = momentsDirty(saved, moments)||voiceDirty.size>0;
  useEffect(()=>{dirtyCallback.current?.(dirty);},[dirty]);
  const selected = moments.find((m) => m.momentId === selectedId) ?? null;
  const intrinsic = videoDims
    ?? (detail?.pointerTrack ? { w: detail.pointerTrack.videoWidth, h: detail.pointerTrack.videoHeight } : null)
    ?? (detail?.width && detail?.height ? { w: detail.width, h: detail.height } : null);

  const notePosition=useAnnotationNotePlacement(videoRef,noteRef,!!selected,selected?.region?{x:selected.region.x/COORD_MAX,y:selected.region.y/COORD_MAX,width:selected.region.width/COORD_MAX,height:selected.region.height/COORD_MAX}:null,preview);

  const suggestions = useMemo(
    () => (durationMs === null ? [] : suggestMoments(samples, durationMs)),
    [samples, durationMs],
  );
  const openSuggestions = suggestions.filter((s) => !moments.some((m) => rangesOverlap(m, s)));

  // One shared decoder hook samples the frame under the pointer (see annotation-timeline).
  const {image:hoverFrame,anyImage:hoverImage,unavailable:hoverUnavailable}=useTimelineFramePreview(preview?.url??null,hoverMs);

  // ── loading ────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    // Change events can trigger overlapping loads; only the newest answer applies.
    const seq = ++loadSeq.current;
    const expectedScope=scope;
    try {
      const d = await client.get(recordingId);
      if (seq !== loadSeq.current||scopeRef.current!==expectedScope) return;
      loadedScope.current=expectedScope;
      setDetail(d);loadedCallback.current?.(d);
      if(initialMomentId&&d.moments.some(m=>m.momentId===initialMomentId))setSelectedId(initialMomentId);
      setSaved(d.moments);
      setMoments(d.moments);
      setLoadError(null);
    } catch (caught) {
      if (seq !== loadSeq.current||scopeRef.current!==expectedScope) return;
      setLoadError(recorderErrorMessage(caught) ?? 'This recording could not be opened just now.');
    }
  }, [client, recordingId, scope]);

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
    if (!dirty||fullPage) return;
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
  }, [dirty,fullPage]);

  useEffect(()=>{if(!dirty)setLeaveHref(null);},[dirty]);

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
    noteSnapshot.current={id:momentId,before:null};
    setSelectedId(momentId);
    setNotice(null);
    focusPictureNote(momentId);
  }, [durationMs, samples]);

  function addTrainingMoment(timeMs:number){
    if(durationMs===null)return;
    const frameMs=Math.min(timeMs,durationMs-1);
    seek(frameMs);
    createMoment(momentAt(frameMs,durationMs),{x:0,y:0,width:COORD_MAX,height:COORD_MAX});
  }

  useEffect(() => {
    if (durationMs === null) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.repeat || leaveHref) return;
      if (e.key === 'Escape') { setDrawing(false); return; }
      if (e.key !== 'm' && e.key !== 'M') return;
      e.preventDefault();
      if(voiceDirty.size)return;
      const video=videoRef.current;
      if(!video||video.seeking)return;
      video.pause();
      createMoment(momentAt(video.currentTime*1000,durationMs));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [createMoment, durationMs, leaveHref,voiceDirty.size]);

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
      createMoment(momentAt(frozenTimestampMs,durationMs),region);setRegionError(null);return;
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
  const setRegion = (id: string, region: Region | null) => {if(!voiceDirty.has(id))patch(id, (m) => ({ ...m, region }));};
  const setField = (id: string, field: CardField, value: string) =>
    patch(id, (m) => ({ ...m, card: { ...m.card, [field]: value.slice(0, CARD_FIELD_MAX) } }));
  const removeMoment = (id: string) => {
    if(voiceDirty.has(id))return;
    setMoments((prev) => prev.filter((m) => m.momentId !== id));
    if (selectedId === id) { setSelectedId(null); setDrawing(false); }
  };
  const selectMoment = (m: Moment) => {
    if(voiceDirty.size){setNotice('Insert or discard your voice note before changing moments.');return;}
    if(noteSnapshot.current?.id!==m.momentId)noteSnapshot.current={id:m.momentId,before:m};
    setSelectedId(m.momentId); seek(m.startMs);
  };
  function cancelNote(){
    const snapshot=noteSnapshot.current;
    if(!snapshot||voiceDirty.size)return;
    const next=snapshot.before?momentsRef.current.map(m=>m.momentId===snapshot.id?snapshot.before!:m):momentsRef.current.filter(m=>m.momentId!==snapshot.id);
    momentsRef.current=next;setMoments(next);setSelectedId(null);setDrawing(false);noteSnapshot.current=null;
  }
  async function doneNote(){
    if(voiceDirty.size)return;
    if(!momentsDirty(saved,momentsRef.current)||await save()){setSelectedId(null);setDrawing(false);noteSnapshot.current=null;}
  }

  function resizeMoment(moment:Moment,edge:'startMs'|'endMs',ms:number){
    if(durationMs===null||voiceDirty.size)return;
    const snapped=Math.round(ms/SNAP_MS)*SNAP_MS;
    const value=edge==='startMs'?Math.max(0,Math.min(moment.endMs,snapped),moment.endMs-MAX_MOMENT_MS):Math.min(durationMs,Math.max(moment.startMs,snapped),moment.startMs+MAX_MOMENT_MS);
    patch(moment.momentId,current=>({...current,[edge]:value}));
  }

  async function save() {
    if (busyRef.current || durationMs === null || loadedScope.current!==scope || detail?.recordingId!==recordingId) return false;
    const expectedScope=scope;
    busyRef.current = true; setBusy('save'); setError(null);
    // What is being sent. Edits made while the save is in flight must survive it.
    const sent = momentsRef.current;
    failedAutoSave.current=null;
    try {
      const stored = await client.saveMoments(recordingId, sent, durationMs);
      if(scopeRef.current!==expectedScope)return false;
      setSaved(stored);
      if (momentsRef.current === sent) {
        // Nothing changed meanwhile: the Desktop's stored list is the truth.
        momentsRef.current = stored;
        setMoments(stored);
        if (selectedId && !stored.some((m) => m.momentId === selectedId)) setSelectedId(null);
        setNotice('Feedback saved on this Mac.');return true;
      } else {
        // Newer edits stay, and stay dirty against the stored baseline.
        setNotice('Saving your latest changes…');
      }
    } catch (caught) {
      if(scopeRef.current===expectedScope){failedAutoSave.current=sent;setError(recorderErrorMessage(caught)||'Your latest changes couldn’t be saved. Try again.');}
    } finally { busyRef.current = false; setBusy(null); }
    return false;
  }

  // Debounce and serialize through the existing typed save path. A failure pauses
  // automatic retries for that exact draft; newer edits or explicit Retry can save.
  useEffect(()=>{
    if(detail?.state!=='ready'||loadedScope.current!==scope||detail.recordingId!==recordingId||busy||voiceDirty.size||!momentsDirty(saved,moments)||failedAutoSave.current===moments)return;
    const timer=window.setTimeout(()=>void save(),650);
    return()=>window.clearTimeout(timer);
    // save uses this render’s draft and the same scope/owner checks as Done.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[moments,saved,busy,voiceDirty.size,scope,detail?.state,detail?.recordingId]);


  async function recover() {
    if (busyRef.current) return;
    busyRef.current = true; setBusy('recover'); setError(null);
    try { await client.recover(recordingId); await load(); }
    catch (caught) { setError(recorderErrorMessage(caught)); }
    finally { busyRef.current = false; setBusy(null); }
  }

  // ── render ────────────────────────────────────────────────────────────────

  const back = (
    <Link href={trainingSlug?`/training/${encodeURIComponent(trainingSlug)}`:'/review/new'} className="text-secondary text-state-running hover:underline">{trainingSlug?'← Back to Training':'← New review'}</Link>
  );

  if (availability && availability.state !== 'ready') {
    return (
      <Shell embedded={embedded} fullPage={fullPage} back={back} title="Recording">
        <p role="status" className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-reading text-state-needs">{availability.message}</p>
      </Shell>
    );
  }
  if (loadError) {
    return <Shell embedded={embedded} fullPage={fullPage} back={back} title="Recording"><p role="status" className="text-reading text-state-needs">{loadError}</p></Shell>;
  }
  if (!detail) {
    return <Shell embedded={embedded} fullPage={fullPage} back={back} title="Recording"><div className="h-64 animate-pulse rounded bg-ink-800/50" aria-label="Loading recording" /></Shell>;
  }
  if (detail.state !== 'ready' || durationMs === null) {
    return (
      <Shell embedded={embedded} fullPage={fullPage} back={back} title={detail.title || 'Recording'}>
        {error && <p role="alert" className="mb-3 text-reading text-state-fail">{error}</p>}
        <div className="rounded-lg border border-ink-800 bg-ink-900/40 p-6 text-center text-secondary text-ink-200">
          {detail.state === 'recording' && <p>This recording is still in progress. Stop it from the floating control bar.</p>}
          {detail.state === 'finalizing' && <p>Saving this recording… It opens here when it is ready.</p>}
          {detail.state === 'failed' && <p>This recording could not be saved. {failureMessage(detail.failureReason)}</p>}
          {detail.state === 'interrupted' && <p>This recording stopped unexpectedly. Recover keeps what was saved before it stopped.</p>}
          {recoverAction(detail) && (
            <button type="button" disabled={busy !== null} onClick={() => void recover()}
              className="mt-3 rounded-md border border-amber-500/40 px-3 py-1.5 text-ui text-state-needs disabled:opacity-40">
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
  const full = moments.length >= MAX_MOMENTS;

  const finishTeaching=async()=>{
    if(dirty&&!(await save()))return;
    const notes=momentsRef.current.filter(moment=>CARD_FIELDS.some(field=>moment.card[field].trim()));
    if(notes.length)onDoneTeaching?.(recordingId,notes);else onAnalyzeNarration?.(recordingId,selectedId);
  };
  const teachingDisabled=!!feedbackSaveUnavailable&&moments.some(moment=>CARD_FIELDS.some(field=>moment.card[field].trim()))||busy!==null||voiceDirty.size>0||(!moments.some(moment=>CARD_FIELDS.some(field=>moment.card[field].trim()))&&(!onAnalyzeNarration||!!narrationUnavailable));
  const doneTeaching=onDoneTeaching?<div><button type="button" className="btn-primary" disabled={teachingDisabled} onClick={()=>void finishTeaching()}>Done teaching</button>{feedbackSaveUnavailable&&<p role="status" className="mt-2 text-secondary text-ink-400">{feedbackSaveUnavailable}</p>}</div>:null;
  const markButton=<button type="button" aria-label="Mark this moment" className="btn-success recording-mark" disabled={full||voiceDirty.size>0} onClick={()=>{const ms=freezeForRegion();if(ms!==null)createMoment(momentAt(ms,durationMs),{x:0,y:0,width:COORD_MAX,height:COORD_MAX});}}>+ Mark this moment</button>;

  const timeline = (
    <AnnotationTimeline
      durationMs={durationMs} playheadMs={playheadMs} playLineRef={playLineRef} noun="Moment" snapMs={SNAP_MS}
      label="Recording timeline. Click to jump, drag to mark a moment, drag the round handle to scrub."
      marks={moments.map(m=>({id:m.momentId,startMs:m.startMs,endMs:m.endMs,selected:m.momentId===selectedId,resizable:true,title:`Exact range: ${preciseTime(m.startMs)}–${preciseTime(m.endMs)}`}))}
      onSeek={seek} onOpen={id=>{const m=momentsRef.current.find(x=>x.momentId===id);if(m)selectMoment(m);}}
      toRange={(anchorMs,headMs)=>rangeFromDrag(anchorMs,headMs,durationMs,SNAP_MS)}
      onRange={range=>createMoment(range)} onRangeDraft={setBarDraft}
      resizeDisabled={voiceDirty.size>0}
      onResizeStart={(id,edge)=>{const m=momentsRef.current.find(x=>x.momentId===id);if(!m)return;selectMoment(m);resizeGesture.current={moment:m,edge};}}
      onResize={(id,edge,ms)=>{const g=resizeGesture.current;if(g?.moment.momentId===id&&g.edge===edge)resizeMoment(g.moment,edge,ms);}}
      onResizeEnd={(_id,_edge,cancelled)=>{const g=resizeGesture.current;if(cancelled&&g)patch(g.moment.momentId,current=>({...current,startMs:g.moment.startMs,endMs:g.moment.endMs}));resizeGesture.current=null;}}
      onResizeKey={(id,edge,direction)=>{const m=momentsRef.current.find(x=>x.momentId===id);if(!m)return;selectMoment(m);resizeMoment(m,edge,m[edge]+direction*SNAP_MS);}}
      onHover={setHoverMs}
      hoverContent={()=><>{hoverFrame&&<img src={hoverFrame.url} alt="Timeline preview" className="mb-1 max-h-48 w-48 rounded object-contain"/>}{hoverUnavailable&&<span className="mb-1 block text-secondary">Frame preview unavailable</span>}</>}
    >{pctOf=>openSuggestions.map((s) => (
          <button
            key={`s-${s.startMs}`}
            type="button"
            title={`Suggested: the pointer rested here (${formatMs(s.startMs)}–${formatMs(s.endMs)}). Click to add.`}
            disabled={full}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => createMoment({ startMs: s.startMs, endMs: s.endMs }, s.region)}
            className="recording-suggestion absolute top-1 bottom-1 rounded-sm border border-dashed border-amber-300/70 bg-amber-300/10 hover:bg-amber-300/25"
            style={{ left: pctOf(s.startMs), width: `max(4px, ${pctOf(s.endMs - s.startMs)})` }}
          >+ Add</button>
        ))}</AnnotationTimeline>
  );

  return (
    <Shell embedded={embedded} fullPage={fullPage} back={back} title={detail.title || 'Recording'} description={`${detail.origin==='recorded'?'Screen recording':'Uploaded video'} · ${formatMs(durationMs)} · ${new Date(detail.createdAt).toLocaleString()}`} actions={<><span role="status" className="recording-save-status">{voiceDirty.size?'Voice note in progress':error&&dirty?'Couldn’t save changes':dirty?'Saving…':'✓ Saved on this Mac'}</span>{doneTeaching}</>}>
      {error && <div role="alert" className="recording-save-error mb-3 rounded border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-secondary text-state-fail"><span>{error}</span>{dirty&&<button type="button" className="btn-outline" disabled={busy!==null} onClick={()=>void save()}>Retry saving</button>}</div>}

      {embedded&&onClose&&<button type="button" className="text-ui text-ink-400 underline" onClick={onClose}>Close recording</button>}
      {embedded&&trainingReview}
      <AnnotationWorkspace ref={workspaceRef}>
      <div className="recording-stage">
      <div className="relative">
        {previewError && <p role="status" className="rounded border border-ink-800 bg-ink-950 p-6 text-center text-reading text-ink-200">{previewError}</p>}
        {!preview && !previewError && <div className="h-64 animate-pulse rounded bg-ink-800/50" aria-label="Loading video" />}
        {preview && (
          <ReviewPlaybackControls key={recordingId} mediaKey={recordingId} mediaRef={videoRef} onSeek={seek} variant="teaching" timeline={timeline} trailingAction={markButton}>
          <>
          <div className="review-playback-picture relative recording-picture">
            <video
              ref={videoRef}
              src={preview.url}
              className="max-h-[60vh] w-full rounded bg-black object-contain"
              onLoadedMetadata={(e) => {
                const v = e.currentTarget;
                setVideoDims(v.videoWidth && v.videoHeight ? { w: v.videoWidth, h: v.videoHeight } : null);
                setElementSize({ w: v.clientWidth, h: v.clientHeight });
                const initial=initialMomentId?momentsRef.current.find(moment=>moment.momentId===initialMomentId):null;if(initial){v.currentTime=initial.startMs/1000;setPlayheadMs(initial.startMs);}
              }}
              onTimeUpdate={(e) => setPlayheadMs(Math.round(e.currentTarget.currentTime * 1000))}
              onSeeked={(e) => setPlayheadMs(Math.round(e.currentTarget.currentTime * 1000))}
            />
            {hoverMs!==null&&hoverImage&&<><img className="recording-hover-picture" src={hoverImage.url} alt="Timeline preview"/><span className="recording-preview-badge">Preview {formatMs(Math.round(hoverImage.second*1000))}</span></>}
            <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true" />
            {selectedRegionStyle && (
              <div
                aria-hidden="true"
                className="recording-selected-area pointer-events-none absolute rounded-sm border-2 border-sky-400 bg-sky-400/10"
                style={{ left: `${selectedRegionStyle.leftPct}%`, top: `${selectedRegionStyle.topPct}%`, width: `${selectedRegionStyle.widthPct}%`, height: `${selectedRegionStyle.heightPct}%` }}
              />
            )}
            {(
              <ReviewSpatialOverlay
                mediaKind="video"
                controlsMode="external"
                appearance="teaching"
                mediaEl={() => videoRef.current}
                enabled={voiceDirty.size===0}
                pins={moments.flatMap((m,i)=>m.region&&playheadMs>=m.startMs&&playheadMs<=m.endMs?[{issueId:m.momentId,ordinal:i+1,geometry:{kind:'rect' as const,x:m.region.x/COORD_MAX,y:m.region.y/COORD_MAX,width:m.region.width/COORD_MAX,height:m.region.height/COORD_MAX},highlighted:m.momentId===selectedId,title:m.card.whatToDo||'Feedback'}]:[])}
                draftSpatial={null}
                freezeMedia={freezeForRegion}
                onAnnotate={onRegionAnnotate}
                onNudgeDraft={() => {}}
                onCancelDraft={() => setDrawing(false)}
                onOpenIssue={id=>{const moment=moments.find(m=>m.momentId===id);if(moment){selectMoment(moment);focusPictureNote(id);}}}
              />
            )}
          </div>
          {regionError && <p role="alert" className="p-3 text-secondary text-state-needs">{regionError}</p>}
          </>
          </ReviewPlaybackControls>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-secondary text-ink-400">
        <div className="flex items-center gap-3">
          {detail.hasPointerTrack && (
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={showTrail} onChange={(e) => setShowTrail(e.target.checked)} />
              Pointer trail
            </label>
          )}
          {drawing && <span className="text-state-running">Drag a box on the picture (or click for a box around a point).</span>}
          {drawing && <button type="button" onClick={() => setDrawing(false)} className="text-state-running hover:underline">Cancel drawing</button>}
        </div>
      </div>

      <p className="mt-1.5 text-reading text-ink-500">
        Click the picture or press M to mark two seconds. Drag across the timeline to choose a longer moment, or drag its round handle to scrub. Dashed marks are suggestions; click one to add it.
      </p>
      {barDraft && <p className="text-secondary text-state-running">{formatMs(barDraft.startMs)}–{formatMs(barDraft.endMs)} ({seconds(barDraft.endMs - barDraft.startMs)})</p>}
      {notice && <p role="status" className="mt-2 text-secondary text-ink-300">{notice}</p>}

      </div>
      <section aria-label="Moments" className="recording-moments">
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-lg font-medium text-ink-100">Moments <span className="text-secondary font-normal text-ink-500">{moments.length} marked</span></h2>
        </div>
        <p className="mb-4 text-secondary text-ink-500">{embedded?'Mark a moment and tell your agent what matters.':MOMENTS_NEXT_NOTE}</p>

        {moments.length === 0 && (
          <p className="rounded-lg border border-ink-800 bg-ink-900/40 px-4 py-6 text-center text-reading text-ink-400">No moments yet. Click a spot on the recording, or drag across the timeline.</p>
        )}

        <ol className="space-y-4">
          {moments.map((m, i) => {
            const isSel = m.momentId === selectedId;
            const pointerBox = defaultRegionFromPointer(samples, m.startMs, m.endMs);
            const warnings = cardWarnings(m.card);
            return (
              <li key={m.momentId} className={`recording-moment rounded-lg border p-4 ${isSel ? 'is-selected' : ''}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <button type="button" onClick={() => selectMoment(m)} className="recording-moment-select" title={`${preciseTime(m.startMs)}–${preciseTime(m.endMs)}`}><span className="recording-moment-number">{i+1}</span>
                    {formatMs(m.startMs)} – {formatMs(m.endMs)}
                  </button>
                  <button type="button" disabled={voiceDirty.has(m.momentId)} onClick={() => removeMoment(m.momentId)} className="text-ui text-ink-400 hover:text-state-fail">Delete</button>
                </div>
                <button type="button" className="recording-moment-summary mt-2 block w-full text-left text-ui text-ink-300" onClick={()=>selectMoment(m)}>{m.card.whatToDo||'No note yet'}</button>
                <div ref={isSel?noteRef:undefined} hidden={!isSel||drawing} className="recording-note" data-floating={isSel&&!!notePosition} style={isSel&&notePosition?notePosition:undefined} role="group" data-side={m.region&&m.region.x+m.region.width/2<COORD_MAX/2?'right':'left'} aria-label={`Edit moment ${i+1}`}
                  onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();cancelNote();}else if(event.key==='Enter'&&(event.metaKey||event.ctrlKey)&&!event.repeat){event.preventDefault();event.stopPropagation();void doneNote();}}}>
                <p className="mb-3 text-reading font-medium"><span className="recording-moment-number">{i+1}</span> <button type="button" title={`${preciseTime(m.startMs)}–${preciseTime(m.endMs)}`} onClick={()=>seek(m.startMs)}>{formatMs(m.startMs)} – {formatMs(m.endMs)}</button></p>
                <details className="recording-area-options mt-2 text-secondary text-ink-400"><summary>Marked area</summary><div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span>{m.region?'Area marked':'Whole screen'}</span><details><summary>Area details</summary>{m.region?regionLabel(m.region):'Whole screen'}</details>
                  <button type="button" disabled={voiceDirty.has(m.momentId)} onClick={() => { videoRef.current?.pause(); selectMoment(m); setRegionError(null); setDrawing(true); }} className="text-state-running hover:underline">Draw region</button>
                  {pointerBox && <button type="button" disabled={voiceDirty.has(m.momentId)} onClick={() => setRegion(m.momentId, pointerBox)} className="text-state-running hover:underline">Use pointer box</button>}
                  {m.region && <button type="button" disabled={voiceDirty.has(m.momentId)} onClick={() => setRegion(m.momentId, null)} className="text-ink-400 hover:underline">Clear region</button>}
                </div></details>
                <div className="mt-3 recording-comment-box"><label htmlFor={`${m.momentId}-feedback`} className="sr-only">What should change here?</label><textarea id={`${m.momentId}-feedback`} placeholder="What should change here?" rows={3} maxLength={CARD_FIELD_MAX} value={m.card.whatToDo} onFocus={()=>setSelectedId(m.momentId)} onChange={e=>setField(m.momentId,'whatToDo',e.target.value)} className="mt-1 w-full rounded border border-ink-700 bg-ink-950 px-3 py-2 text-ui text-ink-100 focus:border-sky-500 focus:outline-none"/>
                  {embedded&&isSel&&<TrainerVoiceNote compact disabled={busy!==null} onDirtyChange={dirty=>setVoiceDirty(previous=>{const next=new Set(previous);if(dirty)next.add(m.momentId);else next.delete(m.momentId);return next.size===previous.size&&[...next].every(id=>previous.has(id))?previous:next;})} ownerId={ownerId} attach={{sourceKind:detail.origin==='recorded'?'recording':'upload',sourceRef:`${recordingId}:${m.momentId}`,mark:m.endMs>m.startMs?{startMs:m.startMs,endMs:m.endMs}:{frameMs:m.startMs,region:m.region||{x:0,y:0,width:1000000,height:1000000}}}} maxLength={Math.max(0,CARD_FIELD_MAX-m.card.whatToDo.trim().length-(m.card.whatToDo.trim()?2:0))} onInsert={text=>patch(m.momentId,current=>({...current,card:{...current.card,whatToDo:[current.card.whatToDo.trim(),text].filter(Boolean).join('\n\n')}}))}/>}
                  {warnings.whatToDo&&<p data-testid="card-warning" className="mt-1 text-secondary text-state-needs">{warnings.whatToDo.join(' ')}</p>}
                </div>
                <p className="mt-3 text-secondary text-ink-400">Changes save automatically on this Mac.</p>
                <div className="recording-note-actions mt-4 flex justify-end gap-2 border-t border-ink-700 pt-3">
                  <button type="button" aria-label="Cancel changes" className="btn-ghost" disabled={voiceDirty.size>0} onClick={cancelNote}>Cancel changes <small>Esc</small></button>
                  <button type="button" aria-label="Done" className="btn-primary" disabled={busy!==null||voiceDirty.size>0} onClick={()=>void doneNote()}>{busy==='save'?'Saving…':<>Done <small>⌘↵</small></>}</button>
                </div>
                </div>
                {onUseFeedback&&<button type="button" className="mt-3 text-ui text-ink-500 underline underline-offset-4" disabled={busy!==null||dirty||!CARD_FIELDS.some(field=>m.card[field].trim())} onClick={()=>onUseFeedback(recordingId,m)}>Turn into a learning</button>}
                {CARD_FIELDS.some(field=>field!=='whatToDo'&&m.card[field].trim())&&<details className="mt-3 text-secondary text-ink-400"><summary>Previously saved notes</summary>{CARD_FIELDS.filter(field=>field!=='whatToDo'&&m.card[field].trim()).map(field=><p key={field} className="text-reading mt-2 whitespace-pre-wrap"><strong>{CARD_FIELD_LABELS[field]}:</strong> {m.card[field]}</p>)}</details>}
              </li>
            );
          })}
        </ol>
      </section>

      </AnnotationWorkspace>

      {embedded&&trainingFrames&&durationMs!==null&&<section aria-label="Screenshots from your recording" className="my-4 space-y-3">
        <h3 className="font-medium">Add feedback to a screenshot</h3>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">{trainingFrames.map(frame=><li key={frame.timeMs}>
          <button type="button" disabled={busy!==null||voiceDirty.size>0} className="space-y-1 text-left text-ui text-ink-300" onClick={()=>addTrainingMoment(frame.timeMs)}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={frame.image} alt="" className="w-full rounded-lg"/>
            Add feedback at {formatMs(frame.timeMs)}
          </button>
        </li>)}</ul>
      </section>}
      <section className="my-4 flex flex-wrap items-center gap-3 text-secondary">
        {embedded&&trainingReview&&durationMs!==null&&<button type="button" className="btn-secondary" disabled={busy!==null||voiceDirty.size>0}
          onClick={()=>addTrainingMoment(playheadMs)}>Add a learning</button>}
        {doneTeaching}
        <details className="text-secondary text-ink-400"><summary className="cursor-pointer">More options</summary><p className="mt-2">Up to {MAX_MOMENTS} moments, {MAX_MOMENT_MS/1000} seconds each.</p><div className="mt-3 flex flex-wrap items-center gap-3">{detail.origin==='imported'&&onTrainerNarrationChange&&<label className="flex w-full items-center gap-2"><input type="checkbox" checked={trainerNarration} onChange={event=>onTrainerNarrationChange(event.target.checked)}/>This is my narrated demonstration</label>}
        {onAnalyzeNarration?<button type="button" className="btn-primary" disabled={busy!==null||!!narrationUnavailable} onClick={async()=>{if(dirty&&!(await save()))return;onAnalyzeNarration(recordingId,selectedId);}}>Find learnings in my narration</button>:<>{trainingSlug?<button type="button" disabled={dirty||busy!==null} onClick={()=>router.push(`/training/${encodeURIComponent(trainingSlug)}?recordingId=${recordingId}${selectedId?`&momentId=${selectedId}`:''}`)}>Use in Training</button>:<Link href={`/training?recordingId=${recordingId}`}>Choose an agent for Training</Link>}</>}
        {onAnalyzeTool&&<button type="button" className="btn-secondary" disabled={busy!==null||!!narrationUnavailable} onClick={async()=>{if(dirty&&!(await save()))return;onAnalyzeTool(recordingId,selectedId);}}>Teach a tool or method</button>}
        {(onAnalyzeNarration||onAnalyzeTool)&&narrationUnavailable&&<p className="text-secondary text-ink-400">{narrationUnavailable}</p>}
        </div></details>
      </section>

      <Modal open={leaveHref !== null} onClose={() => setLeaveHref(null)} title="Leave without saving?">
        <p className="text-reading text-ink-300">{LEAVE_COPY}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={() => setLeaveHref(null)} className="rounded-md border border-ink-700 px-3 py-1.5 text-ui text-ink-200">Keep editing</button>
          <button
            type="button"
            onClick={() => { const href = leaveHref; setLeaveHref(null); if (href) router.push(href); }}
            className="rounded-md bg-action-danger px-3 py-1.5 text-ui font-medium text-[var(--on-action-danger)] hover:bg-action-danger-hover"
          >
            Leave without saving
          </button>
        </div>
      </Modal>
    </Shell>
  );
}

function Shell({ back, title, children,embedded=false,fullPage=false,feedbackSaveUnavailable,initialMomentId,actions,description }: {embedded?:boolean;fullPage?:boolean;feedbackSaveUnavailable?:string;initialMomentId?:string; back: ReactNode; title: string; children: ReactNode;actions?:ReactNode;description?:ReactNode}) {
  if(embedded)return <section id="recording-annotation" tabIndex={-1} aria-label="Annotate your recording" className="space-y-4">{fullPage?<PageHeader title="Show the agent what to change" actions={actions}><p className="text-reading app-page-description">{description||title}</p></PageHeader>:<header className="recording-header"><div><h2>Show the agent what to change</h2>{description&&<p className="text-reading">{description}</p>}</div><div>{actions}</div></header>}{children}</section>;
  return (
    <div className="app-page">
      <div className="app-content">
        <div className="mb-4">{back}</div>
        <PageHeader title="Show the agent what to change" actions={actions}><p className="text-reading app-page-description">{description||title}</p></PageHeader>
        {children}
      </div>
    </div>
  );
}
