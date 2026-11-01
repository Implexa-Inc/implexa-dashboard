/**
 * /workflows — your agents, in ONE mental model.
 *
 * Three sections (Scheduled, On-demand, Not activated), one row shape, a
 * category filter. Built by merging two owner-scoped sources server-side:
 *   - getMyAgents (the /me/agents feed): everything with an activation row —
 *     active (scheduled / on-demand) and mid-activation.
 *   - listMyWorkflows (the user's library): catches agents BUILT but never
 *     activated (no scheduled_skills row), and enriches every row with the
 *     description used for categorization + the correct ?source for its link.
 * The merged, normalized array is handed to <AgentsList /> which renders + the
 * client-side category filter. No more two-list / two-link-target confusion.
 */

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { readUserProfile } from '@/lib/profile-read';
import { listMyWorkflows, listDismissedWorkflows, listFavoriteSlugs } from '@/lib/workflow-catalog';
import { getMyAgents } from '@/lib/agents-home';
import { buildRoster } from '@/lib/agents-roster';
import { categorizeAgent } from '@/lib/agent-category';
import AgentsList, { type ArchivedAgent } from '../_components/agents-list';
import RunningAgents from '../_components/running-agents';
import ManageTips from '../_components/manage-tips';
import RetryButton from '../_components/retry-button';
import ChainSuggestions from '../_components/chain-suggestions';
import { listAgentDiscovery } from '@/lib/agent-discovery';
import { listChainOfferings } from '@/lib/agent-chain-offerings';
import AgentHomeFrame from '../_components/agent-home-frame';
import TalkToImplexa from '../_components/talk-to-implexa';
import BuildingAgents from '../_components/building-agents';
import {isExecutorConnected} from '@/lib/connection';
import {getMarketplaceSamples} from '@/lib/agent-marketplace-samples-server';
import MarketplaceSampleGallery from '../_components/marketplace-sample-gallery';
import {agentHomeView} from '@/lib/agent-marketplace-samples';
import ChainOfferingsSection from '../_components/chain-offerings-section';

export const dynamic = 'force-dynamic';

export default async function WorkflowsPage({searchParams}:{searchParams?:{tab?:string}}) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) redirect('/login');
  const profile = await readUserProfile(supabase
    .from('users').select('id, organization_id, last_mcp_call_at, last_hook_event_at').eq('id', session.user.id));
  if (!profile?.organization_id) redirect('/onboarding');

  const samples=await getMarketplaceSamples();
  const view=agentHomeView(samples,searchParams?.tab),pilot=view!=='ordinary';
  if(view==='running') redirect('/work?view=activity');
  if(view==='training') redirect('/training');
  if(view==='rent'){
    const connected=await isExecutorConnected(supabase,profile.id,{
      lastMcpCallAt:profile.last_mcp_call_at,lastHookEventAt:profile.last_hook_event_at,
    });
    return <div className="min-h-screen px-5 py-12 lg:px-8">
      <div className="mx-auto max-w-[1500px]">
        <header className="mb-8"><h1 className="text-3xl font-semibold tracking-tight text-ink-50">Rent Agent</h1><p className="mt-2 text-sm text-ink-400">Find a trained agent, or build your own.</p></header>
        <div className="grid items-start gap-8 xl:grid-cols-[300px_minmax(0,1fr)]">
          <aside aria-label="Build your own agent" className="min-w-0 xl:sticky xl:top-8"><TalkToImplexa hasAgents compact suggestions={[]} connected={connected}/><BuildingAgents/></aside>
          <div id="rent-listings" className="min-w-0"><MarketplaceSampleGallery listings={samples.listings}/></div>
        </div>
      </div>
    </div>;
  }

  const [feed, mine, dismissed, favoriteSlugs, discovery, chainOfferings] = await Promise.all([
    getMyAgents(),
    listMyWorkflows(),
    listDismissedWorkflows(),
    listFavoriteSlugs(),
    listAgentDiscovery(session.access_token),
    listChainOfferings(session.access_token),
  ]);
  const favSet = new Set(favoriteSlugs);
  const archived: ArchivedAgent[] = dismissed.map((d) => ({ slug: d.slug, name: d.name, source: d.source }));

  // ── WHO DECIDES "IS THIS ACTIVATED?" ─────────────────────────────────────────
  //
  // The merge lives in lib/agents-roster.ts as a PURE function so the invariant can be
  // tested by calling it, not by regexing this file. The invariant: `not_activated` is
  // a CLAIM, and may only be made from a READY feed.
  //
  // P0 (2026-07-28). This page used to classify every library agent as `not_activated`
  // whenever the feed failed, rendering "Saved as a draft" across the whole roster while
  // the backend was returning 33 active / 1 needs-activation / 16 drafts and nothing had
  // been deactivated.
  const { data: pausedRows } = await supabase
    .from('scheduled_skills')
    .select('skill_slug, status, trigger_type')
    .eq('status', 'paused')
    .eq('trigger_type', 'cron');

  const { agents: list, feedReady } = buildRoster({
    feed,
    mine,
    paused: pausedRows ?? [],
    categorize: categorizeAgent,
  });

  return (
    <AgentHomeFrame manage={pilot}><div className={pilot?'mx-auto max-w-4xl':''}>
        {/* THE HONEST UNAVAILABLE STATE (P0, 2026-07-28).
            Previously a failed feed rendered the whole roster as "needs activation".
            Now the page says what it does not know, and says nothing about activation. */}
        {feed.status !== 'ready' && (
          <div
            role="status"
            className="mb-6 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200"
          >
            <p className="font-medium">Couldn&apos;t load agent status</p>
            <p className="mt-1 text-amber-200/80">
              {feed.reason === 'timeout'
                ? 'The status check took too long to respond.'
                : feed.reason === 'no_session'
                  ? 'Your session expired.'
                  : 'The status service is unavailable right now.'}{' '}
              This status check didn&apos;t change your agents or schedules. We can&apos;t confirm
              their current state right now.
            </p>
            <RetryButton />
          </div>
        )}

        {/* Quiet, dismissible tips on getting hands-off agents (keep Claude
            running, schedule browser agents, run from your phone). */}
        <ManageTips />

        {/* Live "Running" section — polls /scheduled-skills/live, renders the
            5-status pulsing-dot cards. Invisible when nothing is running. */}
        <RunningAgents />

        <AgentsList
          agents={list.map((a) => ({ ...a, favorite: favSet.has(a.slug) }))}
          archived={archived}
          availableAgents={pilot?[]:discovery.agents}
          discoveryUnavailable={!pilot&&discovery.status === 'unavailable' ? discovery.reason : null}
        />

        {/* Marketplace chain offerings — outcome-first compositions the
            organization can actually acquire. Preview-scoped server-side;
            renders nothing for anyone without a grant, indistinguishable from
            there being nothing. An unavailable read also renders nothing:
            fail closed, never an invented catalog. */}
        <ChainOfferingsSection offerings={!pilot&&chainOfferings.status === 'ready' ? chainOfferings.offerings : []} />

        {/* Agent Chains, folded in as an in-page suggestion (Codex's design
            audit, 2026-07-01) rather than its own nav tab — "Agent Chains"
            sounded like a separate product. ChainSuggestions already renders
            nothing without enough agents to chain, so this is a no-op for a
            new user and appears naturally once there's something to chain. */}
        <div className="mt-10">
          <ChainSuggestions agents={list.map((a) => ({ slug: a.slug, source: a.source, name: a.name }))} />
        </div>
      </div></AgentHomeFrame>
  );
}
