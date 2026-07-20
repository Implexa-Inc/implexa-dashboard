/**
 * lib/attention.ts — the client for GET /api/v2/me/needs-you.
 *
 * THE ONE RULE THIS FILE EXISTS TO ENFORCE: unavailable is NOT empty.
 *
 * Every other backend reader here (getConnectionStatus, getMyAgents) returns null
 * on failure so consumers can "degrade to a calm not-set-up-yet state". That is
 * right for those reads and CATASTROPHIC for this one. A calm degrade here renders
 * "Nothing needs you right now" over an agent that is blocked waiting on the user —
 * the exact silent-stop failure the Needs You work exists to remove, reintroduced
 * at the surface after the backend went to real trouble to avoid it (the service
 * returns 503 rather than an empty list, and reports `partial` per source).
 *
 * So this returns a STATUS, never null, and a failed fetch sets partial=true with
 * zero items. Callers must treat partial/truncated as "do not claim all-clear".
 */

const BACKEND = (
  process.env.NEXT_PUBLIC_IMPLEXA_API_URL || 'https://core.implexa.ai'
).replace(/\/$/, '');

/** What the person must DO. Mirrors ACTION_RANK in the backend read model. */
export type RequiredAction =
  | 'provide_information'
  | 'grant_permission'
  | 'open_service'
  | 'review_result';

export type AttentionSource = 'judge_block' | 'held_run' | 'stalled_run';

/** The typed action a card offers — maps to a SOURCE-SPECIFIC endpoint, never a generic resolve. */
export type PrimaryAction = {
  kind: RequiredAction;
  targetType: AttentionSource;
  targetId: string;
  label: string;
};

export type AttentionReason = {
  sourceType: AttentionSource;
  sourceId: string;
  whatHappened: string;
  requiredAction: RequiredAction;
};

export type AttentionItem = {
  attentionId: string;
  sourceType: AttentionSource;
  sourceId: string;
  runId: string | null;
  agentSlug: string | null;
  /**
   * Display name, resolved by loadNeedsYou from the caller's agent list — the
   * backend only knows the slug. Absent until that enrichment runs, so renderers
   * must fall back to the slug rather than showing "undefined".
   */
  agentName?: string | null;
  whatHappened: string;
  requiredAction: RequiredAction;
  actionDetail: string | null;
  primaryAction: PrimaryAction;
  reasons: AttentionReason[];
  createdAt: string | null;
  seenAt: string | null;
  resolvedAt: string | null;
};

export type Attention = {
  items: AttentionItem[];
  /** A source failed to answer, or the whole read did. NEVER claim all-clear when true. */
  partial: boolean;
  /** The backend hit its safety ceiling. Also forbids an all-clear. */
  truncated: boolean;
  unavailableSources: string[];
  /** false when the endpoint could not be reached at all (not yet deployed, network, 503). */
  live: boolean;
};

/** The honest empty: we know nothing, so we claim nothing. */
const UNAVAILABLE: Attention = {
  items: [], partial: true, truncated: false, unavailableSources: ['needs_you_endpoint'], live: false,
};

export async function getAttention(): Promise<Attention> {
  const { createClient } = await import('@/lib/supabase/server');
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  // No session is not a failure to report — the caller is not signed in, and
  // nothing can need them.
  if (!session?.access_token) return { items: [], partial: false, truncated: false, unavailableSources: [], live: false };

  try {
    const res = await fetch(`${BACKEND}/api/v2/me/needs-you`, {
      headers: { authorization: `Bearer ${session.access_token}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    // 503 is the backend saying "I cannot answer" — the one case where an empty
    // list would be an outright lie. Everything non-2xx lands here, including a
    // deploy where the route does not exist yet (rollout order is 0124 → backend
    // → surfaces, so this surface can legitimately run ahead of its endpoint).
    if (!res.ok) return UNAVAILABLE;
    const body = await res.json();
    if (!body?.ok) return UNAVAILABLE;
    return {
      items: Array.isArray(body.items) ? (body.items as AttentionItem[]) : [],
      partial: !!body.partial,
      truncated: !!body.truncated,
      unavailableSources: Array.isArray(body.unavailableSources) ? body.unavailableSources : [],
      live: true,
    };
  } catch {
    return UNAVAILABLE;
  }
}

/**
 * One honest sentence for the surface to render whenever the list cannot be
 * trusted as complete. Returns null when the list IS complete, so a caller can
 * use it directly as the "may I say all-clear?" test.
 */
export function attentionWarning(a: Pick<Attention, 'partial' | 'truncated' | 'live'>): string | null {
  if (a.truncated) return 'There are more items than we can show here. This list is not complete.';
  if (!a.live) return "We couldn't check everything that might need you just now. This list may be incomplete — try again shortly.";
  if (a.partial) return "We couldn't check every source just now, so something may be missing from this list.";
  return null;
}
