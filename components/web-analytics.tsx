'use client';

import { Analytics } from '@vercel/analytics/next';
import { scrubAnalyticsUrl } from '@/lib/web-analytics';

// Vercel Web Analytics with every URL scrubbed first (lib/web-analytics.ts).
// A client component because beforeSend is a function and cannot be passed
// from the server-rendered root layout.
export function WebAnalytics() {
  return (
    <Analytics
      beforeSend={(event) => {
        const url = scrubAnalyticsUrl(event.url);
        return url ? { ...event, url } : null;
      }}
    />
  );
}
