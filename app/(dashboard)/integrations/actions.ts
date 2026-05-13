'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { INTEGRATIONS } from '@/lib/integrations';

type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Add the current user to the waitlist for a coming-soon integration.
 * Idempotent — re-submitting updates `notes` if provided, doesn't duplicate.
 */
export async function joinWaitlist(slug: string, notes?: string): Promise<ActionResult> {
  // Validate slug is a real integration
  const integ = INTEGRATIONS.find((i) => i.slug === slug);
  if (!integ) return { ok: false, error: 'Unknown integration.' };

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sign in to join the waitlist.' };

  const { data: profile } = await supabase
    .from('users').select('id, organization_id')
    .eq('id', user.id).maybeSingle();
  if (!profile?.organization_id) return { ok: false, error: 'No organization found for user.' };

  const { error } = await supabase
    .from('integration_waitlist')
    .upsert(
      {
        user_id:          profile.id,
        organization_id:  profile.organization_id,
        integration_slug: slug,
        notes:            notes?.trim() || null,
      },
      { onConflict: 'user_id,integration_slug' },
    );

  if (error) return { ok: false, error: error.message };
  revalidatePath('/integrations');
  return { ok: true };
}

/**
 * Remove a waitlist entry — "actually I don't want this anymore."
 */
export async function leaveWaitlist(slug: string): Promise<ActionResult> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sign in required.' };

  const { error } = await supabase
    .from('integration_waitlist')
    .delete()
    .eq('user_id', user.id)
    .eq('integration_slug', slug);

  if (error) return { ok: false, error: error.message };
  revalidatePath('/integrations');
  return { ok: true };
}
