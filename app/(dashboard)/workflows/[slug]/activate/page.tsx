/**
 * /workflows/[slug]/activate — the guided activation screen for one agent.
 * The whole screen IS the checklist (ACTIVATION_JOURNEY.md): no competing
 * dashboard chrome, one next-action at a time. Lands here from the build alert
 * ("Activate on Implexa →") or from the "Needs activation" group.
 */

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { getActivationChecklist } from '@/lib/activation';
import { ActivationCard } from '../../../_components/activation-card';
import { OpenInAppBanner } from '../../../_components/open-in-app-banner';

export const dynamic = 'force-dynamic';

export default async function ActivateAgentPage({ params }: { params: { slug: string } }) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) redirect('/login');

  const checklist = await getActivationChecklist(params.slug);

  return (
    <main className="min-h-screen px-6 lg:px-12 py-12">
      <div className="max-w-2xl mx-auto">
        <Link href="/workflows" className="inline-flex items-center gap-2 text-sm text-ink-500 hover:text-ink-200 mb-8">
          <span aria-hidden>&larr;</span> Agents
        </Link>

        {!checklist ? (
          <div className="card max-w-2xl">
            <h1 className="text-base font-semibold text-ink-50">Can’t load this agent yet</h1>
            <p className="text-sm text-ink-400 mt-2 leading-relaxed">
              We couldn’t read this agent’s activation steps. It may not be in your library, or the
              service is briefly unavailable. Head back to your agents and try again.
            </p>
            <Link href="/workflows" className="inline-flex items-center mt-4 text-sm font-medium rounded-md px-3.5 py-2 bg-brand-500/15 text-brand-600 dark:text-brand-400 hover:bg-brand-500/25 transition-colors">
              Back to agents
            </Link>
          </div>
        ) : (
          <>
            <OpenInAppBanner path={`/workflows/${params.slug}/activate`} verb="activate" />
            <p className="text-xs uppercase tracking-wider text-ink-500 mb-3">Switch on</p>
            <ActivationCard checklist={checklist} />
          </>
        )}
      </div>
    </main>
  );
}
