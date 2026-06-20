'use client';

/**
 * <AutoUpdateToast /> — a Claude-style bottom-left "Update ready · Restart" toast.
 *
 * The Implexa desktop app (Electron) runs electron-updater, which silently
 * downloads a new build in the background. When the build is staged it fires
 * 'app-update:ready' across the preload bridge; we surface a small, unobtrusive
 * toast pinned bottom-left offering "Restart to update" (applies the staged build
 * via autoUpdater.quitAndInstall) plus a dismiss.
 *
 * DESKTOP-ONLY by construction: the capability lives on window.implexaDesktop,
 * injected only inside the desktop window's preload. In a plain browser the
 * bridge (and onUpdateReady) is absent, so this renders nothing — the web has no
 * app to restart. Mirrors <UpdateBanner />'s "only where it's actionable" rule.
 */

import { useEffect, useState } from 'react';

// Injected by the desktop app's dashboard-preload.js. onUpdateReady subscribes to
// the staged-build event AND immediately replays any update staged before this
// mounted (e.g. after a dashboard reload); it returns an unsubscribe fn.
type DesktopBridge = {
  onUpdateReady?: (cb: (info: { version: string | null }) => void) => (() => void);
  restartToUpdate?: () => Promise<boolean>;
};

function desktopBridge(): DesktopBridge | null {
  if (typeof window === 'undefined') return null;
  const b = (window as unknown as { implexaDesktop?: DesktopBridge }).implexaDesktop;
  return b && typeof b.onUpdateReady === 'function' ? b : null;
}

export default function AutoUpdateToast() {
  const [version, setVersion] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [restarting, setRestarting] = useState(false);

  // Subscribe to the staged-build event. Feature-detected: a no-op on plain web.
  useEffect(() => {
    const bridge = desktopBridge();
    if (!bridge?.onUpdateReady) return;
    const unsubscribe = bridge.onUpdateReady((info) => {
      setVersion(info?.version ?? null);
      setReady(true);
      setDismissed(false); // a fresh staged build re-asserts the toast
    });
    return () => { try { unsubscribe?.(); } catch { /* ignore */ } };
  }, []);

  if (!ready || dismissed) return null;

  async function restart() {
    const bridge = desktopBridge();
    if (!bridge?.restartToUpdate) return;
    setRestarting(true);
    try {
      await bridge.restartToUpdate(); // quitAndInstall: the app relaunches, so we won't return
    } catch {
      setRestarting(false); // only reached if the restart failed to take
    }
  }

  return (
    <div className="fixed bottom-4 left-4 z-50 w-[300px] max-w-[calc(100vw-2rem)]">
      <div className="rounded-lg border border-ink-700 bg-ink-900 shadow-lg shadow-black/30 px-3.5 py-3">
        <div className="flex items-start gap-2.5">
          <span aria-hidden="true" className="mt-0.5 text-base leading-none">⬆️</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-ink-100">
              {version ? `Implexa v${version} is ready` : 'An Implexa update is ready'}
            </p>
            <p className="mt-0.5 text-xs text-ink-300">Restart to update.</p>
            <div className="mt-2.5 flex items-center gap-2">
              <button
                type="button"
                onClick={restart}
                disabled={restarting}
                className="text-xs font-semibold rounded-md px-2.5 py-1 bg-ink-100 text-ink-950 hover:bg-white disabled:opacity-60 disabled:cursor-wait"
              >
                {restarting ? 'Restarting…' : 'Restart'}
              </button>
              <button
                type="button"
                onClick={() => setDismissed(true)}
                className="text-xs text-ink-400 hover:text-ink-200"
              >
                Later
              </button>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            aria-label="Dismiss"
            className="-mr-1 -mt-1 flex-none text-ink-500 hover:text-ink-300 text-sm leading-none"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}
