'use client';

/**
 * <PersistIntent /> — headless. Closes the #1 conversion leak (audit #1).
 *
 * A visitor typed a job on the website; it rode ?intent= into app-origin
 * localStorage through signup. The build run-request that turns it into a real
 * agent USED to be created only on /overview (GetStartedIntent), but onboarding
 * ends on /install, so a user who connected Claude before ever visiting Home
 * lost the thing they came for. This is mounted in the dashboard LAYOUT, so it
 * fires on /install and every authed page: the moment the account+org exist,
 * the intent is persisted server-side as a pending build request, and the
 * plugin's pending-runs hook picks it up the instant they connect.
 *
 * Dedupe: POST once per distinct intent value (a localStorage marker), so
 * mounting on every page never double-submits. The visible "your agent is ready"
 * card still lives on Home (GetStartedIntent); this only does the side-effect.
 */

import { useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { callBackend } from '@/lib/api';

const KEY = 'implexa_pending_intent';
const POSTED = 'implexa_intent_posted';

export default function PersistIntent() {
  const params = useSearchParams();
  const supabase = createClient();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    let pending = (params.get('intent') || '').trim();
    try {
      // A logged-in deep link (?intent=) takes priority and is stashed so the
      // Home card can still display it; otherwise read the signup-stashed value.
      if (pending) window.localStorage.setItem(KEY, pending);
      else pending = (window.localStorage.getItem(KEY) || '').trim();
    } catch { /* private mode */ }
    if (!pending) return;

    // Only POST once per distinct intent (survives navigations + sessions).
    let already = '';
    try { already = window.localStorage.getItem(POSTED) || ''; } catch { /* ignore */ }
    if (already === pending) return;

    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        await callBackend('/api/v2/me/run-requests', {
          jwt: session?.access_token,
          method: 'POST',
          body: { kind: 'build', intent: pending, source: 'website' },
        });
        try { window.localStorage.setItem(POSTED, pending); } catch { /* ignore */ }
      } catch { /* not posted; retries on the next authed page mount */ }
    })();
  }, [params, supabase]);

  return null;
}
