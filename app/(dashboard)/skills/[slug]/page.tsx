/**
 * Skill detail at /skills/[slug].
 * Renders the SKILL.md content, structured fields, share + activate buttons.
 */

import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { createClient } from '@/lib/supabase/server';
import SkillActions from './actions';
import { InstallStatusBadge, ForkToCustomizeButton } from './install-controls';
import { CreatorBadge } from '@/components/creator-badge';
import { ShareButtons } from '@/components/share-buttons';
import { StarButton }   from '@/components/star-button';
import { DownloadSkillButton } from '@/components/download-skill-button';
import { RecommendationsRail } from './recommendations-rail';

import 'highlight.js/styles/github-dark.css';

export const dynamic = 'force-dynamic';

const SYSTEM_ORG_ID = '00000000-0000-0000-0000-000000000000';

export default async function SkillDetailPage({ params }: { params: { slug: string } }) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) redirect('/login');

  // Look up the user's actual organization_id (NOT their user_id — that was the
  // previous bug: this query used session.user.id, which is a user UUID, in a
  // filter against organization_id, which is an org UUID. They never match,
  // so the primary query always returned null and we fell back to a no-org
  // query that depended on RLS. RLS turned out to be stricter than expected
  // for private skills (created_by check requires extracting the userId from
  // the jsonb column, which the policy may not do reliably), so the fallback
  // also missed the row when scope=private.
  //
  // Fix: query users to get the real org_id, then filter org_skills by it.
  const { data: profile } = await supabase
    .from('users').select('organization_id')
    .eq('id', session.user.id).maybeSingle();
  const userOrgId = profile?.organization_id;

  // Primary lookup: own org + system Playbooks
  const { data: skill } = await supabase
    .from('org_skills')
    .select('*')
    .eq('slug', params.slug)
    .in('organization_id', userOrgId ? [userOrgId, SYSTEM_ORG_ID] : [SYSTEM_ORG_ID])
    .maybeSingle();

  // Fallback: cross-org search (e.g. universal-scope skills the user can see
  // but doesn't own). RLS handles the gating — we don't need to over-constrain
  // here. This covers Trending Globally entries and shared skills.
  const { data: actualSkill } = skill
    ? { data: skill }
    : await supabase.from('org_skills').select('*').eq('slug', params.slug).maybeSingle();

  if (!actualSkill) notFound();

  // Resolve creator attribution. Skip for system Playbooks (no human author)
  // and for any skill whose created_by jsonb is missing a userId (legacy rows).
  // We never expose email — only the display_name + signup date.
  const isSystem = actualSkill.organization_id === SYSTEM_ORG_ID;
  const creatorUserId: string | null = actualSkill.created_by?.userId || null;
  let creator: { displayName: string | null; memberSince: string | null; userId: string; karma: number } | null = null;
  if (creatorUserId && !isSystem) {
    // creator_karma is added to the same SELECT — one column, no extra query.
    // Drives the ✨ pill on CreatorBadge. Falls back to 0 for legacy rows
    // (creator_karma NOT NULL DEFAULT 0 from migration 0018 means this should
    // never actually be null, but the ?? guards against type mismatches if
    // the column is missing pre-migration).
    const { data: creatorRow } = await supabase
      .from('users').select('display_name, created_at, creator_karma')
      .eq('id', creatorUserId).maybeSingle();
    creator = {
      userId:      creatorUserId,
      displayName: creatorRow?.display_name || actualSkill.created_by?.displayName || null,
      memberSince: creatorRow?.created_at || null,
      karma:       creatorRow?.creator_karma ?? 0,
    };
  }

  // Pull active share tokens for this skill — drives the share UI state
  // (existing link + copy/revoke vs. "create share" button).
  const { data: shareRows } = await supabase
    .from('share_tokens')
    .select('token, share_mode, status, allowed_email_domain, share_message, expires_at, created_at, view_count, install_count')
    .eq('skill_id', actualSkill.id)
    .eq('status', 'active')
    .order('created_at', { ascending: false });

  // Has this viewer starred the skill? RLS scopes skill_stars to own-rows
  // for the authenticated user, so this query naturally returns 0 or 1 row
  // regardless of how many total stars the skill has. The aggregate count
  // comes from org_skills.star_count (already on actualSkill).
  const { data: myStar } = await supabase
    .from('skill_stars')
    .select('skill_id')
    .eq('skill_id', actualSkill.id)
    .eq('user_id', session.user.id)
    .maybeSingle();
  const isStarredByMe = !!myStar;

  // Has this viewer installed the skill (as a library reference via
  // migration 0021)? Same RLS-own-rows pattern as skill_stars: zero-or-one
  // row, drives the "Installed" badge + archive/restore link. Includes
  // archived rows so the detail page can offer "Restore to library" rather
  // than treating archived as fully gone.
  const { data: myInstall } = await supabase
    .from('user_skill_installs')
    .select('status')
    .eq('skill_id', actualSkill.id)
    .eq('user_id', session.user.id)
    .maybeSingle();
  const installState = myInstall ? { status: myInstall.status as 'active' | 'archived' } : null;

  // Fork-to-customize gating. Show ONLY when the viewer can plausibly want
  // a private copy: they didn't author it, and it doesn't already live in
  // their org (where they could edit directly without forking). System
  // Playbooks fall under "not in my org" and already have a dedicated "Fork
  // to my org" path through SkillActions — exclude here to avoid two
  // competing fork buttons on the same page.
  const isOwnedByMe   = actualSkill.created_by?.userId === session.user.id;
  const isInMyOrg     = !!userOrgId && actualSkill.organization_id === userOrgId;
  const showForkToCustomize = !isOwnedByMe && !isInMyOrg && !isSystem;

  const now = Date.now();
  const activeShares = (shareRows || [])
    .filter((s) => !s.expires_at || new Date(s.expires_at).getTime() > now)
    .map((s) => ({
      token:             s.token,
      shareMode:         s.share_mode as 'team' | 'public',
      url:               `${process.env.NEXT_PUBLIC_APP_URL || 'https://app.implexa.ai'}/s/${s.token}`,
      gateDescription:   s.share_mode === 'team'
        ? `Only @${s.allowed_email_domain} email addresses can install this skill.`
        : 'Anyone with this link can preview and install. PII has been removed from the public payload.',
      allowedEmailDomain: s.allowed_email_domain || null,
      viewCount:         s.view_count || 0,
      installCount:      s.install_count || 0,
      createdAt:         s.created_at,
    }));

  const inputs         = Array.isArray(actualSkill.inputs)          ? actualSkill.inputs          : [];
  const decisionPoints = Array.isArray(actualSkill.decision_points) ? actualSkill.decision_points : [];
  const outputContract = actualSkill.output_contract || {};
  const outcomeSignal  = actualSkill.outcome_signal  || {};
  const stats          = actualSkill.outcome_stats   || {};

  return (
    <main className="min-h-screen px-4 py-10">
      <div className="max-w-4xl mx-auto">
        <nav className="text-sm text-ink-500 mb-6">
          <Link href="/skills" className="hover:underline">← All skills</Link>
        </nav>

        {/* Header */}
        <header className="mb-6 flex items-start justify-between gap-4 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <span className={`text-xs px-2 py-0.5 rounded-full uppercase tracking-wide ${
                actualSkill.status === 'active' ? 'bg-brand-500 text-white' :
                actualSkill.status === 'draft'  ? 'bg-ink-800 text-ink-200' :
                'bg-ink-800 text-ink-500'}`}>
                {actualSkill.status}
              </span>
              {isSystem && <span className="text-xs px-2 py-0.5 rounded-full bg-ink-800 text-ink-200">Base Playbook</span>}
              <span className="text-xs text-ink-500 uppercase tracking-wide">{actualSkill.scope} · v{actualSkill.version}</span>
            </div>
            <h1 className="text-3xl font-semibold tracking-tight">{actualSkill.name}</h1>
            {creator && (
              <div className="mt-2">
                <CreatorBadge
                  displayName={creator.displayName}
                  memberSince={creator.memberSince}
                  userId={creator.userId}
                  karma={creator.karma}
                />
              </div>
            )}
            <code className="text-xs text-ink-500 font-mono block mt-2">{actualSkill.slug}</code>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <StarButton
                skillId={actualSkill.id}
                initialStarred={isStarredByMe}
                initialCount={actualSkill.star_count || 0}
                jwt={session.access_token}
              />
              {showForkToCustomize && (
                <ForkToCustomizeButton
                  skillId={actualSkill.id}
                  skillName={actualSkill.name}
                  jwt={session.access_token}
                />
              )}
              <DownloadSkillButton
                slug={actualSkill.slug}
                jwt={session.access_token}
              />
              {installState && (
                <InstallStatusBadge
                  skillId={actualSkill.id}
                  installState={installState}
                />
              )}
            </div>
            <p className="text-ink-200 mt-3">{actualSkill.description}</p>

            {/* Social share row — visible for any skill the user might want to
              * push out. Lives below the description so the install / share
              * actions on the right stay primary; sharing here is a secondary
              * "push this externally" action. Shows on system Playbooks too —
              * a power user might want to spread the word about a base skill. */}
            {actualSkill.scope !== 'private' && (
              <div className="mt-4">
                <ShareButtons
                  url={`${process.env.NEXT_PUBLIC_APP_URL || 'https://app.implexa.ai'}/skills/${actualSkill.slug}`}
                  title={actualSkill.name}
                  description={actualSkill.description || ''}
                  variant="full"
                />
              </div>
            )}

            {/* Raw capture link — creator-only */}
            {actualSkill.created_by?.userId === session.user.id && !isSystem && (
              <Link
                href={`/skills/${actualSkill.slug}/raw-capture`}
                className="inline-flex items-center gap-1.5 mt-3 text-xs text-brand-600 hover:underline font-medium"
              >
                🔍 View raw capture (only you can see this)
              </Link>
            )}
          </div>

          <SkillActions
            jwt={session.access_token}
            slug={actualSkill.slug}
            id={actualSkill.id}
            name={actualSkill.name}
            currentStatus={actualSkill.status}
            isSystem={isSystem}
            isOwnedByMe={actualSkill.created_by?.userId === session.user.id}
            usageCount={actualSkill.usage_count || 0}
            activeShares={activeShares}
          />
        </header>

        {/* Stats strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <Stat label="Used" value={`${actualSkill.usage_count || 0}×`} />
          <Stat label="Unique users" value={`${actualSkill.unique_users || 0}`} />
          <Stat label="Outcomes" value={`${stats.attributedOutcomes || 0}`} highlight={stats.attributedOutcomes > 0} />
          <Stat label="Value" value={stats.attributedValueUsd ? `$${Math.round(stats.attributedValueUsd / 1000)}K` : '$0'} highlight={stats.attributedValueUsd > 0} />
        </div>

        {/* Trigger phrases */}
        {Array.isArray(actualSkill.trigger_phrases) && actualSkill.trigger_phrases.length > 0 && (
          <div className="card mb-6">
            <div className="text-xs uppercase tracking-wide text-ink-500 mb-2">Trigger phrases</div>
            <div className="flex flex-wrap gap-2">
              {actualSkill.trigger_phrases.map((p: string) => (
                <span key={p} className="px-2 py-1 bg-ink-800 rounded text-xs text-ink-200">{p}</span>
              ))}
            </div>
          </div>
        )}

        {/* Tabs — content + structure */}
        <div className="card">
          <h2 className="text-lg font-medium mb-4">SKILL.md content</h2>
          <div className="prose prose-sm max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
              {actualSkill.content || '(no content)'}
            </ReactMarkdown>
          </div>
        </div>

        {/* Structured fields */}
        <div className="grid md:grid-cols-2 gap-4 mt-6">
          <div className="card">
            <h3 className="text-sm font-medium mb-3 uppercase tracking-wide text-ink-500">Inputs ({inputs.length})</h3>
            {inputs.length === 0 ? (
              <p className="text-sm text-ink-500 italic">No structured inputs.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {inputs.map((i: any, idx: number) => (
                  <li key={idx} className="border-l-2 border-brand-500 pl-3">
                    <code className="font-mono text-xs text-brand-600">{i.name}</code>
                    <span className="text-xs text-ink-500 ml-2">{i.type}{i.required ? ' · required' : ''}</span>
                    <div className="text-xs text-ink-200 mt-0.5">{i.description}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="card">
            <h3 className="text-sm font-medium mb-3 uppercase tracking-wide text-ink-500">Output contract</h3>
            {outputContract.summary ? (
              <div className="text-sm space-y-2">
                <div><strong className="text-xs text-ink-500 uppercase">Format:</strong> {outputContract.format || '—'}</div>
                <div className="text-ink-200">{outputContract.summary}</div>
                {Array.isArray(outputContract.qualityChecks) && outputContract.qualityChecks.length > 0 && (
                  <div>
                    <div className="text-xs text-ink-500 uppercase mt-2">Quality checks:</div>
                    <ul className="text-xs text-ink-200 list-disc pl-4 mt-1 space-y-0.5">
                      {outputContract.qualityChecks.map((c: string, i: number) => <li key={i}>{c}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            ) : <p className="text-sm text-ink-500 italic">No output contract defined.</p>}
          </div>

          <div className="card">
            <h3 className="text-sm font-medium mb-3 uppercase tracking-wide text-ink-500">Decision points ({decisionPoints.length})</h3>
            {decisionPoints.length === 0 ? (
              <p className="text-sm text-ink-500 italic">No conditional logic — fully deterministic skill.</p>
            ) : (
              <ul className="space-y-3 text-sm">
                {decisionPoints.map((d: any, idx: number) => (
                  <li key={idx} className="border-l-2 border-brand-400 pl-3">
                    <div className="text-xs font-medium text-brand-600">{d.atStep}</div>
                    <div className="text-xs text-ink-200">{d.description}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="card">
            <h3 className="text-sm font-medium mb-3 uppercase tracking-wide text-ink-500">Outcome signal</h3>
            {outcomeSignal.metric ? (
              <div className="text-sm space-y-2">
                <div>
                  <code className="font-mono text-xs text-brand-600 bg-brand-50 px-1.5 py-0.5 rounded">{outcomeSignal.metric}</code>
                  {outcomeSignal.target && <span className="text-xs text-ink-500 ml-2">target {outcomeSignal.target}</span>}
                </div>
                <div className="text-xs text-ink-500">Source: {outcomeSignal.source || 'manual'}</div>
                <div className="text-xs text-ink-200">{outcomeSignal.description}</div>
              </div>
            ) : <p className="text-sm text-ink-500 italic">No outcome signal — attribution not configured.</p>}
          </div>
        </div>

        <RecommendationsRail focusSkillId={actualSkill.id} jwt={session.access_token} limit={5} />
      </div>
    </main>
  );
}

function Stat({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`card !p-3 ${highlight ? '!border-success-400/40' : ''}`}>
      <div className={`text-xl font-semibold tabular-nums ${highlight ? 'text-success-400' : 'text-ink-50'}`}>{value}</div>
      <div className="text-xs text-ink-400 uppercase tracking-wide mt-0.5">{label}</div>
    </div>
  );
}
