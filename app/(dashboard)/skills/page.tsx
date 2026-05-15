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
import SkillsLibrary from './skills-library';
import AnnouncementsBanner from '@/components/announcements-banner';

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
  // Two-step query intentionally. The "trending globally" universal skills
  // section needs a different sort (by usage_count desc — popularity proxy)
  // than the org/system sections (which sort by recency). Could do this in
  // one query with custom sort logic in the client, but two queries with
  // explicit semantics is cleaner and Supabase handles the additional RTT
  // well (RLS evaluation happens once per request, not per row).

  // Pass 1 — own org skills + base Playbooks, sorted by recency.
  // Include organization_id so the client can determine which universal
  // skills belong to the user's own org (those show up in "Org-wide skills"
  // even if they're scope='universal' — the team has access to anything
  // anyone in the org has shared, regardless of public-or-team scope).
  const { data: skills } = await supabase
    .from('org_skills')
    .select('id, slug, name, description, scope, status, usage_count, trigger_phrases, outcome_stats, tags, created_by, organization_id, forked_from_skill_id')
    .in('status', ['active', 'draft'])
    .in('scope', ['org', 'private', 'system'])
    .order('created_at',   { ascending: false })
    .order('last_used_at', { ascending: false, nullsFirst: false })
    .limit(100);

  // Pass 2 — universal (public, cross-org, PII-scrubbed) skills. Sorted by
  // usage_count desc so the most-installed/most-used skills surface first.
  // This is the "Trending globally" section — the Founding Creator flywheel
  // visible to every user. Capped at 50 to keep the page tight.
  const { data: universalSkillsRaw } = await supabase
    .from('org_skills')
    .select('id, slug, name, description, scope, status, usage_count, trigger_phrases, outcome_stats, tags, created_by, organization_id, forked_from_skill_id')
    .in('status', ['active'])  // only active universals (no drafts in public listing)
    .eq('scope', 'universal')
    .order('usage_count', { ascending: false, nullsFirst: false })
    .order('created_at',  { ascending: false })
    .limit(50);

  const orgSkills       = (skills || []).filter((s) => s.scope === 'org' || s.scope === 'private');
  const systemSkills    = (skills || []).filter((s) => s.scope === 'system');
  const universalSkills = universalSkillsRaw || [];

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
      {/* Wider container (6xl = 72rem) gives the new 2-column layout
       * room — left filter sidebar (180px) + skill list content. Was
       * 5xl before. Still constrained on huge displays so reading
       * length stays comfortable. */}
      <div className="max-w-6xl mx-auto">
        <InstallToast installed={searchParams?.installed} />
        <WelcomeBanner welcome={searchParams?.welcome} forked={searchParams?.forked} />
        {/* Platform-wide announcements — controlled by the backend's
         * src/config/announcements.js. Update messaging by editing that
         * file and pushing — no dashboard deploy, no plugin reinstall.
         * Users dismiss individual announcements via the ✕ button
         * (state stored in localStorage). */}
        <AnnouncementsBanner />
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

        {/* Tabbed skills library — splits skills into 4 user-centric buckets
         * (your authored skills, your org-mates' org-shared, community
         * Trending Globally, Implexa base Playbooks). Each tab shows live
         * counts that reflect the active search + tag filter. Per-tab
         * descriptions explain what that bucket is + invite the right action
         * (fork, customize, run). See skills-library.tsx for the bucket logic. */}
        <SkillsLibrary
          orgSkills={orgSkills}
          systemSkills={systemSkills}
          universalSkills={universalSkills}
          currentUserId={profile.id}
          currentOrgId={profile.organization_id}
        />
      </div>
    </main>
  );
}
