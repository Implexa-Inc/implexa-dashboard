/**
 * The ONE definition of "this user has a connected executor", shared by the
 * dashboard hard-gate (app/(dashboard)/layout.tsx) and Home (/overview) so they
 * never disagree. Two signals, either is enough:
 *
 *   1. Real activity — users.last_mcp_call_at / last_hook_event_at (a run or hook
 *      fired): the executor has actually done work.
 *   2. App-open — an active api_key with last_used_at set: the desktop drainer
 *      pings the backend every ~20s while the app is open, so simply having the
 *      app running counts, before any run.
 *
 * Keep these in lockstep. When they drifted, Home showed "Download the app /
 * Connect your Claude" to a user the gate had already let in as connected.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { computeSetupStatus } from './setup-status';

export async function isExecutorConnected(
  supabase: SupabaseClient,
  userId: string,
  activity?: { lastMcpCallAt?: string | null; lastHookEventAt?: string | null },
): Promise<boolean> {
  // Signal 1: real activity (cheap — usually already loaded by the caller).
  if (activity && computeSetupStatus(activity.lastMcpCallAt, activity.lastHookEventAt).status !== 'never') {
    return true;
  }
  // Signal 2: the app is open (a key has been exercised). One indexed lookup.
  const { data } = await supabase
    .from('api_keys')
    .select('last_used_at')
    .eq('user_id', userId)
    .eq('status', 'active')
    .not('last_used_at', 'is', null)
    .limit(1);
  return (data || []).length > 0;
}
