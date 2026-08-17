import 'server-only';
import { parseMarketplaceExecutionRequirements, type MarketplaceExecutionRequirements } from './marketplace-execution-requirements';

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
  /** An optional Tier-2 grant that never BLOCKS activation (for example autopost). */
  optional?: boolean;
  /** Required high-trust access must be granted before activation/run. */
  required?: boolean;
  /** v1 durable scope: this agent only, across runs, until explicitly revoked. */
  grantScope?: 'agent_until_revoked' | 'automatic';
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
export type VerificationCheck = {
  key: string;
  label: string;
  /** ok = confirmed present; missing = confirmed absent; unknown = couldn't read. */
  status: 'ok' | 'missing' | 'unknown';
  fix?: string;
  /** For the browser check: the agent's own sites, so the grant sitting pre-warms them. */
  domains?: string[];
};
/** The honest hands-free contract: an active agent only claims "runs hands-free"
 *  when every Class-2 grant it needs (today: the browser pairing) is confirmed. */
export type ActivationVerification = {
  verified: boolean;
  checks: VerificationCheck[];
};
export type ActivationState = 'created' | 'activating' | 'active' | 'needs_attention';
/** Server-computed provisioning needs. The dashboard no longer detects these
 *  itself — it used to, from a hand-copied table that had already drifted from
 *  the backend's (different alt strings, a client-only provider column). */
export type AgentRequirementsPayload = {
  services: {
    key: string; name: string; cost: string; url: string;
    alt: string | null; provider: string | null;
    /**
     * Explicit provider access route. Unknown means the provider is detected, but
     * the workflow did not prove whether API key or browser login is the route.
     */
    accessMode?: 'api' | 'browser' | 'api_and_browser' | 'unknown' | null;
    /** Backward-compatible mirror: true=API, false=browser, null=unknown. */
    apiKeyRequired?: boolean | null;
    /** A verified local browser session is an access route for this workflow. */
    browserSession?: {
      required: boolean;
      domain: string;
      label: string;
      status: 'reachable' | 'unreachable' | 'unknown';
      identity?: string | null;
      verifiedAt?: string | null;
    } | null;
    /**
     * A key for this provider exists on the newest-seen machine — NOT the same as
     * "this agent may use it". Per-agent grants live in the local vault ACL and
     * never reach the server, so this is deliberately the weaker claim. The client
     * ANDs it with keysGrantedFor(slug); anything else re-creates the dead end
     * PR #63 removed (row collapses, "Use saved key" hidden, no way to authorize).
     */
    keyOnMachine: boolean;
    /** Other detected services this same key covers (Seedance rides HeyGen's). */
    alsoCovers?: string[];
  }[];
  tools: { key: string; name: string; autoInstalls: boolean }[];
};

export type CapabilityGap = {
  capability: string;
  capabilityLabel: string;
  reason: string | null;
  requiredness: 'required_to_deliver' | 'recommended';
};

export type ActivationChecklist = {
  slug: string;
  name: string;
  summary: string | null;
  state: ActivationState;
  /** 'on_demand' (runs when invoked) vs 'scheduled' (cron/once). */
  mode?: 'on_demand' | 'scheduled';
  /** Needs the user's machine (shell/browser) -> runs in Claude Code / the app. */
  requiresLocal?: boolean;
  /** ISO of the next scheduled fire (active cron), or null/absent. */
  nextRunAt?: string | null;
  /** Unanswered config questions, ALL tiers (drives the "N to answer" chip). */
  pendingQuestions?: number;
  /** Required-only — the same predicate Run gates on. Absent on an older backend. */
  blockingQuestions?: number;
  /** Preferences the user can still set; never block a run. */
  optionalQuestions?: number;
  /** readyToRun === blockingQuestions === 0 && blockingCapabilityGaps === 0. */
  readyToRun?: boolean;
  /**
   * Capabilities this agent needs but has NO viable tool for (every candidate
   * unavailable, or a stated preference contradicted itself). Server-derived
   * from metadata.capability_setup; requirements (below) can't express it,
   * since a gap has no step reflecting a working tool. Never blocks activation;
   * a required gap only makes readyToRun honest.
   */
  capabilityGaps?: CapabilityGap[];
  /** The ONE authoritative "what you'll need" list, server-computed. */
  requirements?: AgentRequirementsPayload;
  /** Signed, secret-free marketplace authority disclosure. */
  executionRequirements?: MarketplaceExecutionRequirements | null;
  /** Catalog source, threaded to the setup card / run command. */
  source?: string;
  canActivate: boolean;
  stepsLeft: number;
  steps: ActivationStep[];
  /** Honest hands-free verification (Class-2 grants confirmed). Absent → treat as verified. */
  verification?: ActivationVerification;
};

// The shared checklist mapper lives in lib/activation-core.ts: this file's
// 'server-only' import makes it unimportable from node:test — the same split
// as agents-home/agents-feed-core. Re-exported here so server-side callers
// keep one import site.
import { mapActivationChecklist } from './activation-core';
export { mapActivationChecklist };

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
    return mapActivationChecklist(b, slug);
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
