import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import MachineSetupClient from './machine-setup-client';

/**
 * /settings/machine-setup/[slug][/machine/:id][/version/:id] — "Open setup in Implexa" lands
 * here (backend 0346). The page reads the agent's customer-safe requirement
 * list and THE SELECTED computer's current state from the backend, and offers
 * the explicit actions: install (vendor instructions / the Desktop tool
 * registry), sign in (the vendor's own flow), free disk, Recheck. Nothing is
 * installed or captured silently; the backend decides.
 *
 * The machine segment is the one the Setup-required card was raised for. Without
 * it, the page asks the Desktop bridge which computer it is (in-app) and falls
 * back to the backend's default selection on plain web.
 */
export default async function MachineSetupPage({ slug, machineId = null, workflowVersionId = null }: { slug: string; machineId?: string | null; workflowVersionId?: string | null }) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) redirect('/login');
  return (
    <main className="min-h-screen px-4 py-12">
      <div className="max-w-3xl mx-auto">
        <Link href={`/workflows/${encodeURIComponent(slug)}`} className="text-xs text-brand-500 hover:underline">← Back to the agent</Link>
        <header className="mt-2 mb-6">
          <h1 className="text-3xl font-semibold tracking-tight text-ink-50">Set up this computer</h1>
          <p className="text-sm text-ink-300 mt-1 max-w-2xl leading-relaxed">
            Each requirement below is checked on the selected computer, in the exact environment the agent runs in. Install or sign in yourself, then Recheck.
          </p>
        </header>
        <MachineSetupClient slug={slug} machineId={machineId} workflowVersionId={workflowVersionId} />
      </div>
    </main>
  );
}
