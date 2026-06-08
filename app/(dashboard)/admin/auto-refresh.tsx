'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Refresh the admin server data on an interval WITHOUT a meta refresh.
 *
 * A <meta http-equiv="refresh"> schedules a browser-level reload of the current
 * URL; with Next's client-side navigation it persists after you leave the page
 * and reloads back to /admin, yanking you off whatever tab you switched to.
 * router.refresh() re-fetches this route's data in place, and the interval is
 * cleared on unmount, so leaving the page stops it.
 */
export default function AutoRefresh({ seconds = 60 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), Math.max(5, seconds) * 1000);
    return () => clearInterval(t);
  }, [router, seconds]);
  return null;
}
