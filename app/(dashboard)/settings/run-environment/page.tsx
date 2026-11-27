import PageHeader from '@/components/page-header';
/**
 * /settings/run-environment — Run From Anywhere (Phase 2, S2).
 *
 * Where you tell Implexa how to equip an on-demand run on this machine: the
 * workspace folder to cd into for agents that touch local files, and which
 * browser profile holds your logged-in accounts. run_agent_now reads this to
 * preflight a run (so it comes up equipped instead of discovering a missing
 * path/account mid-run). Per-user + private — never touches the shared agent.
 */

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { readUserProfile } from '@/lib/profile-read';
import { callBackend } from '@/lib/api';
import RunEnvForm from './run-env-form';
import ConnectTelegram from './connect-telegram';
import AgentCommandApproval from './agent-command-approval';

export const dynamic = 'force-dynamic';

export default async function RunEnvironmentPage() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) redirect('/login');

  const profile = await readUserProfile(supabase
    .from('users').select('id, organization_id').eq('id', session.user.id));
  if (!profile?.organization_id) redirect('/onboarding');

  // Current run-env (default machine). Degrades to empty on any error so the
  // page always renders (the column/table may not be migrated yet).
  let current: { workspace_root?: string | null; chrome_profile?: string | null } = {};
  const approval = callBackend('/api/v2/me/agent-command-approval', { jwt: session.access_token })
    .then(result => result?.ok === true && typeof result.granted === 'boolean' ? result.granted : null)
    .catch(() => null);
  try {
    const res = await callBackend('/api/v2/me/run-env', { jwt: session.access_token });
    const def = (res?.machines || []).find((m: { machine_label?: string }) => m.machine_label === 'default') || (res?.machines || [])[0];
    if (def) current = def;
  } catch { /* none set yet */ }
  const commandApproval = await approval;

  return (
    <section className="settings-page">
      <div className="settings-page-content">

        <PageHeader title="Run environment">
          <p className="text-reading app-page-description">
            Where on-demand runs happen on this machine: the folder to work in and the browser that
            holds your logins. Private to you; never changes the shared agent.
          </p>
        </PageHeader>

        <AgentCommandApproval key={session.user.id} initialGranted={commandApproval} accountId={session.user.id} />

        <div className="mb-6 rounded-lg border border-emerald-500/30 bg-emerald-500/[0.06] p-4 text-secondary">
          <div className="font-medium text-ink-50 mb-1">You usually don&apos;t need to fill this in.</div>
          <p className="text-reading text-ink-300 leading-relaxed">
            The first time you run an agent from Claude or Codex, it captures the folder it ran in (and the browser
            it used) automatically. These fields are just to <strong>view or override</strong> what was
            captured — handy if you run agents in more than one place. Easiest setup: just run an agent
            once and come back here to confirm.
          </p>
        </div>

        <RunEnvForm
          currentWorkspaceRoot={current.workspace_root || ''}
          currentChromeProfile={current.chrome_profile || ''}
        />

        <div className="mt-6">
          <ConnectTelegram />
        </div>
      </div>
    </section>
  );
}

export const metadata = {
  title: 'Run environment — Tukido',
};
