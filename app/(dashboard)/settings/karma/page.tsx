/**
 * /settings/karma — the caller's creator-karma panel.
 *
 * Pure server component — read view, no interactivity. Fetches
 * /api/v2/me/karma via callBackend (delegates to karma.service's
 * getCreatorBreakdown so the shape matches every other karma surface).
 *
 * Two states:
 *   - empty:   no karma yet (most users at v1 launch) — explains how
 *              karma is earned + how to share a skill from Claude Code
 *   - filled:  total at top, per-skill breakdown rows sorted by amount
 *              earned (already DESC from the service)
 */

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { callBackend } from '@/lib/api';

export const dynamic = 'force-dynamic';

type KarmaSkillRow = {
  skillId: string;
  slug: string | null;
  name: string | null;
  earned: number;
  eventCount: number;
  lastEarnedAt: string | null;
};

type KarmaResponse = {
  totalKarma: number;
  bySkill: KarmaSkillRow[];
};

function formatRelative(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const deltaMs = Date.now() - d.getTime();
  const day = 86400000;
  if (deltaMs < day)       return 'today';
  if (deltaMs < 2 * day)   return 'yesterday';
  if (deltaMs < 7 * day)   return `${Math.floor(deltaMs / day)}d ago`;
  if (deltaMs < 30 * day)  return `${Math.floor(deltaMs / (7 * day))}w ago`;
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

export default async function KarmaPanelPage() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) redirect('/login');

  let breakdown: KarmaResponse = { totalKarma: 0, bySkill: [] };
  try {
    breakdown = await callBackend('/api/v2/me/karma', { jwt: session.access_token });
  } catch (_err) {
    // callBackend throws on non-2xx; the backend already has a graceful
    // empty-shape fallback, so a thrown error here is genuinely the API
    // being unreachable. Keep the empty default — the panel renders the
    // empty state, no toast needed.
  }

  const isEmpty = !breakdown.totalKarma;

  return (
    <main className="min-h-screen px-4 py-12">
      <div className="max-w-2xl mx-auto">
        <nav className="text-xs text-ink-500 mb-4">
          <Link href="/settings" className="hover:underline">← Settings</Link>
        </nav>

        <header className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight">Creator karma</h1>
          <p className="text-ink-300 text-sm mt-2 leading-relaxed">
            Karma you earn when other people engage with skills you&apos;ve created —
            installing them via share link, forking them into their own library,
            or having their first public share promote a skill to the global
            library.
          </p>
        </header>

        {/* Total — large number, present whether empty or filled.
            Zero is shown intentionally; the empty-state CTA below explains
            how to start earning. */}
        <div className="card mb-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-xs uppercase tracking-wide text-ink-500 mb-1">
                Total karma
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-5xl font-semibold tabular-nums text-ink-50">
                  {breakdown.totalKarma.toLocaleString()}
                </span>
                {breakdown.totalKarma > 0 && (
                  <span className="text-amber-400 text-2xl" aria-hidden="true">✨</span>
                )}
              </div>
            </div>
            {/* Cross-link to the public leaderboard — surfaces the social
              * context for what this number means. Worth showing even at
              * 0 karma, since a brand-new creator wants to see "what does
              * the top of the board look like?" before they commit to
              * sharing their first skill. */}
            <Link
              href="/leaderboard"
              className="shrink-0 text-xs text-brand-500 hover:underline whitespace-nowrap mt-2"
            >
              See leaderboard →
            </Link>
          </div>
        </div>

        {isEmpty ? (
          <div className="card">
            <div className="text-sm text-ink-100 leading-relaxed">
              You haven&apos;t earned any karma yet — share a skill with your
              team or publicly to start earning when others install or fork it.
            </div>
            <div className="mt-4 text-sm text-ink-300 leading-relaxed">
              In Claude Code, run{' '}
              <code className="font-mono bg-ink-800 px-1.5 py-0.5 rounded text-ink-100">/implexa:share-this</code>{' '}
              on any active skill in your library. Both team-domain shares and
              public shares fire karma to you when someone installs or forks
              your skill — public shares just reach more people. You can also
              pick a skill from your{' '}
              <Link href="/skills" className="text-brand-500 hover:underline">library</Link>{' '}
              and use the <strong>Share</strong> action there.
            </div>
            <div className="mt-4 text-xs text-ink-500 leading-relaxed">
              How karma is earned: <strong>+5</strong> when someone installs your
              shared skill, <strong>+25</strong> when someone forks it, and{' '}
              <strong>+100</strong> the first time a skill of yours is promoted
              to the public library by a public share.
            </div>
          </div>
        ) : (
          <div>
            <div className="text-xs uppercase tracking-wide text-ink-500 mb-2 px-1">
              By skill ({breakdown.bySkill.length})
            </div>
            <ul className="space-y-2">
              {breakdown.bySkill.map((row) => (
                <li key={row.skillId} className="card !py-3 flex items-center justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    {row.slug ? (
                      <Link
                        href={`/skills/${row.slug}`}
                        className="text-sm font-medium text-ink-50 hover:underline truncate block"
                      >
                        {row.name || row.slug}
                      </Link>
                    ) : (
                      <div className="text-sm font-medium text-ink-300 truncate">
                        {row.name || 'Deleted skill'}
                      </div>
                    )}
                    <div className="text-xs text-ink-500 mt-0.5">
                      {row.eventCount}{' '}
                      {row.eventCount === 1 ? 'event' : 'events'}
                      {row.lastEarnedAt && ` · last ${formatRelative(row.lastEarnedAt)}`}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    {/* Match the karma-pill contrast pattern from CreatorBadge —
                      * dark-amber text in light mode, light-amber in dark mode.
                      * Previously was text-amber-300 unconditionally, which
                      * rendered as near-invisible ghost-text on light bg. */}
                    <div className="text-lg font-semibold tabular-nums text-amber-700 dark:text-amber-400">
                      +{row.earned.toLocaleString()}
                    </div>
                    <div className="text-[10px] uppercase tracking-wide text-ink-500">
                      karma
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </main>
  );
}

export const metadata = {
  title: 'Creator karma — Implexa',
};
