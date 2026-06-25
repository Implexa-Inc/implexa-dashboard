'use client';

/**
 * <RunShareButton /> — turn a finished run into a public Run Card.
 *
 * Opt-in (the owner clicks). POSTs /api/v2/runs/:id/share, gets a public URL,
 * shows it with a copy button. The run stays private; the card is a PII-scrubbed
 * snapshot + the trust line + a fork-the-agent CTA. The growth loop's trigger.
 */

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { callBackend } from '@/lib/api';

export default function RunShareButton({ runId }: { runId: string }) {
  const supabase = createClient();
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function share() {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await callBackend(`/api/v2/runs/${encodeURIComponent(runId)}/share`, {
        jwt: session?.access_token, method: 'POST', body: {},
      });
      if (res?.url) setUrl(res.url as string);
      else setErr('Could not create a share link.');
    } catch {
      setErr('Could not create a share link.');
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!url) return;
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* noop */ }
  }

  if (url) {
    return (
      <div className="flex items-center gap-2 text-xs flex-wrap">
        <span className="text-ink-500">Public Run Card:</span>
        <code className="bg-ink-900 border border-ink-700 rounded px-2 py-1 text-ink-200 truncate max-w-[260px]">{url}</code>
        <button type="button" onClick={copy} className="btn-outline px-2.5 py-1">{copied ? 'Copied' : 'Copy'}</button>
        <a href={url} target="_blank" rel="noreferrer" className="text-brand-500 hover:underline">Open ↗</a>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={share}
        disabled={busy}
        title="Create a public, forkable Run Card for this run"
        className="inline-flex items-center gap-1.5 rounded-lg bg-amber-400 text-ink-950 hover:bg-amber-300 text-sm font-medium px-3.5 py-1.5 transition-colors disabled:opacity-60"
      >
        <ShareIcon />
        {busy ? 'Creating…' : 'Share this run'}
      </button>
      {err && <span className="text-xs text-rose-500">{err}</span>}
    </div>
  );
}

function ShareIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </svg>
  );
}
