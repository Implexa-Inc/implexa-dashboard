/**
 * /browse — the community agent catalog as its own section.
 *
 * Every agent the community has built and run, searchable + filterable by
 * category, ranked by real activity (people on autopilot, then runs). Picking one
 * opens its detail page where the existing activate flow takes over. This is the
 * "discover what works" surface — distinct from /workflows (your own agents).
 */

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { listAgentDiscovery } from '@/lib/agent-discovery';
import AgentDiscoveryCatalog from '../_components/agent-discovery-catalog';

export const dynamic = 'force-dynamic';

export default async function BrowsePage() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) redirect('/login');
  const { data: profile } = await supabase
    .from('users').select('organization_id').eq('id', session.user.id).maybeSingle();
  if (!profile?.organization_id) redirect('/onboarding');

  const discovery = await listAgentDiscovery(session.access_token);

  return (
    <main className="min-h-screen px-4 sm:px-8 py-12">
      <div className="max-w-5xl mx-auto">
        <header className="mb-6">
          <h1 className="text-3xl font-semibold tracking-tight text-ink-50">Browse agents</h1>
          <p className="text-ink-300 text-sm mt-1">
            Proven agents the community runs — search, filter by category, and pick one to make your own.
            Or <Link href="/create" className="text-brand-500 hover:underline">describe a new one</Link>.
          </p>
        </header>
        <AgentDiscoveryCatalog
          agents={discovery.agents}
          unavailable={discovery.status === 'unavailable' ? discovery.reason : null}
        />
      </div>
    </main>
  );
}
