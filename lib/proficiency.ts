/**
 * lib/proficiency.ts , the user's Claude Code / Codex comfort level, used to
 * calibrate how hands-on the product is (audit #7). Novice/beginner = guided
 * (plainer copy, one-tap "Turn it on", more done-for-you); pro/advanced = the
 * faster, denser, terminal-aware path.
 *
 * Read DEFENSIVELY: the users.proficiency column (migration 0076) may not be
 * applied in every environment yet, so a missing-column error degrades to null
 * (= no adaptation), never an exception that breaks the page.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export type Proficiency = 'novice' | 'beginner' | 'pro' | 'advanced';

export function isGuided(p: Proficiency | null | undefined): boolean {
  return p === 'novice' || p === 'beginner';
}

export async function getProficiency(
  supabase: SupabaseClient,
  userId: string,
): Promise<Proficiency | null> {
  try {
    const { data, error } = await supabase
      .from('users').select('proficiency').eq('id', userId).maybeSingle();
    if (error) return null; // column not present yet, or transient , degrade quietly
    const p = (data as { proficiency?: string } | null)?.proficiency;
    return p === 'novice' || p === 'beginner' || p === 'pro' || p === 'advanced' ? p : null;
  } catch {
    return null;
  }
}
