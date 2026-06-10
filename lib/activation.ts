import 'server-only';

// Owner-scoped read of the agent activation checklist (ACTIVATION_JOURNEY.md).
// Mirrors lib/connections.ts: read the Supabase session, call the backend with
// the JWT, degrade to null on any failure so the page shows a calm state.

const BACKEND = (
  process.env.NEXT_PUBLIC_IMPLEXA_API_URL || 'https://core.implexa.ai'
).replace(/\/$/, '');

export type PermissionTier = 0 | 1 | 2;
export type PermissionItem = {
  tier: PermissionTier;
  group: string;
  label: string;
  detail: string;
  domains?: string[];
  /** Tier 0/1 are always granted; a Tier-2 is granted once the user opts in. */
  granted?: boolean;
};
export type StepStatus = 'done' | 'todo' | 'auto';
export type ActivationStep = {
  id: 'permissions' | 'connections' | 'notifications' | 'schedule' | string;
  title: string;
  status: StepStatus;
  cta: string | null;
  detail: string;
  data?: {
    items?: PermissionItem[];
    requiresOptIn?: boolean;
    needed?: Array<{ account?: string; label?: string; status?: string }>;
    scheduleNl?: string | null;
    [k: string]: unknown;
  };
};
export type ActivationState = 'created' | 'activating' | 'active' | 'needs_attention';
export type ActivationChecklist = {
  slug: string;
  name: string;
  summary: string | null;
  state: ActivationState;
  /** 'on_demand' (runs when invoked) vs 'scheduled' (cron/once). */
  mode?: 'on_demand' | 'scheduled';
  /** Needs the user's machine (shell/browser) -> runs in Claude Code / the app. */
  requiresLocal?: boolean;
  canActivate: boolean;
  stepsLeft: number;
  steps: ActivationStep[];
};

/** GET /api/v2/agents/:slug/activation with the caller's JWT. null on any failure. */
export async function getActivationChecklist(slug: string): Promise<ActivationChecklist | null> {
  const { createClient } = await import('@/lib/supabase/server');
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return null;
  try {
    const res = await fetch(`${BACKEND}/api/v2/agents/${encodeURIComponent(slug)}/activation`, {
      headers: { authorization: `Bearer ${session.access_token}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const b = (await res.json()) as Record<string, unknown>;
    if (!b?.ok) return null;
    return {
      slug: String(b.slug ?? slug),
      name: String(b.name ?? slug),
      summary: (b.summary as string) ?? null,
      state: (b.state as ActivationState) ?? 'created',
      canActivate: !!b.canActivate,
      stepsLeft: Number(b.stepsLeft ?? 0),
      steps: Array.isArray(b.steps) ? (b.steps as ActivationStep[]) : [],
    };
  } catch {
    return null;
  }
}

// Presentation helpers shared by the card.
export const TIER_PRESENTATION: Record<PermissionTier, { label: string; classes: string }> = {
  0: { label: 'Auto', classes: 'border-ink-700 text-ink-400' },
  1: { label: 'Heads-up', classes: 'border-sky-500/40 text-sky-700 dark:text-sky-300' },
  2: { label: 'Your call', classes: 'border-amber-500/50 text-amber-700 dark:text-amber-300' },
};
