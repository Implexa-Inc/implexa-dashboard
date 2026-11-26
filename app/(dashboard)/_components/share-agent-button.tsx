'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Modal from './modal';
import { agentSharePath } from '@/lib/agent-share';

type Status = 'checking' | 'ready' | 'private' | 'unavailable';

export default function ShareAgentButton({ id, slug, canPublish = false }: {
  id: string; slug: string; canPublish?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>('checking');
  const [version, setVersion] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [confirmPrivate, setConfirmPrivate] = useState(false);
  const link = useRef<HTMLInputElement>(null);
  const path = agentSharePath(id);
  const publicationUrl = `/api/agent-training/publication?slug=${encodeURIComponent(slug)}`;

  useEffect(() => {
    if (!open) return;
    const abort = new AbortController();
    const options = { cache: 'no-store' as const, signal: abort.signal };
    setStatus('checking'); setNotice(''); setVersion(''); setConfirmPrivate(false);
    async function check() {
      const preview = await fetch(`/api/agents/share?id=${id}`, options);
      if (abort.signal.aborted) return;
      if (preview.ok) { setStatus('ready'); return; }
      if (preview.status !== 404) { setStatus('unavailable'); return; }
      if (canPublish) {
        const response = await fetch(publicationUrl, options);
        const state = await response.json();
        if (abort.signal.aborted) return;
        if (!response.ok || state?.ok !== true) { setStatus('unavailable'); return; }
        if (state.publication?.versionId === state.publication?.publishedVersionId
            && typeof state.publication?.versionId === 'string') setVersion(state.publication.versionId);
      }
      setStatus('private');
    }
    void check().catch(() => { if (!abort.signal.aborted) setStatus('unavailable'); });
    return () => abort.abort();
  }, [open, id, publicationUrl, canPublish]);

  async function changeVisibility(makePrivate: boolean) {
    setBusy(true); setNotice('');
    try {
      let expectedVersionId = version;
      if (makePrivate) {
        const latest = await fetch(publicationUrl, { cache: 'no-store' });
        const state = await latest.json();
        if (!latest.ok || state?.ok !== true || typeof state.publication?.versionId !== 'string') {
          throw new Error('Publication status unavailable');
        }
        expectedVersionId = state.publication.versionId;
        setVersion(expectedVersionId === state.publication.publishedVersionId ? expectedVersionId : '');
      }
      const response = await fetch(publicationUrl, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(makePrivate ? { expectedVersionId, makePrivate: true }
          : { expectedVersionId, definitionOnlyConfirmed: true }),
      });
      const result = await response.json();
      if (!response.ok || result?.ok !== true) {
        if (result?.reason === 'publication_test_required') {
          setNotice('Test and publish this version in Coach first.');
          return;
        }
        throw new Error('Publication change unavailable');
      }
      const preview = await fetch(`/api/agents/share?id=${id}`, { cache: 'no-store' });
      if (makePrivate ? preview.status !== 404 : !preview.ok) throw new Error('Public preview unavailable');
      setStatus(makePrivate ? 'private' : 'ready');
      setConfirmPrivate(false);
      if (makePrivate) setNotice('Public link disabled.');
    } catch {
      setNotice('Publication could not be confirmed. Reopen Share to check the latest status.');
    } finally { setBusy(false); }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(new URL(path, window.location.origin).href);
      setNotice('Link copied.');
    } catch {
      link.current?.focus();
      link.current?.select();
      setNotice('Copy the selected link.');
    }
  }

  return <>
    <button type="button" className="btn-outline" onClick={() => setOpen(true)}>Share</button>
    <Modal open={open} onClose={() => { if (!busy) setOpen(false); }} title="Share agent">
      {status === 'checking' && <p role="status">Checking the public link…</p>}
      {status === 'unavailable' && <p role="alert">Sharing is temporarily unavailable. Try again.</p>}
      {status === 'private' && <div className="space-y-4">
        <p>Publish a tested version to let others use this agent.</p>
        {canPublish && <div className="flex flex-wrap items-center gap-3">
          {version && <button type="button" className="btn-primary" disabled={busy} onClick={() => void changeVisibility(false)}>
            {busy ? 'Publishing…' : 'Make public and share'}
          </button>}
          <Link href={`/training/${encodeURIComponent(slug)}`} className="btn-outline">Open Coach</Link>
        </div>}
        {version && <p className="text-secondary text-ink-400">Publishing makes this version available through the link and community discovery. Your runs stay private.</p>}
      </div>}
      {status === 'ready' && <div className="space-y-3">
        <input ref={link} aria-label="Public agent link" readOnly value={new URL(path, window.location.origin).href}
          className="w-full rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-secondary" />
        <div className="flex flex-wrap gap-3">
          <button type="button" className="btn-primary" onClick={copyLink}>Copy link</button>
          <Link className="btn-outline" href={path}>Preview</Link>
          {canPublish && !confirmPrivate && <button type="button" className="btn-outline" onClick={() => setConfirmPrivate(true)}>Make private</button>}
        </div>
        {confirmPrivate && <div className="space-y-3 border-t border-ink-700 pt-3">
          <p className="text-reading">Make this agent private? The public link and community access will stop working.</p>
          <div className="flex flex-wrap gap-3">
            <button type="button" className="btn-primary" disabled={busy} onClick={() => void changeVisibility(true)}>Confirm make private</button>
            <button type="button" className="btn-outline" disabled={busy} onClick={() => setConfirmPrivate(false)}>Cancel</button>
          </div>
        </div>}
      </div>}
      {notice && <p role="status" className="mt-3 text-secondary">{notice}</p>}
    </Modal>
  </>;
}
