/**
 * /leaderboard — public creator scoreboard.
 *
 * Top karma earners across the Implexa platform. No auth required (matches
 * the /api/v2/leaderboard endpoint's no-auth posture). Lives at the URL
 * root rather than under (dashboard) — it's a marketing-visible page that
 * gets shared externally, so the URL stays clean.
 *
 * Period is driven by the `?period=` query param (server-side state, no
 * client JS), defaulting to all-time. Each variant is cached at the Next
 * layer for 300s to match the API edge cache.
 *
 * V1 row shape: rank + avatar + name + karma. The original spec mentioned
 * a "top 1-2 skills" enrichment per row — deferred because the leaderboard
 * endpoint doesn't surface per-creator skill data yet (would need a small
 * extension to karma.service.getLeaderboard with a JOIN to org_skills).
 */

import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { Logo } from '@/components/logo';
import { pickAvatarColor, handleFallback } from '@/lib/avatar';

type Leader = {
  userId: string;
  displayName: string | null;
  karma: number;
};

type LeaderboardResponse = {
  period: 'alltime' | 'month';
  since: string | null;
  leaders: Leader[];
};

const LIMIT = 50;

async function fetchLeaderboard(period: 'alltime' | 'month'): Promise<LeaderboardResponse> {
  const base = (process.env.NEXT_PUBLIC_IMPLEXA_API_URL || 'http://localhost:8001').replace(/\/$/, '');
  try {
    // revalidate: 300 matches the API's Cache-Control max-age=300. Next caches
    // the rendered HTML per query-param variant so /leaderboard and
    // /leaderboard?period=month are independent cache keys.
    const res = await fetch(`${base}/api/v2/leaderboard?period=${period}&limit=${LIMIT}`, {
      next: { revalidate: 300 },
    });
    if (!res.ok) return { period, since: null, leaders: [] };
    return (await res.json()) as LeaderboardResponse;
  } catch (_err) {
    // API unreachable — render the empty state rather than throwing a 500.
    return { period, since: null, leaders: [] };
  }
}

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams?: { period?: string };
}) {
  const period: 'alltime' | 'month' = searchParams?.period === 'month' ? 'month' : 'alltime';
  const data = await fetchLeaderboard(period);

  // Auth state drives the top-right header link only — page itself stays
  // public. Wrapped in a no-store getUser so we don't poison the cache.
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const isAuthed = !!user;

  const leaders = data.leaders;
  const isEmpty = leaders.length === 0;
  // "Early days" banner — shown when there's between 1 and 9 entries.
  // Frames a sparse board as momentum-building rather than pathetic, per
  // the v1 product call.
  const isEarlyDays = leaders.length > 0 && leaders.length < 10;

  return (
    <main className="min-h-screen px-4 py-10">
      <header className="max-w-3xl mx-auto flex items-center justify-between mb-10">
        <Link href="/" className="inline-flex items-center text-ink-50">
          <Logo height={20} />
        </Link>
        {isAuthed ? (
          <Link href="/overview" className="text-sm text-ink-200 hover:underline">
            Dashboard →
          </Link>
        ) : (
          <Link href="/signup" className="text-sm text-brand-500 hover:underline">
            Sign in / Sign up
          </Link>
        )}
      </header>

      <div className="max-w-3xl mx-auto">
        <header className="mb-6">
          <h1 className="text-4xl font-semibold tracking-tight text-ink-50">
            Creator leaderboard
          </h1>
          <p className="text-ink-300 text-sm mt-2 leading-relaxed max-w-xl">
            The Implexa creators whose shared skills are getting the most engagement.
            Karma rises when others install, fork, or amplify your skills.
          </p>
        </header>

        <div className="inline-flex rounded-full bg-ink-800 p-1 mb-6" role="tablist" aria-label="Leaderboard period">
          <PeriodPill active={period === 'alltime'} period="alltime" label="All-time" />
          <PeriodPill active={period === 'month'}   period="month"   label="This month" />
        </div>

        {isEmpty ? (
          <EmptyState period={period} />
        ) : (
          <>
            {isEarlyDays && (
              <div className="card !p-3 !bg-brand-500/5 !border-brand-500/20 mb-4 text-sm text-ink-200 flex items-start gap-2">
                <span aria-hidden="true">✨</span>
                <span>
                  Early days — these creators are leading the way. Share your skill
                  publicly to join them.
                </span>
              </div>
            )}
            <ol className="space-y-2">
              {leaders.map((leader, i) => (
                <LeaderRow key={leader.userId} rank={i + 1} leader={leader} />
              ))}
            </ol>
          </>
        )}

        <div className="text-xs text-ink-500 text-center mt-10 leading-relaxed">
          Want to be on this board? In Claude Code, run{' '}
          <code className="font-mono bg-ink-800 px-1.5 py-0.5 rounded text-ink-300">
            /implexa:share-this
          </code>{' '}
          on any active skill in your library.
        </div>
      </div>
    </main>
  );
}

