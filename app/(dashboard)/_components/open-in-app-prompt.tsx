'use client';

/**
 * <OpenInAppPrompt /> — the web→app handoff for a run permalink.
 *
 * The email "Open this run in Implexa" link must be https:// (mail clients won't
 * open a custom scheme), so it lands on the web run page. This prompt offers to
 * bounce into the desktop app: clicking fires implexa://runs/<id>, which the
 * registered scheme hands to the app (routeDeepLink navigates its window to the
 * same /runs/<id>). If the app isn't installed/doesn't catch it, the user simply
 * stays on this web page — the page IS the fallback, so the handoff is lossless.
 *
 * Suppressed when we're ALREADY inside the desktop app's embedded browser
 * (window.implexaDesktop present) — no point bouncing the app into itself. A
 * dismissal is remembered for the session so it doesn't nag on every run link.
 *
 * Gated by desktopAppLive() at the call site, so it's dormant until the app
 * ships (NEXT_PUBLIC_DESKTOP_APP_LIVE=true).
 */

import { useEffect, useState } from 'react';
import { appRunUrl } from '@/lib/app-links';

const DISMISS_KEY = 'implexa_open_in_app_dismissed';

export default function OpenInAppPrompt({ runId }: { runId: string }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const inApp = !!(window as Window & { implexaDesktop?: unknown }).implexaDesktop;
    let dismissed = false;
    try { dismissed = sessionStorage.getItem(DISMISS_KEY) === '1'; } catch { /* private mode */ }
    if (!inApp && !dismissed) setShow(true);
  }, []);

  if (!show) return null;

  function dismiss() {
    try { sessionStorage.setItem(DISMISS_KEY, '1'); } catch { /* best effort */ }
    setShow(false);
  }

  return (
    <div className="mb-5 rounded-lg border border-brand-500/30 bg-brand-500/10 p-3 flex items-center justify-between gap-3 flex-wrap">
      <p className="text-sm text-ink-100">
        Open this run in the <span className="font-medium">Implexa app</span> to run, pause, or fix it in one place.
      </p>
      <div className="flex items-center gap-1.5 flex-none">
        <a
          href={appRunUrl(runId)}
          onClick={dismiss}
          className="btn-success text-xs px-3 py-1.5 whitespace-nowrap"
        >
          Open in app ↗
        </a>
        <button
          type="button"
          onClick={dismiss}
          className="text-xs text-ink-400 hover:text-ink-200 px-2 py-1.5 whitespace-nowrap"
        >
          Continue on web
        </button>
      </div>
    </div>
  );
}
