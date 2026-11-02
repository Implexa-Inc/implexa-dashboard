import {Fragment} from 'react';
import {createClient} from '@/lib/supabase/server';
import {listMyWorkflows,listDismissedWorkflows,listFavoriteSlugs} from '@/lib/workflow-catalog';
import {getMyAgents} from '@/lib/agents-home';
import {buildRoster} from '@/lib/agents-roster';
import {categorizeAgent} from '@/lib/agent-category';
import {listAgentDiscovery} from '@/lib/agent-discovery';
import {listChainOfferings} from '@/lib/agent-chain-offerings';
import AgentsList,{type ArchivedAgent} from './agents-list';
import RunningAgents from './running-agents';
import ManageTips from './manage-tips';
import RetryButton from './retry-button';
import ChainSuggestions from './chain-suggestions';
import ChainOfferingsSection from './chain-offerings-section';
import AgentHomeFrame from './agent-home-frame';

/** Existing installed roster, shared by management and the Run collection. */
export default async function InstalledAgents({jwt,pilot,insideRun=false}:{jwt:string;pilot:boolean;insideRun?:boolean}) {
 const supabase=createClient();
  const [feed, mine, dismissed, favoriteSlugs, discovery, chainOfferings] = await Promise.all([
    getMyAgents(),
    listMyWorkflows(),
    listDismissedWorkflows(),
    listFavoriteSlugs(),
    pilot ? Promise.resolve(null) : listAgentDiscovery(jwt),
    pilot ? Promise.resolve(null) : listChainOfferings(jwt),
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

  const Frame = insideRun ? Fragment : AgentHomeFrame;
  return (
    <Frame {...(insideRun ? {} : {manage: pilot})}><div className={pilot?'mx-auto max-w-4xl':''}>
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
        {!insideRun&&<ManageTips />}

        {/* Live "Running" section — polls /scheduled-skills/live, renders the
            5-status pulsing-dot cards. Invisible when nothing is running. */}
        {!insideRun&&<RunningAgents />}

        <AgentsList
          agents={list.map((a) => ({ ...a, favorite: favSet.has(a.slug) }))}
          archived={archived}
          availableAgents={discovery?.status==='ready'?discovery.agents:[]}
          discoveryUnavailable={!pilot&&discovery?.status === 'unavailable' ? discovery.reason : null}
        />

        {/* Marketplace chain offerings — outcome-first compositions the
            organization can actually acquire. Preview-scoped server-side;
            renders nothing for anyone without a grant, indistinguishable from
            there being nothing. An unavailable read also renders nothing:
            fail closed, never an invented catalog. */}
        <ChainOfferingsSection offerings={!pilot&&chainOfferings?.status === 'ready' ? chainOfferings.offerings : []} />

        {/* Agent Chains, folded in as an in-page suggestion (Codex's design
            audit, 2026-07-01) rather than its own nav tab — "Agent Chains"
            sounded like a separate product. ChainSuggestions already renders
            nothing without enough agents to chain, so this is a no-op for a
            new user and appears naturally once there's something to chain. */}
        {!insideRun&&<div className="mt-10">
          <ChainSuggestions agents={list.map((a) => ({ slug: a.slug, source: a.source, name: a.name }))} />
        </div>}
      </div></Frame>
  );
}
