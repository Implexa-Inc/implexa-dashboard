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
import { listMyWorkflows } from '@/lib/workflow-catalog';
import { getMyAgents } from '@/lib/agents-home';
import { categorizeAgent } from '@/lib/agent-category';
import AgentsList, { type ListAgent } from '../_components/agents-list';

export const dynamic = 'force-dynamic';

export default async function WorkflowsPage() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) redirect('/login');
  const { data: profile } = await supabase
    .from('users').select('id, organization_id')
    .eq('id', session.user.id).maybeSingle();
  if (!profile?.organization_id) redirect('/onboarding');

  const [feed, mine] = await Promise.all([
    getMyAgents(),
    listMyWorkflows(),
  ]);

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

  return (
    <main className="min-h-screen px-4 py-12">
      <div className="max-w-4xl mx-auto">
        <header className="mb-7">
          <h1 className="text-3xl font-semibold tracking-tight text-ink-50">Agents</h1>
          <p className="text-ink-300 text-sm mt-1">
            The workers you build. Each runs a whole job in your Claude or Codex, as you, and
            drops its work in <Link href="/inbox" className="text-brand-500 hover:underline">Results</Link>.
            Build a new one on <Link href="/overview" className="text-brand-500 hover:underline">Home</Link>.
          </p>
        </header>

        <AgentsList agents={list} />
      </div>
    </main>
  );
}
