'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BackendError, callBackend } from '@/lib/api';
import { createClient } from '@/lib/supabase/client';
import { localInputRecoveryMessage, verifyContinuationSource } from '@/lib/continuation-local-input';
import Modal from './modal';
import { desktopBridge } from './run-attachments';

const fields = {
  video: { key: 'checkpoint_edit_video', label: 'First cut (MP4)', extension: '.mp4', mediaType: 'video/mp4' },
  project: { key: 'checkpoint_edit_project', label: 'Editable project (ZIP)', extension: '.zip', mediaType: 'application/zip' },
} as const;
type FileSlot = keyof typeof fields;
type ChosenFile = { artifactId: string; displayName: string };

export default function CheckpointSavedEdit({ runId }: { runId: string }) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const endpoint = `/api/v2/me/runs/${encodeURIComponent(runId)}/checkpoint-edit`;
  const sessionId = useRef<string | null>(null);
  const [visible, setVisible] = useState(false);
  const [open, setOpen] = useState(false);
  const [queued, setQueued] = useState(false);
  const [working, setWorking] = useState(false);
  const [files, setFiles] = useState<Partial<Record<FileSlot, ChosenFile>>>({});
  const [brief, setBrief] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    let mounted = true;
    void supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session?.access_token) return;
      const offer = await callBackend(endpoint, { jwt: data.session.access_token });
      if (mounted && offer?.ok === true) setVisible(offer.eligible === true);
    }).catch(() => {});
    return () => { mounted = false; };
  }, [endpoint, supabase]);

  async function pick(slot: FileSlot) {
    const picker = desktopBridge()?.pickRunInput;
    if (working) return;
    if (!picker) { setMessage('Open this run in the Tukido desktop app to choose local files.'); return; }
    const field = fields[slot];
    setWorking(true);
    setMessage('Verifying the file…');
    try {
      const result = await picker({
        inputKey: field.key, inputSessionId: sessionId.current ?? undefined,
        accept: { extensions: [field.extension], mediaTypes: [field.mediaType] },
        replacesArtifactId: files[slot]?.artifactId,
      });
      if (result.canceled) { setMessage(''); return; }
      if (!result.ok || result.storageMode !== 'managed_copy' || !result.inputSessionId || !result.artifactId || !result.displayName) {
        setMessage('Choose a readable local file that Tukido can verify and copy into this edit.');
        return;
      }
      sessionId.current = result.inputSessionId;
      setFiles(current => ({ ...current, [slot]: { artifactId: result.artifactId!, displayName: result.displayName! } }));
      setMessage('');
    } catch {
      setMessage('The file picker could not verify that file.');
    } finally { setWorking(false); }
  }

  async function resume() {
    if (working || !files.video || !files.project || !brief.trim() || !sessionId.current) return;
    setWorking(true);
    setMessage('');
    try {
      const source = await verifyContinuationSource(runId, phase => setMessage(phase === 'checking'
        ? 'Checking the original source…' : 'Reconnect the original source…'), { required: true });
      if (!source.ok) { setMessage(source.canceled ? '' : localInputRecoveryMessage(source.error)); return; }
      setMessage('');
      const { data: { session } } = await supabase.auth.getSession();
      const result = await callBackend(endpoint, { method: 'POST', jwt: session?.access_token,
        body: { inputSessionId: sessionId.current, videoArtifactId: files.video.artifactId,
          projectArtifactId: files.project.artifactId, brief: brief.trim() } });
      if (result?.queued !== true) throw new Error('checkpoint_edit_unavailable');
      setQueued(true);
      setOpen(false);
      router.refresh();
    } catch (error) {
      const body = error instanceof BackendError ? error.body : null;
      setMessage(body?.reason === 'checkpoint_edit_desktop_update_required'
        ? 'Update Tukido on the Mac that ran this video, then try again.'
        : 'Tukido could not queue this edit. Refresh to check whether the saved checkpoint is still available.');
    } finally { setWorking(false); }
  }

  if (!visible && !queued) return null;
  return <section className="card mt-4" aria-label="Saved video edit">
    {queued ? <p role="status">Edit queued. Tukido will verify the files before the agent starts.</p>
      : <><p className="mb-2 text-reading">The restart stopped before the agent began. Resume from the saved checkpoint with your first cut and editable project.</p>
        <button type="button" className="btn-primary" onClick={() => setOpen(true)}>Resume with saved edit</button></>}
    <Modal open={open} onClose={() => { if (!working) setOpen(false); }} title="Resume with saved edit">
      <p className="mb-4 text-reading">Tukido will reuse the saved clips and edit the cut on the Mac that ran it.</p>
      <div className="space-y-3">
        {(Object.keys(fields) as FileSlot[]).map(slot => <div key={slot}>
          <button type="button" className="btn-outline" disabled={working} onClick={() => void pick(slot)}>{fields[slot].label}</button>
          {files[slot] && <span className="ml-2 break-all text-secondary">{files[slot]?.displayName}</span>}
        </div>)}
        <label className="block text-reading">What should change?
          <textarea className="mt-1 block w-full rounded-md border border-ink-700 bg-ink-950 p-3" rows={5}
            maxLength={2000} value={brief} disabled={working} onChange={event => setBrief(event.target.value)} />
        </label>
      </div>
      {message && <p role="status" className="mt-3 text-reading">{message}</p>}
      <button type="button" className="btn-primary mt-4" disabled={working || !brief.trim() || !files.video || !files.project}
        onClick={() => void resume()}>Resume this edit</button>
    </Modal>
  </section>;
}
