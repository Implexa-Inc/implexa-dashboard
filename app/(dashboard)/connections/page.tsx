/**
 * /connections — "Needs you": ONLY things waiting on the user, each with one
 * clear action. As of the 2-section redesign this is no longer in the nav (its
 * items fold into Home), but the route stays live for deep links and the full
 * view. Both this page and the Home strip read from lib/needs-you, so there is
 * one source of truth for "what is waiting on you". The full account inventory
 * lives at /settings/connections.
 */

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { loadNeedsYou } from '@/lib/needs-you';
import NeedsYouStrip from '../_components/needs-you-strip';

export const dynamic = 'force-dynamic';

export default async function NeedsYouPage() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) redirect('/login');
  const { data: profile } = await supabase
    .from('users').select('id, organization_id')
    .eq('id', session.user.id).maybeSingle();
  if (!profile?.organization_id) redirect('/onboarding');

  const needsYou = await loadNeedsYou(supabase);

  return (
    <main className="min-h-screen px-4 py-12">
      <div className="max-w-3xl mx-auto">
        <header className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight text-ink-50">Needs you</h1>
          <p className="text-sm text-ink-400 mt-2 max-w-2xl">
            Only the things waiting on you, each with one action. When this is empty, your agents are running on their own.
          </p>
        </header>

        {needsYou.total === 0 ? (
          <div className="card text-center py-10">
            <div className="text-xl mb-1" aria-hidden>✓</div>
            <p className="text-ink-100 font-medium text-sm">Nothing needs you right now.</p>
            <p className="text-xs text-ink-500 mt-1">Grants, reviews, missed schedules, and sign-ins will show up here.</p>
          </div>
        ) : (
          <NeedsYouStrip data={needsYou} variant="full" />
        )}

        <p className="text-xs text-ink-500 mt-10">
          Looking for the full account list? <Link href="/settings/connections" className="text-brand-500 hover:underline">All your accounts →</Link>
        </p>
      </div>
    </main>
  );
}
