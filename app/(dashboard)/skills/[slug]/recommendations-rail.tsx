/**
 * "You might also like" rail on the skill detail page.
 *
 * Server-rendered. Fetches /api/v2/recommendations/for-skill with the user's
 * Supabase JWT and renders up to N clickable cards. Hides the whole section
 * if the recommender returns zero (sparse-data + no popularity fallback —
 * rare, but possible on a brand-new org with no visible skills).
 */

import Link from 'next/link';

type Recommendation = {
  skillId: string;
  slug: string;
  name: string;
  score: number;
  reason: string;
};

async function fetchRecommendations(focusSkillId: string, jwt: string, limit = 5): Promise<Recommendation[]> {
  const base = (process.env.NEXT_PUBLIC_IMPLEXA_API_URL || 'http://localhost:8001').replace(/\/$/, '');
  try {
    const res = await fetch(
      `${base}/api/v2/recommendations/for-skill?skillId=${encodeURIComponent(focusSkillId)}&limit=${limit}`,
      {
        headers: { Authorization: `Bearer ${jwt}` },
        cache:   'no-store',
      },
    );
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data?.recommendations) ? data.recommendations : [];
  } catch {
    // Backend unreachable — render the empty state (which hides the rail).
    return [];
  }
}

export async function RecommendationsRail({
  focusSkillId,
  jwt,
  limit = 5,
}: {
  focusSkillId: string;
  jwt: string;
  limit?: number;
}) {
  const recs = await fetchRecommendations(focusSkillId, jwt, limit);
  if (!recs.length) return null;

  return (
    <section className="mt-8">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-lg font-medium">you might also like</h2>
        <span className="text-xs text-ink-500">based on what your org runs together</span>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {recs.map((r) => (
          <Link
            key={r.skillId}
            href={`/skills/${r.slug}`}
            className="card hover:border-brand-500 transition-colors group"
          >
            <div className="text-sm font-medium text-ink-50 group-hover:text-brand-400 line-clamp-2">
              {r.name}
            </div>
            <code className="text-xs text-ink-500 font-mono block mt-1 truncate">{r.slug}</code>
            <div className="text-xs text-ink-400 mt-2">{r.reason}</div>
          </Link>
        ))}
      </div>
    </section>
  );
}
