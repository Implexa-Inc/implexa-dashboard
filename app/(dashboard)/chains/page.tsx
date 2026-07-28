/**
 * /chains — Agent Chains (the redesign's Tab 3).
 *
 * Promotes the "Chain your agents" experience (one agent's output feeds the next,
 * one tap builds the pipeline) to its own first-class tab. Reuses <ChainSuggestions/>
 * — the same component the Agents page used to host inline — over the user's full
 * agent list (active + library), so chain suggestions span everything they own.
 */

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { listMyWorkflows } from '@/lib/workflow-catalog';
import { getMyAgents } from '@/lib/agents-home';
import ChainSuggestions from '../_components/chain-suggestions';

export const dynamic = 'force-dynamic';

export default async function ChainsPage() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) redirect('/login');
  const { data: profile } = await supabase
    .from('users').select('id, organization_id')
    .eq('id', session.user.id).maybeSingle();
  if (!profile?.organization_id) redirect('/onboarding');

  const [feedRes, mine] = await Promise.all([getMyAgents(), listMyWorkflows()]);
  // Chain suggestions degrade to the library alone when the feed is unavailable -- they
  // are suggestions, so a thinner list is acceptable; a WRONG list is not.
  const feed = feedRes.status === 'ready' ? feedRes : null;

  // Build a slug→{source,name} agent list (active + library), deduped — the input
  // ChainSuggestions ranks pipelines over.
  const sourceFor = (slug: string) => mine.find((w) => w.slug === slug)?.source || 'generated';
  const agents: Array<{ slug: string; source: string; name: string }> = [];
  const seen = new Set<string>();
  for (const a of [...(feed?.active ?? []), ...(feed?.needsActivation ?? [])]) {
    if (seen.has(a.slug)) continue;
    seen.add(a.slug);
    agents.push({ slug: a.slug, source: sourceFor(a.slug), name: a.name });
  }
  for (const w of mine) {
    if (seen.has(w.slug)) continue;
    seen.add(w.slug);
    agents.push({ slug: w.slug, source: w.source, name: w.name });
  }

  return (
    <main className="min-h-screen px-4 py-12">
      <div className="max-w-4xl mx-auto">
        <header className="mb-7">
          <h1 className="text-3xl font-semibold tracking-tight text-ink-50">Agent Chains</h1>
          <p className="text-ink-300 text-sm mt-1">
            Chain your agents — one agent&apos;s output feeds the next. One tap builds the pipeline.
            Build the agents on <Link href="/workflows" className="text-brand-500 hover:underline">Agents</Link>.
          </p>
        </header>

        {agents.length >= 2 ? (
          <ChainSuggestions agents={agents} />
        ) : (
          <div className="card text-sm text-ink-300">
            <p className="font-medium text-ink-100 mb-1">You need at least two agents to chain.</p>
            <p>Build a couple on <Link href="/workflows" className="text-brand-500 hover:underline">Agents</Link>, then come back to wire them into a pipeline.</p>
          </div>
        )}
      </div>
    </main>
  );
}

export const metadata = { title: 'Agent Chains — Implexa' };