function PeriodPill({
  active,
  period,
  label,
}: {
  active: boolean;
  period: 'alltime' | 'month';
  label: string;
}) {
  // Default period (alltime) doesn't need the query param — keeps the URL
  // clean for the canonical /leaderboard share.
  const href = period === 'alltime' ? '/leaderboard' : `/leaderboard?period=${period}`;
  return (
    <Link
      href={href}
      role="tab"
      aria-selected={active}
      className={`px-4 py-1.5 rounded-full text-xs font-medium transition-colors ${
        active ? 'bg-ink-700 text-ink-50' : 'text-ink-400 hover:text-ink-200'
      }`}
    >
      {label}
    </Link>
  );
}

function LeaderRow({ rank, leader }: { rank: number; leader: Leader }) {
  const name = leader.displayName || handleFallback(leader.userId);
  const initial = (leader.displayName || leader.userId).trim().charAt(0).toUpperCase() || '?';
  const color = pickAvatarColor(leader.userId);

  // Top 3 get medal emojis; the rest get plain #N labels. Top 3 row also
  // gets a subtle amber tint so the eye lands on the podium first.
  const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : null;
  const isPodium = rank <= 3;

  return (
    <li className={`card flex items-center gap-4 ${isPodium ? '!border-amber-500/30 !bg-amber-500/[0.04]' : ''}`}>
      <div className="shrink-0 w-12 text-center" aria-label={`Rank ${rank}`}>
        {medal ? (
          <span className="text-2xl" aria-hidden="true">{medal}</span>
        ) : (
          <span className="text-sm font-semibold tabular-nums text-ink-400">#{rank}</span>
        )}
      </div>
      <div
        className={`h-10 w-10 ${color} rounded-full flex items-center justify-center font-semibold text-white shrink-0 select-none`}
        aria-hidden="true"
      >
        {initial}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-ink-50 truncate">{name}</div>
      </div>
      <div className="shrink-0 text-right">
        <div className="text-lg font-semibold tabular-nums text-amber-700 dark:text-amber-400">
          <span aria-hidden="true">✨ </span>{leader.karma.toLocaleString()}
        </div>
        <div className="text-[10px] uppercase tracking-wide text-ink-500">karma</div>
      </div>
    </li>
  );
}

function EmptyState({ period }: { period: 'alltime' | 'month' }) {
  return (
    <div className="card text-center py-12">
      <div className="text-5xl mb-4" aria-hidden="true">✨</div>
      <h2 className="text-lg font-semibold text-ink-50 mb-2">
        {period === 'month' ? 'No karma earned this month yet' : 'No karma earned yet'}
      </h2>
      <p className="text-sm text-ink-300 leading-relaxed max-w-md mx-auto">
        Be the first creator on the board. In Claude Code, run{' '}
        <code className="font-mono bg-ink-800 px-1.5 py-0.5 rounded text-ink-100">
          /implexa:share-this
        </code>{' '}
        on any active skill, pick a share mode — karma fires the moment someone
        installs or forks it.
      </p>
    </div>
  );
}

export const metadata = {
  title: 'Creator leaderboard — Implexa',
  description:
    'The Implexa creators whose shared skills earn the most karma. Install one, fork another, or share yours to join the board.',
  openGraph: {
    title: 'Creator leaderboard — Implexa',
    description:
      'The Implexa creators whose shared skills earn the most karma. Install one, fork another, or share yours to join the board.',
    type: 'website',
  },
};
