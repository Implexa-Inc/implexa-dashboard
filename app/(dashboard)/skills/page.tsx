/**
 * Post-login landing — skill library.
 *
 * Two states:
 *  - First-time (no API key + no skills): show install + getting-started flow
 *  - Returning (has skills): show the library
 */

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import InstallToast from './install-toast';
import WelcomeBanner from './welcome-banner';
import FoundingCreatorBanner from './founding-creator-banner';
import RunInClaudeButton from './run-in-claude-button';

export const dynamic = 'force-dynamic';

const SYSTEM_ORG_ID = '00000000-0000-0000-0000-000000000000';

type SkillsSearchParams = { installed?: string; welcome?: string; forked?: string };

export default async function SkillsPage({ searchParams }: { searchParams?: SkillsSearchParams }) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) redirect('/login');

  const { data: profile } = await supabase
    .from('users').select('id, organization_id, display_name, email')
    .eq('id', session.user.id).maybeSingle();
  if (!profile?.organization_id) redirect('/onboarding');

  // Org skills + system Playbooks. RLS gates org_id scope.
  //
  // Sort by created_at desc as the PRIMARY signal — "I just made this, where
  // is it?" — most users' mental model. Brand-new skills land at the top
  // (vs. the old `.order('last_used_at')` which buried never-used skills at
  // the bottom because last_used_at was NULL). Secondary sort by last_used_at
  // tightens ordering between equally-recent creations.
  const { data: skills } = await supabase
    .from('org_skills')
    .select('id, slug, name, description, scope, status, usage_count, trigger_phrases, outcome_stats')
    .in('status', ['active', 'draft'])
    .order('created_at',   { ascending: false })
    .order('last_used_at', { ascending: false, nullsFirst: false })
    .limit(100);

  const orgSkills    = (skills || []).filter((s) => s.scope === 'org' || s.scope === 'private');
  const systemSkills = (skills || []).filter((s) => s.scope === 'system');

  // Has the user generated an API key yet? Used to gate the install banner.
  const { data: keys } = await supabase
    .from('api_keys')
    .select('id', { count: 'exact', head: false })
    .eq('user_id', profile.id)
    .eq('status', 'active');
  const hasApiKey = (keys?.length || 0) > 0;
  const isFirstTime = orgSkills.length === 0 && !hasApiKey;

  return (
    <main className="min-h-screen px-4 py-12">
      <div className="max-w-5xl mx-auto">
        <InstallToast installed={searchParams?.installed} />
        <WelcomeBanner welcome={searchParams?.welcome} forked={searchParams?.forked} />
        <FoundingCreatorBanner userId={profile.id} />

        <header className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight text-ink-50">
            {profile.display_name ? `Welcome, ${profile.display_name.split(' ')[0]}` : 'Your skills'}
          </h1>
          <p className="text-ink-300 text-sm mt-1">
            Your library. Fork, run, capture, share — every skill runs in your Claude.
          </p>
        </header>

        {/* First-time install guide */}
        {isFirstTime && (
          <section className="card !bg-brand-50 !border-brand-500/30 mb-8">
            <div className="flex items-start gap-4">
              <div className="text-2xl">⚡</div>
              <div className="flex-1">
                <h2 className="text-lg font-medium mb-1">Get started in 30 seconds</h2>
                <p className="text-sm text-ink-200 mb-4">
                  You're set up on the web. Next: connect Claude to Implexa so your skills are usable in Claude Code, Claude Desktop, or Claude.ai web. Three options — pick the easiest.
                </p>

                <div className="flex flex-wrap gap-3 items-center">
                  <Link href="/install" className="btn-primary">Connect Claude →</Link>
                  <Link href="/settings/api-keys" className="text-sm text-brand-600 hover:underline">Or generate an API key first →</Link>
                </div>

                <div className="mt-4 text-xs text-ink-500">
                  Or browse the {systemSkills.length} base Playbooks below and fork one.
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Your org's skills */}
        <section className="mb-10">
          <h2 className="text-lg font-medium mb-3 flex items-baseline gap-2">
            Your org's skills
            <span className="text-xs text-ink-500 font-normal">({orgSkills.length})</span>
          </h2>
          {orgSkills.length === 0 ? (
            <div className="card text-sm text-ink-500">
              {hasApiKey
                ? <>No skills saved yet. In Claude Code, run <code className="font-mono bg-ink-800 px-1.5 py-0.5 rounded text-ink-100">/implexa:record-skill</code> to capture your first workflow.</>
                : <>Generate an API key and install the plugin to start recording skills.</>}
            </div>
          ) : (
            <ul className="space-y-2">{orgSkills.map(s => <SkillRow key={s.id} skill={s} />)}</ul>
          )}
        </section>

        {/* Base Playbooks */}
        <section>
          <h2 className="text-lg font-medium mb-3 flex items-baseline gap-2">
            Base Playbooks
            <span className="text-xs text-ink-500 font-normal">({systemSkills.length}) — horizontal library, fork & customize</span>
          </h2>
          {systemSkills.length === 0 ? (
            <div className="card text-sm text-ink-500">
              Playbooks not yet seeded. Run migration 0006 in Supabase Studio.
            </div>
          ) : (
            <ul className="space-y-2">{systemSkills.map(s => <SkillRow key={s.id} skill={s} />)}</ul>
          )}
        </section>
      </div>
    </main>
  );
}

function SkillRow({ skill }: { skill: any }) {
  const stats = skill.outcome_stats || {};
  return (
    <li>
      <Link href={`/skills/${skill.slug}`} className="card flex items-center gap-4 py-4 hover:shadow-glow hover:border-brand-500/60 transition-all cursor-pointer">
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <div className="font-medium text-ink-50">{skill.name}</div>
            {skill.status === 'draft' && <span className="text-xs px-1.5 py-0.5 rounded bg-accent-400/20 text-accent-400">draft</span>}
            <code className="text-xs text-ink-400 font-mono">{skill.slug}</code>
          </div>
          <div className="text-sm text-ink-300 mt-1 line-clamp-2">{skill.description}</div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="text-xs whitespace-nowrap text-right">
            {skill.usage_count > 0 && <div className="text-ink-300">{skill.usage_count} run{skill.usage_count === 1 ? '' : 's'}</div>}
            {stats.attributedOutcomes > 0 && <div className="text-success-400 font-semibold mt-0.5">{stats.attributedOutcomes} outcome{stats.attributedOutcomes === 1 ? '' : 's'}</div>}
          </div>
          <RunInClaudeButton
            skillSlug={skill.slug}
            triggerPhrases={skill.trigger_phrases}
            skillName={skill.name}
          />
        </div>
      </Link>
    </li>
  );
}
