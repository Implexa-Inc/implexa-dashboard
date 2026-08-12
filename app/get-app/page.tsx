/**
 * /get-app — the app-first landing after signup (hard-gate target).
 *
 * The product can't run anything without a connected executor, so a brand-new
 * account lands HERE, not in the dashboard. This screen drives the one thing
 * that matters: get the macOS app onto their machine and opened. The dashboard
 * unlocks the moment we see their executor talk to the backend (status leaves
 * 'never'); until then every dashboard route redirects back here.
 *
 * An already-connected user who somehow lands here is bounced to the
 * state-aware default landing — this page is only for the not-yet-connected.
 */

import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { createClient } from '@/lib/supabase/server';
import { computeSetupStatus } from '@/lib/setup-status';
import { postAuthDestination } from '@/lib/navigation';
import { macDownloadUrl } from '@/lib/app-links';
import PersistIntent from '../(dashboard)/_components/persist-intent';
import GetAppClient from './get-app-client';

export const dynamic = 'force-dynamic';

export default async function GetAppPage() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) redirect('/login?next=/get-app');

  const { data: profile } = await supabase
    .from('users')
    .select('display_name, last_mcp_call_at, last_hook_event_at')
    .eq('id', session.user.id)
    .maybeSingle();

  // Already connected → the dashboard is theirs; don't hold them on the door.
  const setup = computeSetupStatus(profile?.last_mcp_call_at, profile?.last_hook_event_at);
  if (setup.status !== 'never') redirect(postAuthDestination());

  const firstName = (profile?.display_name || '').trim().split(/\s+/)[0] || null;
  return (
    <>
      {/* Persist the website build intent server-side here too — the hard gate
          skips the dashboard (where PersistIntent normally lives), so a fresh
          user's "build X" would otherwise be lost until after they connect. */}
      <Suspense fallback={null}><PersistIntent /></Suspense>
      <GetAppClient dmgUrl={macDownloadUrl()} firstName={firstName} />
    </>
  );
}
