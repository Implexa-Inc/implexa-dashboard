import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import MachineSetupClient from './machine-setup-client';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Machine setup — Implexa' };

/**
 * /settings/machine-setup/[slug] — "Open setup in Implexa" lands here (backend
 * 0346). The page reads the agent's customer-safe requirement list and the
 * selected computer's current state from the backend, and offers the explicit
 * actions: install (vendor instructions), sign in (the vendor's own flow),
 * Recheck. Nothing is installed or captured silently; the backend decides.
 */
export default async function MachineSetupPage({ params }: { params: { slug: string } }) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) redirect('/login');
  return (
    <main className="min-h-screen px-4 py-12">
      <div className="max-w-3xl mx-auto">
        <Link href={`/workflows/${encodeURIComponent(params.slug)}`} className="text-xs text-brand-500 hover:underline">← Back to the agent</Link>
        <header className="mt-2 mb-6">
          <h1 className="text-3xl font-semibold tracking-tight text-ink-50">Set up this computer</h1>
          <p className="text-sm text-ink-300 mt-1 max-w-2xl leading-relaxed">
            Each requirement below is checked on the selected computer, in the exact environment the agent runs in. Install or sign in yourself, then Recheck.
          </p>
        </header>
        <MachineSetupClient slug={params.slug} />
      </div>
    </main>
  );
}
