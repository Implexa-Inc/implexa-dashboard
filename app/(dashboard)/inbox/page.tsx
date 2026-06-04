/**
 * /inbox , the approval inbox ("Needs you").
 *
 * Where the autopilot loop ends. Workflows that run on a schedule produce
 * deliverables held for the user's review (HN comment drafts, IG reel briefs,
 * realtor packs). Instead of scattering across email + /runs + the agent log,
 * everything that needs the user lands here.
 *
 * READ is a direct RLS query on skill_runs WHERE review_status = 'pending'
 * (migration 0057), newest first. We enrich each row with the producing
 * workflow's name + a one-line "why" from the public workflow catalog
 * (lib/workflow-catalog, the same MCP read path /workflows and /runs use) so we
 * never show a bare slug. ACTION (approve/dismiss) is a JWT-authed POST to the
 * backend, done client-side in inbox-list.tsx where the Supabase session lives.
 */

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { listWorkflows } from '@/lib/workflow-catalog';
import InboxList, { type InboxItem } from './inbox-list';

export const dynamic = 'force-dynamic';

type PendingRun = {
  id:              string;
  skill_slug:      string;
  source:          string;
  output_markdown: string | null;
  ran_at:          string;
  review_status:   string;
};

// Tighten a workflow description into a single plain-english line. Catalog
// descriptions can be a few sentences; the inbox only needs the lead clause.
function oneLine(text: string | null | undefined): string | null {
  if (!text) return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  const firstSentence = trimmed.split(/(?<=[.!?])\s+/)[0] || trimmed;
  const clipped = firstSentence.length > 160
    ? `${firstSentence.slice(0, 157).trimEnd()}…`
    : firstSentence;
  return clipped;
}

// Humanize a slug as a last-resort name so we never render a bare slug alone.
function humanize(slug: string): string {
  return slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export default async function InboxPage() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) redirect('/login');

  const { data: profile } = await supabase
    .from('users').select('id, organization_id')
    .eq('id', session.user.id).maybeSingle();
  if (!profile?.organization_id) redirect('/onboarding');

  // RLS-scoped to the caller. Catalog read degrades to [] on failure, so a
  // missing public token just means we fall back to humanized slugs.
  const [{ data: runs }, catalog] = await Promise.all([
    supabase
      .from('skill_runs')
      .select('id, skill_slug, source, output_markdown, ran_at, review_status')
      .eq('review_status', 'pending')
      .order('ran_at', { ascending: false }),
    listWorkflows(),
  ]);

  const bySlug = new Map(catalog.map((c) => [c.slug, c]));

  const items: InboxItem[] = ((runs as PendingRun[]) || []).map((r) => {
    const wf = bySlug.get(r.skill_slug);
    return {
      id:              r.id,
      slug:            r.skill_slug,
      source:          r.source,
      name:            wf?.name || humanize(r.skill_slug),
      why:             oneLine(wf?.primary_outcome) || oneLine(wf?.description),
      output_markdown: r.output_markdown,
      ran_at:          r.ran_at,
    };
  });

  return (
    <main className="min-h-screen px-4 py-12">
      <div className="max-w-3xl mx-auto">
        <header className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight text-ink-50">Needs you</h1>
          <p className="text-ink-300 text-sm mt-1">
            Deliverables your routines produced and held for your review. Approve what you
            shipped, dismiss the rest.
          </p>
        </header>

        {items.length === 0 ? (
          <section className="card text-center py-12">
            <div className="text-2xl mb-2" aria-hidden="true">✓</div>
            <p className="text-ink-100 font-medium">You are all caught up.</p>
            <p className="text-ink-400 text-sm mt-1">
              Routines that need your approval will show up here.{' '}
              <Link href="/runs" className="text-brand-500 hover:underline">See all runs</Link>.
            </p>
          </section>
        ) : (
          <InboxList initialItems={items} />
        )}
      </div>
    </main>
  );
}
