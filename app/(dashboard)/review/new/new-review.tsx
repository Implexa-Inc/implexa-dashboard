'use client';

/**
 * New review + the local recordings library (spec §3.1, §3.2). NET NEW.
 *
 * Every Desktop interaction goes through `createReviewRecorderClient` — this file never
 * touches `window.implexaDesktop` and never handles a path: it sends recording ids and
 * the microphone choice, nothing else. The Desktop opens its own recorder window (picker,
 * countdown, control bar); this page only starts it and reflects its state.
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Modal from '../../_components/modal';
import {TrainingInfo} from '../../training/[slug]/training-workspace';
import {
  ACTIVE_STATE_LABELS, RECORD_NOTICE, RECORDING_STATE_LABELS, createReviewRecorderClient, failureMessage,
  formatBytes, formatRecordingDuration, recordingPlayerHref as playerHref, recorderAvailability, recorderErrorMessage,
  recoverAction, recorderStartFailureMessage,
  type ActiveRecording, type LibraryUsage, type RecorderAvailability, type RecordingSummary, type RecorderStartFailure,
} from '@/lib/review-recorder';



const STATE_BADGE: Record<RecordingSummary['state'], string> = {
  recording: 'bg-rose-500/15 text-rose-300',
  finalizing: 'bg-sky-500/15 text-sky-300',
  ready: 'bg-emerald-500/15 text-emerald-300',
  interrupted: 'bg-amber-500/15 text-amber-300',
  failed: 'bg-rose-500/15 text-rose-300',
};

export default function NewReview({ownerId,trainingSlug,presentation='review',onTrainingUpload,uploadDisabled=false,uploading=false}:{ownerId:string;trainingSlug?:string;presentation?:'review'|'training';onTrainingUpload?:()=>void;uploadDisabled?:boolean;uploading?:boolean}) {
  const router = useRouter();
  const recordingHref=(id:string)=>playerHref(id)+(trainingSlug?`?trainingSlug=${encodeURIComponent(trainingSlug)}`:'');
  // Through a ref, so the refresh callback (and the subscription keyed on it) stays
  // stable even where the router object is not.
  const routerRef = useRef(router);
  routerRef.current = router;
  const client = useMemo(() => createReviewRecorderClient(undefined,ownerId), [ownerId]);
  // Read after mount: the bridge exists only in the Desktop window, never during SSR.
  const [availability, setAvailability] = useState<RecorderAvailability | null>(null);
  const [recordings, setRecordings] = useState<RecordingSummary[] | null>(null);
  const [library, setLibrary] = useState<LibraryUsage | null>(null);
  const [active, setActive] = useState<ActiveRecording | null>(null);
  const [microphone, setMicrophone] = useState(true);
  // Per-operation busy keys ('record', 'upload', 'recover:<id>', 'delete:<id>'): a long
  // import must not lock Record or another row's buttons.
  const [inFlight, setInFlight] = useState<ReadonlySet<string>>(() => new Set());
  const inFlightRef = useRef(new Set<string>());
  const [unreadable, setUnreadable] = useState(0);
  const refreshSeq = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [startFailure, setStartFailure] = useState<RecorderStartFailure | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // The recording this page started: when it becomes ready, open it (spec §3.2 step 4).
  const startedRef = useRef<string | null>(null);
  const [trainingRecording,setTrainingRecording]=useState<RecordingSummary|null>(null);

  const refresh = useCallback(async () => {
    // Events, focus and actions all refresh; an older answer must not overwrite a newer one.
    const seq = ++refreshSeq.current;
    try {
      const [listed, status] = await Promise.all([client.list(), client.status()]);
      if (seq !== refreshSeq.current) return;
      setRecordings(listed.recordings);
      setUnreadable(listed.unreadable);
      setLibrary(listed.library);
      setActive(status.active);
      setLoadError(null);
      const started = startedRef.current;
      const result=started?listed.recordings.find(r=>r.recordingId===started):null;
      if(result&&presentation==='training'&&['ready','failed','interrupted'].includes(result.state)){
        startedRef.current=null;setTrainingRecording(result);
      }else if(result?.state==='ready'){
        startedRef.current=null;routerRef.current.push(recordingHref(result.recordingId));
      }
    } catch (caught) {
      if (seq !== refreshSeq.current) return;
      setLoadError(recorderErrorMessage(caught) ?? 'Your recordings library could not be read just now.');
    }
  }, [client,trainingSlug,presentation]);

  useEffect(() => {
    const a = recorderAvailability();
    setAvailability(a);
    if (a.state !== 'ready') return;
    void refresh();
    const off = client.subscribe((change) => {
      if (change.state === 'start_failed' && change.failure) {
        startedRef.current = null;
        setStartFailure(change.failure);
      }
      void refresh();
    });
    const onFocus = () => { void refresh(); };
    window.addEventListener('focus', onFocus);
    return () => { off(); window.removeEventListener('focus', onFocus); };
  }, [client, refresh]);

  async function work(key: string, fn: () => Promise<void>) {
    if (inFlightRef.current.has(key)) return;
    inFlightRef.current.add(key);
    setInFlight(new Set(inFlightRef.current)); setError(null);
    try { await fn(); }
    catch (caught) { setError(recorderErrorMessage(caught)); }
    finally { inFlightRef.current.delete(key); setInFlight(new Set(inFlightRef.current)); }
  }
  const busy = (key: string) => inFlight.has(key);

  const record = () => work('record', async () => {
    setTrainingRecording(null);
    const { recordingId } = await client.start(microphone);
    startedRef.current = recordingId;
    await refresh();
  });
  const upload = () => work('upload', async () => {
    try {
      const { recordingId } = await client.importVideo();
      router.push(recordingHref(recordingId));
    } finally {
      // A failed copy stays in the library (listed as failed), so show it.
      void refresh();
    }
  });
  const recover = (id: string) => work(`recover:${id}`, async () => { await client.recover(id); await refresh(); });
  const remove = (id: string) => work(`delete:${id}`, async () => { await client.remove(id); await refresh(); });

  const ready = availability?.state === 'ready';
  const recorderBusy = active !== null;

  const startFailureDialog=(<Modal open={startFailure !== null} onClose={() => setStartFailure(null)} title="Recording did not start">
        {startFailure && <>
          <p>{recorderStartFailureMessage(startFailure)}</p>
          <details className="mt-3 text-xs text-ink-400">
            <summary>Diagnostic details</summary>
            <p>{startFailure.phase} / {startFailure.errorName} / {startFailure.reason}</p>
          </details>
        </>}
      </Modal>);
  if(presentation==='training')return <section className="space-y-4 border-y border-ink-800 py-6" aria-labelledby="multimodal-training-heading">
    {startFailureDialog}
    <header><h2 id="multimodal-training-heading" className="text-lg font-medium">Multimodal Training</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-ink-400">You can upload a video/image and annotate directly, or record a video describing the training. Implexa extracts suggested learnings for you to review.</p></header>
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" disabled={uploadDisabled||uploading} onClick={onTrainingUpload} className="rounded-lg border border-ink-700 px-4 py-2.5 text-sm text-ink-200 hover:border-ink-500 disabled:opacity-40">{uploading?'Opening your example…':'Upload and annotate Video/Image'}</button>
      <button type="button" disabled={!ready||!ownerId||busy('record')||(recorderBusy&&active?.state!=='permission_required')} onClick={()=>void record()} className="rounded-lg border border-ink-700 px-4 py-2.5 text-sm text-ink-200 hover:border-ink-500 disabled:opacity-40">{busy('record')?'Opening recorder…':active?.state==='permission_required'?'Open permission setup':'Record your training'}</button>
      <TrainingInfo label="About multimodal training">Select a file you have permission to use as a private training source. Originals stay on this Mac. Recording uses your screen and microphone; macOS asks for access when needed. Analysis and including a suggested teaching keep their existing review steps.</TrainingInfo>
    </div>
    {availability&&availability.state!=='ready'&&<p className="text-xs text-ink-400">{availability.message}</p>}
    <p className="text-[11px] leading-5 text-ink-500" data-testid="record-notice">{RECORD_NOTICE}</p>
    <Link href={`/review/new?trainingSlug=${encodeURIComponent(trainingSlug||'')}`} className="inline-block text-xs text-ink-400 hover:text-ink-100">Saved recordings</Link>
    {trainingRecording&&<div role="status" className="text-sm text-ink-300"><p>{trainingRecording.state==='ready'?'Your recording is ready to annotate.':trainingRecording.state==='failed'?failureMessage(trainingRecording.failureReason):'Recording interrupted. Open it to recover the saved portion.'}</p><Link href={recordingHref(trainingRecording.recordingId)} className="mt-2 inline-block underline underline-offset-4">{trainingRecording.state==='ready'?'Annotate recording':'Open recording'}</Link></div>}
    {active&&<p role="status" className="text-xs text-ink-400">{ACTIVE_STATE_LABELS[active.state]}</p>}
    {error&&<p role="alert" className="text-sm text-rose-300">{error}</p>}
  </section>;

  return (
    <div className="min-h-screen px-6 py-14 lg:px-12">
      {startFailureDialog}
      <div className="mx-auto max-w-3xl">
        <header className="mb-6">
          <h1 className="text-3xl font-semibold tracking-tight text-ink-50">{trainingSlug?'Training recordings':'New review'}</h1>
          <p className="mt-1 text-sm text-ink-300">{trainingSlug?'Choose a saved demonstration to annotate.':'Review an Agent result, or show your Agent what you mean with a video.'}</p>{trainingSlug&&<Link href={`/training/${encodeURIComponent(trainingSlug)}`} className="mt-2 inline-block text-xs text-ink-400">← Back to Training</Link>}
        </header>

        {availability && availability.state !== 'ready' && (
          <div role="status" className="mb-5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            <p>{availability.message}</p>
            {availability.state === 'desktop_update_required' && (
              <a href="/get-app" className="mt-2 inline-block text-xs text-amber-100 underline">Get the update</a>
            )}
          </div>
        )}

        {error && (
          <p role="alert" className="mb-5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</p>
        )}

        <div className={`grid gap-3 ${trainingSlug?'sm:grid-cols-2':'sm:grid-cols-3'}`}>
          {!trainingSlug&&<section className="rounded-lg border border-ink-800 bg-ink-900/40 p-4">
            <h2 className="text-base font-medium text-ink-100">Review a result</h2>
            <p className="mt-1 text-xs text-ink-400">Pick something an Agent delivered and give it feedback.</p>
            <Link href="/work?view=review" className="mt-4 inline-block rounded-md bg-ink-100 px-3 py-1.5 text-sm font-medium text-ink-950 hover:bg-white">
              Pick a result
            </Link>
          </section>}

          <section className="rounded-lg border border-ink-800 bg-ink-900/40 p-4">
            <h2 className="text-base font-medium text-ink-100">Upload a video</h2>
            <p className="mt-1 text-xs text-ink-400">MP4, MOV, M4V or WebM. A copy is added to your recordings library.</p>
            <button
              type="button"
              disabled={!ready || busy('upload')}
              onClick={() => void upload()}
              className="mt-4 rounded-md bg-ink-100 px-3 py-1.5 text-sm font-medium text-ink-950 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy('upload') ? 'Adding…' : 'Choose a video'}
            </button>
          </section>

          <section className="rounded-lg border border-ink-800 bg-ink-900/40 p-4">
            <h2 className="text-base font-medium text-ink-100">Record a session</h2>
            <p className="mt-1 text-xs text-ink-400">Record your screen, pointer and voice.</p>
            <label className="mt-3 flex items-center gap-2 text-xs text-ink-300">
              <input type="checkbox" checked={microphone} onChange={(e) => setMicrophone(e.target.checked)} disabled={!ready || recorderBusy} />
              Microphone
            </label>
            <button
              type="button"
              disabled={!ready || busy('record') || (recorderBusy && active?.state !== 'permission_required')}
              onClick={() => void record()}
              className="mt-3 rounded-md bg-rose-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy('record') ? 'Opening recorder…' : active?.state === 'permission_required' ? 'Open permission setup' : 'Record'}
            </button>
            <p className="mt-2 text-[11px] leading-snug text-ink-500" data-testid="record-notice">{RECORD_NOTICE}</p>
          </section>
        </div>

        {active && (
          <p role="status" className="mt-4 rounded-lg border border-sky-500/30 bg-sky-500/10 px-4 py-3 text-sm text-sky-200">
            {ACTIVE_STATE_LABELS[active.state]}
          </p>
        )}

        {ready && (
          <section aria-label="Recordings library" className="mt-10">
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <h2 className="text-lg font-medium text-ink-100">Recordings on this Mac</h2>
              {library && (
                <p className="text-xs text-ink-400">{formatBytes(library.usedBytes)} of {formatBytes(library.limitBytes)} used</p>
              )}
            </div>
            {library && (
              <div className="mb-4 h-1.5 overflow-hidden rounded bg-ink-800" aria-hidden="true">
                <div className="h-full bg-sky-500" style={{ width: `${Math.min(100, (library.usedBytes / library.limitBytes) * 100)}%` }} />
              </div>
            )}

            {loadError && <p role="status" className="mb-3 text-sm text-amber-300">{loadError}</p>}
            {unreadable > 0 && (
              <p role="status" className="mb-3 text-sm text-amber-300">
                {unreadable === 1 ? '1 recording could not be read.' : `${unreadable} recordings could not be read.`} Updating Implexa Desktop may fix this.
              </p>
            )}
            {recordings === null && !loadError && <div className="h-20 animate-pulse rounded bg-ink-800/50" aria-label="Loading recordings" />}
            {recordings?.length === 0 && !busy('upload') && (
              <p className="rounded-lg border border-ink-800 bg-ink-900/40 px-4 py-8 text-center text-sm text-ink-400">
                No recordings yet. Record a session or upload a video to start.
              </p>
            )}

            <ul className="space-y-2">
              {busy('upload') && (
                <li className="rounded-lg border border-dashed border-ink-700 bg-ink-900/40 p-3 text-sm text-ink-300" data-testid="import-placeholder">
                  Adding video… Long videos take a while to convert.
                </li>
              )}
              {recordings?.map((r) => {
                const isActive = active?.recordingId === r.recordingId;
                const rowBusy = busy(`recover:${r.recordingId}`) || busy(`delete:${r.recordingId}`);
                const recovery = recoverAction(r);
                return (
                  <li key={r.recordingId} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-ink-800 bg-ink-900/40 p-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink-100">{r.title || 'Untitled recording'}</p>
                      <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-400">
                        <span className={`rounded px-1.5 py-0.5 ${STATE_BADGE[r.state]}`}>{RECORDING_STATE_LABELS[r.state]}</span>
                        <span>{r.origin === 'imported' ? 'Uploaded' : 'Recorded'}</span>
                        <span aria-hidden>·</span>
                        <span>{formatRecordingDuration(r.durationMs)}</span>
                        <span aria-hidden>·</span>
                        <span>{formatBytes(r.sizeBytes)}</span>
                        <span aria-hidden>·</span>
                        <span>{new Date(r.createdAt).toLocaleString()}</span>
                        <span aria-hidden>·</span>
                        <span>{r.momentCount === 1 ? '1 moment' : `${r.momentCount} moments`}</span>
                      </p>
                      {r.state === 'failed' && <p className="mt-1 text-xs text-rose-300">{failureMessage(r.failureReason)}</p>}
                      {r.state === 'interrupted' && <p className="mt-1 text-xs text-amber-300">This recording stopped unexpectedly. Recover keeps what was saved before it stopped.</p>}
                    </div>
                    <div className="flex shrink-0 gap-2">
                      {r.state === 'ready' && (
                        <Link href={recordingHref(r.recordingId)} className="rounded-md bg-ink-100 px-3 py-1.5 text-sm font-medium text-ink-950 hover:bg-white">Open</Link>
                      )}
                      {recovery && (
                        <button type="button" disabled={rowBusy} onClick={() => void recover(r.recordingId)}
                          className="rounded-md border border-amber-500/40 px-3 py-1.5 text-sm text-amber-200 disabled:opacity-40">
                          {busy(`recover:${r.recordingId}`) ? 'Working…' : recovery.label}
                        </button>
                      )}
                      {!isActive && r.state !== 'recording' && r.state !== 'finalizing' && (
                        <button type="button" disabled={rowBusy} onClick={() => void remove(r.recordingId)}
                          className="rounded-md border border-ink-700 px-3 py-1.5 text-sm text-ink-300 hover:border-rose-500/50 hover:text-rose-200 disabled:opacity-40">
                          {busy(`delete:${r.recordingId}`) ? 'Deleting…' : 'Delete'}
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
