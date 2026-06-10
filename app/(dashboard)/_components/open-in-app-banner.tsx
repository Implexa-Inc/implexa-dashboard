'use client';

import { useEffect, useState } from 'react';
import { isInDesktopApp, openInApp } from '@/lib/desktop';

/**
 * <OpenInAppBanner /> — hands a web activate/run page off to the Implexa desktop
 * app (the one activate/run surface, per boardroom/HANDOFF_PROCESS.md).
 *
 * - Inside the app (window.implexaDesktop present): renders nothing; the page's
 *   own card handles everything. No deep-link, so it never loops into itself.
 * - In a browser: attempts the implexa:// deep link ONCE per session (so we don't
 *   re-prompt on every navigation) and shows a banner with an explicit "Open app"
 *   button. The page's card still renders below as the graceful fallback for when
 *   the app isn't installed yet.
 */
export function OpenInAppBanner({ path, verb = 'activate' }: { path: string; verb?: string }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (isInDesktopApp()) { setShow(false); return; }
    setShow(true);
    let t: ReturnType<typeof setTimeout> | undefined;
    try {
      const key = `implexa-handoff:${path}`;
      if (!sessionStorage.getItem(key)) {
        sessionStorage.setItem(key, '1');
        // Paint first, then attempt the handoff, so it isn't a jarring instant prompt.
        t = setTimeout(() => openInApp(path), 400);
      }
    } catch { /* sessionStorage blocked (private mode): still show the banner */ }
    return () => { if (t) clearTimeout(t); };
  }, [path]);

  if (!show) return null;

  return (
    <div className="mb-5 rounded-lg border border-brand-500/30 bg-brand-500/10 px-4 py-3 flex items-center justify-between gap-3">
      <p className="text-sm text-ink-200">
        Agents {verb} in the <span className="font-medium">Implexa app</span> (that&rsquo;s where they run on your computer).
      </p>
      <div className="flex items-center gap-3 flex-none">
        <button type="button" onClick={() => openInApp(path)} className="btn-success text-xs px-3 py-1.5">Open app</button>
        <span className="text-xs text-ink-500">No app? Use the steps below.</span>
      </div>
    </div>
  );
}
