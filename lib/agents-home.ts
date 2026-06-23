import 'server-only';

// Owner-scoped read of the 2-group agent home (ACTIVATION_JOURNEY.md):
// GET /api/v2/me/agents -> { needsActivation, active }. Degrades to null.

const BACKEND = (
  process.env.NEXT_PUBLIC_IMPLEXA_API_URL || 'https://core.implexa.ai'
).replace(/\/$/, '');

export type MyAgentState = 'created' | 'activating' | 'active' | 'needs_attention';
export type MyAgent = {
  slug: string;
  name: string;
  state: MyAgentState;
  stepsLeft: number;
  /** A manual action blocks this agent from really running (e.g. an ungranted Bash perm). */
  needsIntervention?: boolean;
  /** Plain-language "what to do", e.g. Allow "Run commands on your computer". */
  interventionReason?: string | null;
  /** Unanswered config questions (drives the "N to answer" chip). */
  pendingQuestions?: number;
  /** Built but never activated, never run, stale — collapsed out of SET UP. */
  isDraft?: boolean;
  /** 'on_demand' (runs when invoked) vs 'scheduled' (cron/once) — groups the home. */
  mode?: 'on_demand' | 'scheduled';
  scheduleNl: string | null;
  /** ISO of the next scheduled fire (active cron), or null. */
  nextRunAt?: string | null;
  lastRun: { id?: string; status: string; runState: string | null; ranAt: string } | null;
};
export type MyAgents = { needsActivation: MyAgent[]; active: MyAgent[]; drafts: MyAgent[] };

export async function getMyAgents(): Promise<MyAgents | null> {
  const { createClient } = await import('@/lib/supabase/server');
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return null;
  try {
    const res = await fetch(`${BACKEND}/api/v2/me/agents`, {
      headers: { authorization: `Bearer ${session.access_token}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const b = (await res.json()) as Record<string, unknown>;
    return {
      needsActivation: Array.isArray(b.needsActivation) ? (b.needsActivation as MyAgent[]) : [],
      active: Array.isArray(b.active) ? (b.active as MyAgent[]) : [],
      drafts: Array.isArray(b.drafts) ? (b.drafts as MyAgent[]) : [],
    };
  } catch {
    return null;
  }
}

/** Compact run-status for an active agent's row, one CTA each. */
export function activeRunStatus(a: MyAgent): { label: string; tone: 'good' | 'warn' | 'bad' | 'idle'; cta: string; href: string } {
  const rs = a.lastRun?.runState;
  const st = a.lastRun?.status;
  if (rs === 'stalled') return { label: 'Stalled', tone: 'warn', cta: 'Fix', href: `/workflows/${a.slug}` };
  if (st === 'failed' || rs === 'failed') return { label: 'Failed', tone: 'bad', cta: 'Fix', href: `/workflows/${a.slug}` };
  const outHref = a.lastRun?.id ? `/runs/${a.lastRun.id}` : '/inbox';
  if (st === 'partial') return { label: 'Partial', tone: 'warn', cta: 'View output', href: outHref };
  if (st === 'completed' || rs === 'completed') return { label: 'Done', tone: 'good', cta: 'View output', href: outHref };
  return { label: 'Scheduled', tone: 'idle', cta: 'View', href: `/workflows/${a.slug}` };
}
