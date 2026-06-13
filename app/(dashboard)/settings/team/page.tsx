/**
 * /settings/team — basic team management.
 *
 * v0 scope:
 *   - List org members
 *   - Invite by email (generates a copy-able signup URL with ?invite=TOKEN)
 *   - Show pending invites
 *   - Revoke pending invites
 *
 * No email sending yet — the dashboard surfaces the invite URL for the
 * inviter to share manually via Slack/email/DM.
 */

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { callBackend } from '@/lib/api';
import InviteForm from './invite-form';
import PendingInviteRow from './pending-invite-row';

export const dynamic = 'force-dynamic';

export default async function TeamSettingsPage() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) redirect('/login');

  // Pull members + pending invites in parallel via the backend
  let members: any[] = [];
  let invites: any[] = [];
  try {
    const [m, i] = await Promise.all([
      callBackend('/api/v2/team/members', { jwt: session.access_token }),
      callBackend('/api/v2/team/invites', { jwt: session.access_token }),
    ]);
    members = m.members || [];
    invites = i.invites || [];
  } catch (_) { /* show empty state */ }

  // Pull org plan + org-skill share count (for the 3-skill cap UX)
  const { data: profile } = await supabase
    .from('users').select('organization_id').eq('id', session.user.id).maybeSingle();
  let plan = 'free';
  if (profile?.organization_id) {
    const { data: org } = await supabase
      .from('organizations').select('plan').eq('id', profile.organization_id).maybeSingle();
    plan = org?.plan || 'free';
  }

  return (
    <main className="min-h-screen px-4 py-12">
      <div className="max-w-3xl mx-auto">
        <nav className="text-xs text-ink-500 mb-4">
          <Link href="/settings" className="hover:underline">← Settings</Link>
        </nav>

        <header className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight text-ink-50">Team</h1>
          <p className="text-ink-300 text-sm mt-1">
            Invite teammates so the whole team can run your shared agents. Everyone&apos;s runs and results land in one place; each person&apos;s own runs stay private.
          </p>
        </header>

        {/* Plan strip — members + invites, with a Team-plan note on Free. */}
        <div className="card mb-6 !border-brand-500/40">
          <div className="flex items-start gap-3">
            <div className="text-xl shrink-0" aria-hidden="true">👥</div>
            <div className="flex-1">
              <div className="text-sm font-medium text-ink-50 capitalize">{plan} plan</div>
              <div className="text-xs text-ink-300 mt-0.5">
                {members.length} member{members.length === 1 ? '' : 's'} · {invites.length} pending invite{invites.length === 1 ? '' : 's'}
              </div>
              {plan === 'free' && (
                <div className="mt-2 text-xs text-ink-400 leading-relaxed">
                  A shared agent library across a workspace is a Team-plan feature.{' '}
                  <Link href="/pricing" className="text-brand-500 hover:underline font-medium">See plans →</Link>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Invite form */}
        <section className="mb-10">
          <h2 className="text-base font-medium text-ink-50 mb-3">Invite a teammate</h2>
          <InviteForm jwt={session.access_token} />
        </section>

        {/* Pending invites */}
        {invites.length > 0 && (
          <section className="mb-10">
            <h2 className="text-base font-medium text-ink-50 mb-3">Pending invites <span className="text-ink-400 font-normal text-sm">({invites.length})</span></h2>
            <div className="space-y-2">
              {invites.map((inv) => (
                <PendingInviteRow key={inv.id} invite={inv} jwt={session.access_token} />
              ))}
            </div>
          </section>
        )}

        {/* Members */}
        <section>
          <h2 className="text-base font-medium text-ink-50 mb-3">Members <span className="text-ink-400 font-normal text-sm">({members.length})</span></h2>
          <div className="space-y-2">
            {members.map((m) => (
              <div key={m.id} className="card !p-3 flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-ink-50 truncate">
                    {m.displayName || m.email.split('@')[0]}
                    {m.id === session.user.id && <span className="ml-2 text-[10px] uppercase tracking-wider text-ink-400">you</span>}
                    {m.isFoundingCreator && <span className="ml-2 text-[10px] uppercase tracking-wider font-bold rounded px-1.5 py-0.5 bg-success-400/20 text-success-700 dark:text-success-400">🏆 Founding Creator</span>}
                  </div>
                  <div className="text-xs text-ink-400 truncate">{m.email}</div>
                </div>
                <div className="text-[11px] text-ink-400 whitespace-nowrap">
                  Joined {new Date(m.joinedAt).toLocaleDateString()}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

export const metadata = {
  title: 'Team — Implexa',
};
