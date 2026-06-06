'use client';

/**
 * <UpdateBanner /> — a top-of-dashboard notice when one of the user's surfaces
 * (Claude / Codex / Cursor) is running an out-of-date Implexa plugin. Driven by
 * per-surface versions the recommend hook reports (users.plugin_versions)
 * compared to the latest from the backend versions feed.
 *
 * "Update" expands the exact command for that surface (copyable). Dismissible
 * per version-set (localStorage) so it stops nagging once seen, but returns when
 * a new version ships or the user is still behind after dismissing elsewhere.
 */

import { useState } from 'react';

export type BehindSurface = {
  surface: string;       // 'claude' | 'codex' | 'cursor'
  label: string;         // 'Claude' | 'Codex' | 'Cursor'
  installed: string;     // e.g. '0.12.0'
  latest: string;        // e.g. '0.27.2'
  command: string;       // surface-specific update command
};

function dismissKey(surfaces: BehindSurface[]): string {
  return 'implexa.updbanner.' + surfaces.map((s) => `${s.surface}@${s.installed}->${s.latest}`).join(',');
}

export default function UpdateBanner({ surfaces }: { surfaces: BehindSurface[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !surfaces.length) return false;
    try { return window.localStorage.getItem(dismissKey(surfaces)) === '1'; } catch { return false; }
  });

  if (!surfaces.length || dismissed) return null;

  function dismiss() {
    try { window.localStorage.setItem(dismissKey(surfaces), '1'); } catch { /* ignore */ }
    setDismissed(true);
  }

  async function copy(cmd: string, surface: string) {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(surface);
      setTimeout(() => setCopied((c) => (c === surface ? null : c)), 1800);
    } catch { /* clipboard blocked */ }
  }

  return (
    <div className="relative border-b border-amber-400/30 bg-amber-400/10">
      <div className="px-4 py-2.5 pr-10">
        {surfaces.map((s) => (
          <div key={s.surface} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span aria-hidden="true">⬆️</span>
            <span className="text-amber-700 dark:text-amber-200">
              Your <strong>{s.label}</strong> plugin is out of date
              <span className="font-mono text-xs text-amber-600/80 dark:text-amber-300/70"> (v{s.installed} → v{s.latest})</span>.
            </span>
            <button
              type="button"
              onClick={() => setOpen((o) => (o === s.surface ? null : s.surface))}
              className="font-medium text-amber-800 dark:text-amber-100 underline underline-offset-2 hover:no-underline"
            >
              {open === s.surface ? 'Hide' : 'Update here'}
            </button>
            {open === s.surface && (
              <span className="flex items-center gap-2 basis-full sm:basis-auto mt-1 sm:mt-0">
                <code className="text-[11px] font-mono text-ink-100 bg-ink-900/50 border border-ink-700 rounded px-2 py-1 truncate max-w-[60ch]">
                  {s.command}
                </code>
                <button
                  type="button"
                  onClick={() => copy(s.command, s.surface)}
                  className="text-[11px] font-medium px-2 py-1 rounded border border-amber-400/40 text-amber-800 dark:text-amber-100 hover:bg-amber-400/15 whitespace-nowrap"
                >
                  {copied === s.surface ? '✓ copied' : 'copy'}
                </button>
              </span>
            )}
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="absolute right-3 top-2 text-amber-700/70 dark:text-amber-300/60 hover:text-amber-800 dark:hover:text-amber-100 text-sm"
      >
        ✕
      </button>
    </div>
  );
}
