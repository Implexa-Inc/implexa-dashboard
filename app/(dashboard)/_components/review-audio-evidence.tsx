'use client';
import { useState } from 'react';
import { AUDIO_LIMITATION, audioEvidenceText, normalizeAudioReferences, type AudioReference, type Listening } from '@/lib/review-audio-evidence';
export function ReviewAudioEvidence({ reviewedFile, anchorMs, onInsert }: {
  reviewedFile: string; anchorMs: number; onInsert: (text: string, priorText: string | null) => void;
}) {
  const [space, setSpace] = useState<AudioReference['space']>('reviewed');
  const [file, setFile] = useState(reviewedFile);
  const [start, setStart] = useState((anchorMs / 1000).toFixed(3));
  const [end, setEnd] = useState('');
  const [origin, setOrigin] = useState('');
  const [refs, setRefs] = useState<AudioReference[]>([]);
  const [listening, setListening] = useState<Listening>('not_checked');
  const [error, setError] = useState('');
  const [inserted, setInserted] = useState<string | null>(null);
  const inputClass = 'mt-1 w-full rounded border border-ink-700 bg-ink-900 px-2 py-1';
  const preview = audioEvidenceText({ reviewedFile, anchorMs, refs, listening });
  return <details className="my-2 rounded border border-ink-700 p-2 text-xs text-ink-300">
    <summary className="cursor-pointer">Clarify audio evidence and timestamps</summary>
    <p className="my-2">The comment stays attached to the reviewed file. Add named references below; source and clip times do not move its anchor.</p>
    <p className="my-2">{AUDIO_LIMITATION}</p>
    <label className="block">How was this checked?
      <select aria-label="Audio listening status" className={inputClass} value={listening} onChange={e => setListening(e.target.value as Listening)}>
        <option value="not_checked">Listening not confirmed</option><option value="listened">I listened to these references</option>
        <option value="transcript_only">Transcript text only</option>
      </select>
    </label>
    <label className="mt-2 block">Reference timeline
      <select aria-label="Audio reference timeline" className={inputClass} value={space} onChange={e => {
        const next = e.target.value as AudioReference['space'];
        setSpace(next); setFile(next === 'reviewed' ? reviewedFile : '');
        setStart(next === 'reviewed' ? (anchorMs / 1000).toFixed(3) : ''); setEnd(''); setOrigin(''); setError('');
      }}>
        <option value="reviewed">Reviewed output</option><option value="source">Original source</option><option value="clip">Extracted clip</option>
      </select>
    </label>
    <label className="mt-2 block">Reference file name<input aria-label="Audio reference file" className={inputClass} value={file} maxLength={200} onChange={e => setFile(e.target.value)} /></label>
    <div className="mt-2 flex gap-2">
      <label>Start (seconds)<input aria-label="Audio reference start" className={inputClass} value={start} inputMode="decimal" onChange={e => setStart(e.target.value)} /></label>
      <label>End (seconds)<input aria-label="Audio reference end" className={inputClass} value={end} inputMode="decimal" onChange={e => setEnd(e.target.value)} /></label>
    </div>
    {space === 'clip' && <label className="mt-2 block">Clip starts at reviewed-output second (optional; leave empty if unknown)
      <input aria-label="Clip origin in reviewed output" className={inputClass} value={origin} inputMode="decimal" onChange={e => setOrigin(e.target.value)} />
    </label>}
    <button type="button" className="my-2 rounded border border-ink-700 px-2 py-1" onClick={() => {
      try {
        const seconds = (v: string) => /^\d+(\.\d{1,3})?$/.test(v.trim()) ? Math.round(Number(v) * 1000) : NaN;
        setRefs(normalizeAudioReferences([...refs, { space, file, startMs: seconds(start), endMs: seconds(end),
          reviewedOriginMs: space === 'clip' && origin.trim() ? seconds(origin) : null }])); setError('');
      } catch (e) { setError((e as Error).message); }
    }}>Add reference</button>
    {refs.length > 0 && <button type="button" className="ml-2 underline" onClick={() => { setRefs([]); setError(''); }}>Clear references</button>}
    {error && <p role="alert" className="text-amber-200">{error}</p>}
    <pre aria-label="Audio evidence preview" className="my-2 whitespace-pre-wrap rounded bg-ink-900 p-2 font-sans">{preview}</pre>
    <button type="button" className="rounded border border-ink-700 px-2 py-1" onClick={() => {
      onInsert(preview, inserted); setInserted(preview);
    }}>{inserted ? 'Update context in comment' : 'Add context to comment'}</button>
    <p className="mt-2">Review the inserted text, describe the correction, then save the issue. Adding context does not submit or start a revision.</p>
  </details>;
}
