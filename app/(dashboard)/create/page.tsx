/**
 * /create — the one place to START an agent. Two paths, one page:
 *   1. Describe it (the build box) → your own Claude builds it.
 *   2. Pick a proven one (the community catalog) → activate it as-is.
 *
 * This closes the new-user dead end: before, a user with zero agents had no
 * discovery surface inside the dashboard — only the build box on Home. Now
 * "Create agent" (the button on /workflows) lands here, with the community
 * catalog + search + activity signals, mirroring the public website catalog.
 *
 * Server-rendered, RLS-scoped. Reuses the same building blocks as Home
 * (TalkToImplexa, listWorkflows) so there's one source of truth, not a fork.
 */

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { isExecutorConnected } from '@/lib/connection';
import { getProficiency, isGuided } from '@/lib/proficiency';
import { listSuggestedAgents } from '@/lib/workflow-catalog';
import { listAgentDiscovery } from '@/lib/agent-discovery';
import TalkToImplexa from '../_components/talk-to-implexa';
import BuildingAgents from '../_components/building-agents';
import AgentDiscoveryCatalog from '../_components/agent-discovery-catalog';

export const dynamic = 'force-dynamic';

export default async function CreatePage() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) redirect('/login');
  const { data: profile } = await supabase
    .from('users').select('id, organization_id, last_mcp_call_at, last_hook_event_at')
    .eq('id', session.user.id).maybeSingle();
  if (!profile?.organization_id) redirect('/onboarding');

  const [discovery, suggested, proficiency] = await Promise.all([
    listAgentDiscovery(session.access_token),
    listSuggestedAgents(6),
    getProficiency(supabase, session.user.id),
  ]);
  const guided = isGuided(proficiency);
  const connected = await isExecutorConnected(supabase, profile.id, {
    lastMcpCallAt: profile.last_mcp_call_at, lastHookEventAt: profile.last_hook_event_at,
  });

  return (
    <main className="min-h-screen px-6 lg:px-12 py-14">
      <div className="max-w-3xl mx-auto">
        <div className="mb-6">
          <Link href="/workflows" className="text-xs text-ink-400 hover:text-ink-200 hover:underline">← Your agents</Link>
          <h1 className="text-2xl font-semibold tracking-tight text-ink-50 mt-2">Create an agent</h1>
          <p className="text-sm text-ink-400 mt-1">
            Describe what you want and your own Claude builds it — or start from one the community already runs.
          </p>
        </div>

        {/* 1) Describe it */}
        <TalkToImplexa hasAgents guided={guided} suggestions={suggested} connected={connected} />
        <BuildingAgents />

        {/* divider */}
        <div className="relative my-10 text-center">
          <span className="bg-ink-950 px-3 relative z-10 text-xs uppercase tracking-wide text-ink-500">or pick a proven one</span>
          <div className="absolute top-1/2 left-0 right-0 h-px bg-ink-800" />
        </div>

        {/* 2) Pick a proven one */}
        <AgentDiscoveryCatalog
          agents={discovery.agents}
          unavailable={discovery.status === 'unavailable' ? discovery.reason : null}
        />
      </div>
    </main>
  );
}
