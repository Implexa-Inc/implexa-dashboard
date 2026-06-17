/**
 * /settings/run-environment — Run From Anywhere (Phase 2, S2).
 *
 * Where you tell Implexa how to equip an on-demand run on this machine: the
 * workspace folder to cd into for agents that touch local files, and which
 * browser profile holds your logged-in accounts. run_agent_now reads this to
 * preflight a run (so it comes up equipped instead of discovering a missing
 * path/account mid-run). Per-user + private — never touches the shared agent.
 */

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { callBackend } from '@/lib/api';
import RunEnvForm from './run-env-form';

export const dynamic = 'force-dynamic';

export default async function RunEnvironmentPage() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) redirect('/login');

  const { data: profile } = await supabase
    .from('users').select('id, organization_id').eq('id', session.user.id).maybeSingle();
  if (!profile?.organization_id) redirect('/onboarding');

  // Current run-env (default machine). Degrades to empty on any error so the
  // page always renders (the column/table may not be migrated yet).
  let current: { workspace_root?: string | null; chrome_profile?: string | null } = {};
  try {
    const res = await callBackend('/api/v2/me/run-env', { jwt: session.access_token });
    const def = (res?.machines || []).find((m: { machine_label?: string }) => m.machine_label === 'default') || (res?.machines || [])[0];
    if (def) current = def;
  } catch { /* none set yet */ }

  return (
    <main className="min-h-screen px-4 py-12">
      <div className="max-w-2xl mx-auto">
        <nav className="text-xs text-ink-500 mb-4">
          <Link href="/settings" className="hover:underline">← Settings</Link>
        </nav>

        <header className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight text-ink-50">Run environment</h1>
          <p className="text-sm text-ink-300 mt-1 leading-relaxed">
            How an on-demand run comes up equipped on this machine. When you fire an agent (from
            Claude, your phone, or — soon — Telegram), Implexa uses this to put the run in the right
            folder with the right logged-in browser, instead of stopping mid-run to ask. Private to you;
            it never changes the shared agent.
          </p>
        </header>

        <RunEnvForm
          currentWorkspaceRoot={current.workspace_root || ''}
          currentChromeProfile={current.chrome_profile || ''}
        />
      </div>
    </main>
  );
}

export const metadata = {
  title: 'Run environment — Implexa',
};
