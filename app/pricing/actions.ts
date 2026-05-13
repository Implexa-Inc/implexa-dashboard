'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Add the current user to the Pro waitlist.
 * Idempotent — upsert keyed on user_id.
 */
export async function joinProWaitlist(): Promise<ActionResult> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sign in to join the waitlist.' };

  const { data: profile } = await supabase
    .from('users').select('id, organization_id')
    .eq('id', user.id).maybeSingle();
  if (!profile?.organization_id) return { ok: false, error: 'No organization found for user.' };

  const { error } = await supabase
    .from('pro_waitlist')
    .upsert(
      {
        user_id:         profile.id,
        organization_id: profile.organization_id,
      },
      { onConflict: 'user_id' },
    );

  if (error) return { ok: false, error: error.message };
  revalidatePath('/pricing');
  return { ok: true };
}

/**
 * Remove the user from the Pro waitlist.
 */
export async function leaveProWaitlist(): Promise<ActionResult> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sign in required.' };

  const { error } = await supabase
    .from('pro_waitlist').delete().eq('user_id', user.id);

  if (error) return { ok: false, error: error.message };
  revalidatePath('/pricing');
  return { ok: true };
}
