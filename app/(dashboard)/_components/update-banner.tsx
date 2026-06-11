'use client';

/**
 * <UpdateBanner /> — a top-of-dashboard notice when one of the user's surfaces
 * (Claude / Codex / Cursor) is running an out-of-date Implexa plugin. Driven by
 * per-surface versions the recommend hook reports (users.plugin_versions)
 * compared to the latest from the backend versions feed.
 *
 * SELF-REFRESHING: the server renders the layout once, but the embedded desktop
 * window stays open for hours — so a banner computed at first paint went stale
 * the moment a new plugin shipped (the founder hit this: on Claude 0.34.0 with
 * 0.35.0 live, no banner, because the long-lived page still thought latest was
 * 0.34.0). We now re-fetch the PUBLIC /versions feed on mount, on window focus,
 * and on an interval, recomputing "behind" from the (rarely-changing) installed
 * map against the fresh latest. The server-computed list seeds the first paint.
 *
 * "Update" expands the exact command for that surface (copyable). Dismissible
 * per version-set (localStorage) so it stops nagging once seen, but returns when
 * a new version ships or the user is still behind after dismissing elsewhere.
 *
 * DESKTOP-ONLY: a plugin update is a Claude-Code-side action. The desktop app can
 * run it (via the bridge) or hand it to Claude Code; a plain browser cannot do
 * anything with `/plugin marketplace update`, so showing "Update here" on the web
 * is a dead button. We therefore render this banner ONLY inside the desktop app.
 * The desktop app updates ITSELF natively (main.js checkAppUpdate), so the web
 * has no update affordance to fake — updates live where they can actually run.
 */

import { useCallback, useEffect, useState } from 'react';

const BACKEND = (
  process.env.NEXT_PUBLIC_IMPLEXA_API_URL || 'https://core.implexa.ai'
).replace(/\/$/, '');

// Per-surface labels + the update command. Kept here (not only in the server
// layout) so the client recompute can rebuild a BehindSurface from the raw
// installed map + the freshly-fetched latest.
const SURFACE_META: Record<string, { label: string; command: string }> = {
  claude: { label: 'Claude', command: '/plugin marketplace update implexa && /plugin update implexa@implexa' },
  cursor: { label: 'Cursor', command: '/plugin marketplace update implexa && /plugin update implexa@implexa' },
  codex:  { label: 'Codex',  command: 'curl -fsSL https://core.implexa.ai/install-for-codex.sh | bash' },
};

