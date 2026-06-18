'use client';

import { useEffect, useState } from 'react';
import { isInDesktopApp } from '@/lib/desktop';

/**
 * Renders its children ONLY in a normal browser — hidden when the dashboard is
 * running inside the Implexa desktop app's own window (window.implexaDesktop).
 * Used to suppress "Open in the Implexa app" links that are nonsensical when you
 * are already in the app. SSR-safe: renders children on the server + first paint,
 * then hides on mount if in-app (a brief flash inside the app is acceptable).
 */
export default function NotInApp({ children }: { children: React.ReactNode }) {
  const [inApp, setInApp] = useState(false);
  useEffect(() => { setInApp(isInDesktopApp()); }, []);
  if (inApp) return null;
  return <>{children}</>;
}
