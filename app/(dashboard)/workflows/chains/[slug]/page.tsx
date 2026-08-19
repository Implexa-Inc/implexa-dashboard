import { redirect, notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getChainOffering } from '@/lib/agent-chain-offerings';
import ChainOfferingResume from '../../../_components/chain-offering-resume';

export const dynamic = 'force-dynamic';

/**
 * The chain offering resume. `chains` is a static segment, so it wins over the
 * dynamic /workflows/[slug] agent route and a chain slug can never be read as
 * an agent slug.
 *
 * `not_available` renders notFound() ON PURPOSE: a private-preview offering
 * must be indistinguishable from nonexistence for anyone the publisher has not
 * explicitly granted — an "access denied" page would itself be a disclosure.
 */
export default async function ChainOfferingPage({ params }: { params: { slug: string } }) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) redirect('/login');
  const result = await getChainOffering(params.slug, session.access_token);
  if (result.status === 'not_available') notFound();
  if (result.status === 'unavailable') {
    return (
      <main className="min-h-screen px-4 py-10">
        <div className="mx-auto max-w-4xl rounded-md border border-amber-500/30 bg-amber-500/10 p-4">
          <h1 className="text-lg font-semibold text-ink-50">Chain unavailable</h1>
          <p role="alert" className="mt-2 text-sm text-amber-200">
            {result.reason} Nothing about this chain could be verified, so acquiring and running are disabled.
          </p>
        </div>
      </main>
    );
  }
  return <ChainOfferingResume offering={result.offering} />;
}
