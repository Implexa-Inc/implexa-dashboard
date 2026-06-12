/**
 * /inbox , the Results feed (the rendered work your agents produced).
 *
 * Where the autopilot loop surfaces its output. Agents that run on a schedule
 * produce deliverables (HN comment drafts, IG reel briefs, realtor packs);
 * Results renders each one beautifully (markdown) newest-first, so you see the
 * actual work, not a log of slugs.
 *
 * READ is a direct RLS query on skill_runs that have an output_markdown
 * deliverable, newest first (a bounded recent window). Items still awaiting
 * review (review_status = 'pending', migration 0057) keep an Approve/Dismiss
 * action; everything else just renders as a reviewed result. We enrich each row
 * with the producing agent's name + a one-line "why" from the public catalog
 * (lib/workflow-catalog, the same MCP read path the agents pages use) so we
 * never show a bare slug. ACTION (approve/dismiss) is a JWT-authed POST to the
 * backend, done client-side in inbox-list.tsx where the Supabase session lives.
 */

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { loadInboxItems } from '@/lib/inbox';
import { RunAttentionBanner, type AttentionItem } from '../_components/run-attention-banner';
import InboxList from './inbox-list';

export const dynamic = 'force-dynamic';

export default async function InboxPage() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) redirect('/login');

  const { data: profile } = await supabase
    .from('users').select('id, organization_id')
    .eq('id', session.user.id).maybeSingle();
  if (!profile?.organization_id) redirect('/onboarding');

  // The same todo list Home renders, from the one shared loader.
  const items = await loadInboxItems(supabase, 40);

  // The loud surface: any result that did not finish cleanly (stalled, or a
  // permission-blocked failure) gets a banner at the top of Results too, so a
  // stuck run is impossible to miss from either entry point.
  const attentionItems: AttentionItem[] = items.map((it) => ({
    id: it.id, name: it.name, info: it.state, ran_at: it.ran_at,
  }));

  return (
    <main className="min-h-screen px-6 lg:px-12 py-14">
      <div className="max-w-3xl mx-auto">
        <header className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight text-ink-50">Results</h1>
          <p className="text-ink-300 text-sm mt-1">
            The work your agents produced, newest first. Approve anything held for your
            review; the rest is here whenever you want to look back.
          </p>
        </header>

        <RunAttentionBanner items={attentionItems} />

        {items.length === 0 ? (
          <section className="card text-center py-12">
            <div className="text-2xl mb-2" aria-hidden="true">✓</div>
            <p className="text-ink-100 font-medium">No results yet.</p>
            <p className="text-ink-400 text-sm mt-1">
              When your agents run, the work they produce shows up here.{' '}
              <Link href="/workflows" className="text-brand-500 hover:underline">Build an agent</Link>.
            </p>
          </section>
        ) : (
          <InboxList initialItems={items} />
        )}
      </div>
    </main>
  );
}
