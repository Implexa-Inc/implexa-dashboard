'use client';

/**
 * One-click ZIP export button for a skill.
 *
 * The button hits GET /api/v2/skills/:slug/export.zip on the implexa backend.
 * Auth model on the server is dual-mode:
 *   - universal / system skills are public, no JWT required
 *   - org / private skills need the caller's JWT and org match
 *
 * For public skills this could be a plain <a download href> link, but doing it
 * via fetch+blob lets us share one code path AND surface errors as inline
 * messages instead of dumping a JSON error body into the browser as a "file."
 */

import { useState } from 'react';

const BACKEND_BASE = (process.env.NEXT_PUBLIC_IMPLEXA_API_URL || 'http://localhost:8001').replace(/\/$/, '');

export function DownloadSkillButton({
  slug,
  jwt,
  variant = 'pill',
}: {
  slug:    string;
  jwt?:    string | null;
  variant?: 'pill' | 'primary';
}) {
  const [busy,  setBusy]  = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setBusy(true); setError(null);
    try {
      const headers: Record<string, string> = {};
      if (jwt) headers.Authorization = `Bearer ${jwt}`;
      const res = await fetch(`${BACKEND_BASE}/api/v2/skills/${encodeURIComponent(slug)}/export.zip`, {
        method: 'GET',
        headers,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        let msg = `download failed (${res.status})`;
        try {
          const parsed = JSON.parse(text);
          if (parsed?.error) msg = parsed.error;
        } catch (_) { /* not JSON, keep default */ }
        throw new Error(msg);
      }

      const blob = await res.blob();
      const cd   = res.headers.get('Content-Disposition') || '';
      const m    = cd.match(/filename="?([^"]+)"?/i);
      const name = m?.[1] || `implexa-${slug}.zip`;

      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'download failed');
    } finally {
      setBusy(false);
    }
  }

  const baseClass = variant === 'primary'
    ? 'btn-primary'
    : 'text-xs px-2.5 py-1 rounded-md border border-ink-700 text-ink-100 hover:bg-ink-800 transition-colors';

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={download}
        disabled={busy}
        className={baseClass}
        title="download a portable zip for cursor, gemini cli, hermes, goose, and other agents"
      >
        {busy ? 'Packaging…' : 'Download'}
      </button>
      {error && <span className="text-xs text-red-500">{error}</span>}
    </span>
  );
}
