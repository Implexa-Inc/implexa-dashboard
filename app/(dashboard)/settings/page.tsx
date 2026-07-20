/**
 * /settings — hub page that links into each settings sub-section.
 *
 * 2026-07-01 simplification (Codex's design audit): 9 flat equal tiles read as
 * an IT admin panel. Grouped into 4 sections the user actually thinks in —
 * Account, AI engines, Accounts agents can use, Privacy & data. Same routes,
 * same tiles; only the grouping + a couple of plainer titles changed.
 *
 * Subroutes today:
 *   /settings/billing    — plan, seats, capture quota, Stripe portal
 *   /settings/api-keys   — generate / revoke imp_live_... API keys (shown as
 *                          "Devices & installs" — this audience reads "API keys"
 *                          as a developer feature, not the device list it is)
 *
 * Add new tiles into the right group as they ship.
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

        <SettingsGroup title="Account">
          <SettingsCard
            href="/settings/account"
            icon="👤"
            title="Account"
            description="Display name, change email, account deletion."
          />
          <SettingsCard
            href="/settings/billing"
            icon="💎"
            title="Billing & plan"
            description="Current plan, seats, Stripe portal."
          />
          <SettingsCard
            href="/settings/team"
            icon="👥"
            title="Team"
            description="Invite teammates to share your agents (Pro). View members, manage invites."
          />
        </SettingsGroup>

        <SettingsGroup title="AI engines">
          <SettingsCard
            href="/settings/engines"
            icon="⚡"
            title="Claude & Codex"
            description="Connect, test, and compare Claude and Codex independently."
          />
          <SettingsCard
            href="/settings/api-keys"
            icon="🔑"
            title="Devices & installs"
            description="See every device/session connected to your Implexa account — revoke any you don't recognize."
          />
          <SettingsCard
            href="/settings/local-vault"
            icon="🔐"
            title="Local key vault"
            description="Provider API keys (Runway, ElevenLabs, …) encrypted on your Mac — see what's saved and exactly which agents may use each."
          />
          <SettingsCard
            href="/settings/run-environment"
            icon="🖥️"
            title="Run environment"
            description="The workspace folder + browser profile an on-demand run uses on this machine, so agents you fire from your phone come up equipped."
          />
          <SettingsCard
            href="/settings/updates"
            icon="⬆️"
            title="Updates"
            description="Latest plugin + desktop versions and a one-click update command. Keep Implexa current for new workflows and fixes."
          />
        </SettingsGroup>

        <SettingsGroup title="Accounts agents can use">
          <SettingsCard
            href="/settings/connections"
            icon="🔗"
            title="Your accounts"
            description="Every account your agents drive in the Implexa browser, whether it's reachable, and which agents need what."
          />
        </SettingsGroup>

        <SettingsGroup title="Privacy & data">
          <SettingsCard
            href="/settings/data"
            icon="🧠"
            title="Data & privacy"
            description="What Implexa stores about you, recommendation opt-ins, and the delete-all-my-data button. Your agents run on your machine; this is the little we keep."
          />
        </SettingsGroup>

      </div>
    </main>
  );
}

function SettingsGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-8">
      <h2 className="text-[11px] uppercase tracking-wider text-ink-500 font-medium mb-3">{title}</h2>
      <div className="grid sm:grid-cols-2 gap-4">{children}</div>
    </div>
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
