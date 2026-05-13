/**
 * /settings — hub page that links into each settings sub-section.
 *
 * Subroutes today:
 *   /settings/billing    — plan, seats, capture quota, Stripe portal
 *   /settings/api-keys   — generate / revoke imp_live_... API keys
 *
 * Add new tiles here as they ship (org members, integrations creds, etc.)
 */

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function SettingsHubPage() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) redirect('/login');

  const { data: profile } = await supabase
    .from('users').select('id, organization_id, display_name, email, founding_creator_unlocked_at')
    .eq('id', session.user.id).maybeSingle();
  if (!profile?.organization_id) redirect('/onboarding');

  // Light context shown on the hub
  const { data: org } = await supabase
    .from('organizations').select('name, plan')
    .eq('id', profile.organization_id).maybeSingle();
  const plan = org?.plan || 'free';
  const isFoundingCreator = !!profile.founding_creator_unlocked_at;

  return (
    <main className="min-h-screen px-4 py-12">
      <div className="max-w-3xl mx-auto">
        <header className="mb-10">
          <h1 className="text-3xl font-semibold tracking-tight text-ink-50">Settings</h1>
          <p className="text-ink-300 text-sm mt-1">
            {profile.display_name ? `${profile.display_name} · ` : ''}{profile.email}
            {org?.name ? ` · ${org.name}` : ''}
            {' · '}<span className="capitalize">{plan}</span> plan
            {isFoundingCreator && <span className="ml-2 text-[10px] uppercase tracking-wider font-bold rounded px-1.5 py-0.5 bg-success-400/20 text-success-700 dark:text-success-400">🏆 Founding Creator</span>}
          </p>
        </header>

        <div className="grid sm:grid-cols-2 gap-4">
          <SettingsCard
            href="/settings/billing"
            icon="💎"
            title="Billing & plan"
            description="Current plan, seats, capture quota, Stripe portal."
          />
          <SettingsCard
            href="/settings/team"
            icon="👥"
            title="Team"
            description="Invite teammates, view members, manage pending invites."
          />
          <SettingsCard
            href="/settings/api-keys"
            icon="🔑"
            title="API keys"
            description="Generate and revoke imp_live_ keys for MCP installs."
          />
          <SettingsCard
            href="/integrations"
            icon="🔌"
            title="Integrations"
            description="Connect Fiber, Coresignal, Apollo, and more."
          />
          <SettingsCard
            href="/install"
            icon="⚡"
            title="Connect Claude"
            description="Install the Implexa plugin in Claude Code / Desktop / Cursor / Cowork."
          />
        </div>

      </div>
    </main>
  );
}

function SettingsCard({ href, icon, title, description }: { href: string; icon: string; title: string; description: string }) {
  return (
    <Link
      href={href}
      className="card hover:border-brand-500/40 hover:shadow-glow transition-all"
    >
      <div className="flex items-start gap-3">
        <div className="text-2xl shrink-0" aria-hidden="true">{icon}</div>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-ink-50 mb-1">{title}</div>
          <div className="text-xs text-ink-300 leading-relaxed">{description}</div>
        </div>
        <div className="text-ink-500 shrink-0 self-center">→</div>
      </div>
    </Link>
  );
}

export const metadata = {
  title: 'Settings — Implexa',
};
