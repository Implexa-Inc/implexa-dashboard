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
  scheduleNl: string | null;
  lastRun: { status: string; runState: string | null; ranAt: string } | null;
};
export type MyAgents = { needsActivation: MyAgent[]; active: MyAgent[] };

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
    };
  } catch {
    return null;
  }
}

/** Compact run-status for an active agent's row, one CTA each. */
export function activeRunStatus(a: MyAgent): { label: string; tone: 'good' | 'warn' | 'bad' | 'idle'; cta: string; href: string } {
  const rs = a.lastRun?.runState;
  const st = a.lastRun?.status;
  if (rs === 'stalled') return { label: 'Stalled', tone: 'warn', cta: 'Fix in Routines', href: '/scheduled' };
  if (st === 'failed' || rs === 'failed') return { label: 'Failed', tone: 'bad', cta: 'Fix', href: '/scheduled' };
  if (st === 'partial') return { label: 'Partial', tone: 'warn', cta: 'View output', href: '/inbox' };
  if (st === 'completed' || rs === 'completed') return { label: 'Done', tone: 'good', cta: 'View output', href: '/inbox' };
  return { label: 'Scheduled', tone: 'idle', cta: 'View', href: '/scheduled' };
}
