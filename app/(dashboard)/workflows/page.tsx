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
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { listMyWorkflows, listDismissedWorkflows } from '@/lib/workflow-catalog';
import { getMyAgents } from '@/lib/agents-home';
import { categorizeAgent } from '@/lib/agent-category';
import AgentsList, { type ListAgent, type ArchivedAgent } from '../_components/agents-list';
import RunningAgents from '../_components/running-agents';
import ManageTips from '../_components/manage-tips';

export const dynamic = 'force-dynamic';

export default async function WorkflowsPage() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) redirect('/login');
  const { data: profile } = await supabase
    .from('users').select('id, organization_id')
    .eq('id', session.user.id).maybeSingle();
  if (!profile?.organization_id) redirect('/onboarding');

  const [feed, mine, dismissed] = await Promise.all([
    getMyAgents(),
    listMyWorkflows(),
    listDismissedWorkflows(),
  ]);
  const archived: ArchivedAgent[] = dismissed.map((d) => ({ slug: d.slug, name: d.name, source: d.source }));

  // slug -> library metadata (source + description for categorization).
  const meta = new Map(mine.map((w) => [w.slug, w]));
  const parts = (slug: string, name: string) => {
    const m = meta.get(slug);
    return [name, m?.description, m?.primary_outcome, m?.vertical];
  };
  const sourceFor = (slug: string) => meta.get(slug)?.source || 'generated';

  const list: ListAgent[] = [];
  const seen = new Set<string>();

  // From the activation feed: active (scheduled / on-demand) + mid-activation.
  for (const a of [...(feed?.active ?? []), ...(feed?.needsActivation ?? [])]) {
    if (seen.has(a.slug)) continue;
    seen.add(a.slug);
    const activated = a.state === 'active';
    const section: ListAgent['section'] = !activated
      ? 'not_activated'
      : a.mode === 'scheduled' ? 'scheduled' : 'on_demand';
    list.push({
      slug: a.slug,
      name: a.name,
      source: sourceFor(a.slug),
      section,
      category: categorizeAgent(parts(a.slug, a.name)),
      needsIntervention: a.needsIntervention,
      interventionReason: a.interventionReason,
      pendingQuestions: a.pendingQuestions,
      nextRunAt: a.nextRunAt,
      scheduleNl: a.scheduleNl,
      lastRun: a.lastRun,
      grade: a.grade,
    });
  }

  // Built but never activated (in the library, no activation row).
  for (const w of mine) {
    if (seen.has(w.slug)) continue;
    seen.add(w.slug);
    list.push({
      slug: w.slug,
      name: w.name,
      source: w.source,
      section: 'not_activated',
      category: categorizeAgent([w.name, w.description, w.primary_outcome, w.vertical]),
      lastRun: null,
    });
  }

  // Paused recurring agents — their clock is off so the active feed excludes them.
  // Query the user's own scheduled_skills directly (RLS-scoped) and add a collapsed
  // "Paused" section. On-demand agents have no clock to pause, so only cron ones.
  const { data: pausedRows } = await supabase
    .from('scheduled_skills')
    .select('skill_slug, status, trigger_type')
    .eq('status', 'paused')
    .eq('trigger_type', 'cron');
  for (const p of (pausedRows ?? [])) {
    if (!p.skill_slug || seen.has(p.skill_slug)) continue;
    seen.add(p.skill_slug);
    const m = meta.get(p.skill_slug);
    const name = m?.name || p.skill_slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
    list.push({
      slug: p.skill_slug,
      name,
      source: sourceFor(p.skill_slug),
      section: 'paused',
      category: categorizeAgent(parts(p.skill_slug, name)),
      lastRun: null,
    });
  }

  return (
    <main className="min-h-screen px-4 py-12">
      <div className="max-w-4xl mx-auto">
        <header className="mb-7 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-ink-50">Agents</h1>
            <p className="text-ink-300 text-sm mt-1">
              The workers you build. Each runs a whole job in your Claude or Codex, as you, and
              drops its work on <Link href="/overview" className="text-brand-500 hover:underline">Home</Link>.
            </p>
          </div>
          {/* The discovery entry point: describe a new agent OR pick a proven one
              from the community catalog. Without this, a new user with zero
              agents had no way INTO building/finding one from this page. */}
          <Link href="/create" className="flex-none btn-primary text-sm px-4 py-2 whitespace-nowrap">+ Create agent</Link>
        </header>

        {/* Quiet, dismissible tips on getting hands-off agents (keep Claude
            running, schedule browser agents, run from your phone). */}
        <ManageTips />

        {/* Live "Running" section — polls /scheduled-skills/live, renders the
            5-status pulsing-dot cards. Invisible when nothing is running. */}
        <RunningAgents />

        <AgentsList agents={list} archived={archived} />
      </div>
    </main>
  );
}