function cmpVersion(a: string, b: string): number {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

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

// Recompute the behind-surfaces from the installed map + a fresh versions feed.
function deriveBehind(
  installed: Record<string, string> | null | undefined,
  latest: string | null,
  perSurface: Record<string, string> | undefined,
): BehindSurface[] {
  if (!installed || !latest) return [];
  const out: BehindSurface[] = [];
  for (const [surface, ver] of Object.entries(installed)) {
    const meta = SURFACE_META[surface];
    if (!meta || typeof ver !== 'string') continue;
    const surfaceLatest = perSurface?.[surface] ?? latest;
    if (cmpVersion(ver, surfaceLatest) < 0) {
      out.push({ surface, label: meta.label, installed: ver, latest: surfaceLatest, command: meta.command });
    }
  }
  return out;
}

export default function UpdateBanner({ surfaces: initialSurfaces, installed }: {
  /** Server-computed behind-list, seeds the first paint. */
  surfaces: BehindSurface[];
  /** Raw per-surface installed versions, so the client can recompute vs fresh latest. */
  installed?: Record<string, string> | null;
}) {
  const [surfaces, setSurfaces] = useState<BehindSurface[]>(initialSurfaces);
  const [open, setOpen] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [inDesktop, setInDesktop] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  const [result, setResult] = useState<Record<string, 'ok' | 'err'>>({});
  const [dismissed, setDismissed] = useState<boolean>(false);

  // Detect the desktop bridge after mount (it is injected by the desktop app's
  // preload; absent in a plain browser).
  useEffect(() => { setInDesktop(!!desktopBridge()); }, []);

  // Re-fetch the public versions feed and recompute. Keeps a long-lived window
  // (the desktop shell) honest without a full reload.
  const refresh = useCallback(async () => {
    if (!installed) return;
    try {
      const res = await fetch(`${BACKEND}/api/v2/versions`, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) return;
      const body = await res.json();
      const next = deriveBehind(installed, body?.plugin?.latest ?? null, body?.plugin?.surfaces);
      setSurfaces(next);
    } catch { /* offline / transient: keep what we have */ }
  }, [installed]);

  useEffect(() => {
    void refresh();
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', onVisible);
    const t = setInterval(() => void refresh(), 5 * 60 * 1000);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(t);
    };
  }, [refresh]);

  // Re-evaluate dismissal whenever the behind-set changes: a NEW version pair is
  // a new key, so a dismissal of an older pair doesn't suppress a fresh update.
  useEffect(() => {
    if (typeof window === 'undefined' || !surfaces.length) { setDismissed(false); return; }
    try { setDismissed(window.localStorage.getItem(dismissKey(surfaces)) === '1'); } catch { setDismissed(false); }
  }, [surfaces]);

  // Plugin updates are only actionable where Claude Code is reachable (the
  // desktop app's bridge). On the web there is nothing to do, so don't show it.
  if (!inDesktop) return null;
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
      <div className="px-4 py-2 pr-10 space-y-1">
        {surfaces.map((s) => {
          const canRun = inDesktop && DESKTOP_UPDATABLE.has(s.surface);
          const done = result[s.surface] === 'ok';
          const failed = result[s.surface] === 'err';
          return (
            <div key={s.surface}>
              <div className="flex items-center gap-3 text-sm">
                <span className="flex-1 min-w-0 truncate text-amber-700 dark:text-amber-200">
                  <span aria-hidden="true" className="mr-1.5">⬆️</span>
                  Your <strong>{s.label}</strong> plugin is out of date
                  <span className="font-mono text-xs text-amber-600/80 dark:text-amber-300/70"> (v{s.installed} → v{s.latest})</span>
                </span>

                <span className="flex flex-none items-center gap-3">
                  {done ? (
                    <span className="text-xs font-medium text-emerald-600 dark:text-emerald-300 whitespace-nowrap">
                      ✓ Updated · restart {s.label}
                    </span>
                  ) : (
                    <>
                      {canRun && (
                        <button
                          type="button"
                          disabled={running === s.surface}
                          onClick={() => runUpdate(s.surface)}
                          className="text-xs font-semibold rounded-md px-2.5 py-1 bg-amber-400 text-[#1c1410] hover:bg-amber-300 disabled:opacity-60 disabled:cursor-wait whitespace-nowrap"
                        >
                          {running === s.surface ? 'Updating…' : 'Update now'}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setOpen((o) => (o === s.surface ? null : s.surface))}
                        className="text-xs text-amber-700/90 dark:text-amber-200/80 underline underline-offset-2 hover:no-underline whitespace-nowrap"
                      >
                        {open === s.surface ? 'Hide' : canRun ? 'copy command' : 'Update here'}
                      </button>
                    </>
                  )}
                </span>
              </div>

              {failed && (
                <div className="mt-0.5 text-xs text-rose-600 dark:text-rose-300">Update failed — try the command instead.</div>
              )}

              {open === s.surface && (
                <div className="mt-1.5 flex items-center gap-2">
                  <code className="flex-1 min-w-0 text-[11px] font-mono text-ink-100 bg-ink-900/50 border border-ink-700 rounded px-2 py-1 truncate">
                    {s.command}
                  </code>
                  <button
                    type="button"
                    onClick={() => copy(s.command, s.surface)}
                    className="flex-none text-[11px] font-medium px-2 py-1 rounded border border-amber-400/40 text-amber-800 dark:text-amber-100 hover:bg-amber-400/15 whitespace-nowrap"
                  >
                    {copied === s.surface ? '✓ copied' : 'copy'}
                  </button>
                </div>
              )}
            </div>
          );
        })}
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
