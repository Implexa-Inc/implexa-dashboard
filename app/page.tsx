import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { postAuthDestination } from '@/lib/navigation';

/**
 * The root redirect — one of the product's real default entry points, so it
 * resolves the state-aware landing rule (/start) rather than hard-coding a
 * destination of its own.
 */
export default async function RootPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  redirect(user ? postAuthDestination() : '/login');
}
