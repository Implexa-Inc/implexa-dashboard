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

import { useEffect, useState } from 'react';

// Injected by the desktop app's dashboard-preload.js. Present only when the
// banner renders inside the Implexa desktop window — lets us run the update
// directly instead of handing over a copy-paste command.
type DesktopBridge = { runUpdate: (surface: string) => Promise<{ ok: boolean; error?: string }> };
function desktopBridge(): DesktopBridge | null {
  if (typeof window === 'undefined') return null;
  const b = (window as unknown as { implexaDesktop?: DesktopBridge }).implexaDesktop;
  return b && typeof b.runUpdate === 'function' ? b : null;
}
// Surfaces the desktop app can update in place (it has an installer for them).
const DESKTOP_UPDATABLE = new Set(['claude', 'codex']);

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
  const [inDesktop, setInDesktop] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  const [result, setResult] = useState<Record<string, 'ok' | 'err'>>({});
  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !surfaces.length) return false;
    try { return window.localStorage.getItem(dismissKey(surfaces)) === '1'; } catch { return false; }
  });

  // Detect the desktop bridge after mount (it is injected by the desktop app's
  // preload; absent in a plain browser).
  useEffect(() => { setInDesktop(!!desktopBridge()); }, []);

  if (!surfaces.length || dismissed) return null;

  async function runUpdate(surface: string) {
    const bridge = desktopBridge();
    if (!bridge) return;
    setRunning(surface);
    try {
      const res = await bridge.runUpdate(surface);
      setResult((r) => ({ ...r, [surface]: res?.ok ? 'ok' : 'err' }));
    } catch {
      setResult((r) => ({ ...r, [surface]: 'err' }));
    } finally {
      setRunning((s) => (s === surface ? null : s));
    }
  }

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
            {/* In the desktop app: one-click direct update (runs the installer). */}
            {inDesktop && DESKTOP_UPDATABLE.has(s.surface) && (
              result[s.surface] === 'ok' ? (
                <span className="font-medium text-emerald-600 dark:text-emerald-300">✓ Updated — restart {s.label} to load it</span>
              ) : (
                <button
                  type="button"
                  disabled={running === s.surface}
                  onClick={() => runUpdate(s.surface)}
                  className="font-semibold rounded px-2.5 py-1 bg-amber-400 text-[#1c1410] hover:bg-amber-300 disabled:opacity-60 disabled:cursor-wait"
                >
                  {running === s.surface ? 'Updating…' : 'Update now'}
                </button>
              )
            )}
            {inDesktop && result[s.surface] === 'err' && (
              <span className="text-rose-600 dark:text-rose-300 text-xs">Update failed — try the command below</span>
            )}
            <button
              type="button"
              onClick={() => setOpen((o) => (o === s.surface ? null : s.surface))}
              className="font-medium text-amber-800 dark:text-amber-100 underline underline-offset-2 hover:no-underline"
            >
              {open === s.surface ? 'Hide' : (inDesktop && DESKTOP_UPDATABLE.has(s.surface) ? 'or copy command' : 'Update here')}
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
