import React from 'react';
import { readUserProfile } from '@/lib/profile-read';
import { createClient } from '@/lib/supabase/server';

async function readDashboardAccount() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  const profile = session?.user ? await readUserProfile(supabase.from('users')
    .select('id, organization_id, display_name, email, founding_creator_unlocked_at, last_mcp_call_at, last_hook_event_at')
    .eq('id', session.user.id)) : null;
  return { supabase, session, profile };
}

/** Share only within the current server render; the caller's session and RLS stay in force. */
export const dashboardAccount = React.cache?.(readDashboardAccount) ?? readDashboardAccount;
