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
      <div className="flex items-center gap-2 text-xs">
        <span className="text-ink-500">Public Run Card:</span>
        <code className="bg-ink-900 border border-ink-700 rounded px-2 py-1 text-ink-200 truncate max-w-[260px]">{url}</code>
        <button type="button" onClick={copy} className="btn-outline px-2.5 py-1">{copied ? 'Copied' : 'Copy'}</button>
        <a href={url} target="_blank" rel="noreferrer" className="text-brand-500 hover:underline">Open ↗</a>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <button type="button" onClick={share} disabled={busy} className="btn-outline text-xs px-3 py-1.5 disabled:opacity-60">
        {busy ? 'Creating…' : 'Share this result'}
      </button>
      {err && <span className="text-xs text-rose-500">{err}</span>}
    </div>
  );
}
