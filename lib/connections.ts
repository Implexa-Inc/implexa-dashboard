// connections.ts - the reachability of the accounts/apps your agents drive in
// your Implexa browser. The data layer behind the Connections section.
//
// THE PROBLEM THIS CLOSES (live email-agent test, 2026-06-08): the engine
// builds, reads Gmail, summarizes and drafts fine; activation dies at getting
// the user's accounts reliably reachable by the browser-driving agent. No API
// keys: sign in once in the dedicated Implexa browser profile and the agent runs
// as you. Connections is the health panel that shows, per account and per agent,
// whether that is actually true, and warns loudly when it is not.
//
// WHO OWNS WHAT (CONNECTIONS_ONBOARDING.md, stream split):
//   - The DESKTOP owns Chrome pairing and is the source of truth for
//     REACHABILITY (it navigates + verifies which accounts load as the right
//     account in the dedicated profile, best-effort in main as backup) and
//     reports them to the backend.
//   - The BACKEND owns the REQUIREMENT (from each agent's permission manifest:
//     which domains/accounts it needs) and stores the reachability the desktop
//     reports. It exposes this owner-scoped Connections status read.
//   - The DASHBOARD (this file + /connections) renders it.
//
// INTEGRATION SLOT: the authoritative read is the backend route
// GET /api/v2/me/connections, owner-scoped via the caller's Supabase JWT (same
// auth path as lib/workflow-catalog.ts listMyWorkflows). A PARALLEL backend
// stream is building it. Until it ships, getConnectionStatus() degrades cleanly
// to null and the page shows a calm not-set-up-yet state. The documented
// response shape below is the contract; the mapper tolerates missing fields so a
// half-built endpoint never throws.

const BACKEND = (
  process.env.NEXT_PUBLIC_IMPLEXA_API_URL || 'https://core.implexa.ai'
).replace(/\/$/, '');

// Where the user signs an account back in. The reliable home is the dedicated
// profile in the Implexa desktop browser, which the desktop owns; the dashboard
// has no web path to drive that pairing, so the CTA points at the Connect-Claude
// flow (the closest existing web surface) until a desktop deep link exists. When
// the desktop ships one (e.g. implexa://connections), change it here only.
export const RECONNECT_HREF = '/install';

export type ReachState = 'reachable' | 'unreachable' | 'unknown';
// PRIMARY = the dedicated profile (the reliable home). BACKUP = the user's main
// Chrome profile (best-effort, inherits the flaky cross-profile pairing).
export type ConnProfile = 'dedicated' | 'main';

// One account/app the user has (or needs) signed in. `domain` is always present
// (it is what the agent navigates to); `account` is the identity bound to it
// (email/handle) when the desktop verified one.
export type ConnectionAccount = {
  id: string;
  /** Human label, e.g. "Gmail" or "LinkedIn (founder@implexa.ai)". */
  label: string;
  /** The account identity bound to it, when known. */
  account: string | null;
  /** The domain the agent reaches, e.g. mail.google.com. */
  domain: string;
  profile: ConnProfile | null;
  status: ReachState;
  /** ISO of the last desktop verify ("navigated, loaded as that account"). */
  verified_at: string | null;
};

// One account/app a specific agent needs, paired with whether it is reachable.
export type AgentNeed = {
  label: string;
  account: string | null;
  domain: string;
  status: ReachState;
  profile: ConnProfile | null;
};

export type AgentConnections = {
  slug: string;
  name: string;
  needs: AgentNeed[];
};

// A loud, user-facing warning: an agent needs an account that is not reachable.
// Mirrors the run-attention shape so the banner can render it like a stalled run.
export type ConnectionWarning = {
  agent_slug: string;
  agent_name: string;
  label: string;
  account: string | null;
  domain: string;
  reason: string;
  detected_at: string | null;
};

export type ConnectionStatus = {
  connections: ConnectionAccount[];
  agents: AgentConnections[];
  warnings: ConnectionWarning[];
  /** True when this is real backend data; false on the degraded empty fallback. */
  live: boolean;
};

const REACH: ReadonlySet<ReachState> = new Set(['reachable', 'unreachable', 'unknown']);
const PROFILES: ReadonlySet<ConnProfile> = new Set(['dedicated', 'main']);

function asReach(v: unknown): ReachState {
  return typeof v === 'string' && REACH.has(v as ReachState) ? (v as ReachState) : 'unknown';
}
function asProfile(v: unknown): ConnProfile | null {
  return typeof v === 'string' && PROFILES.has(v as ConnProfile) ? (v as ConnProfile) : null;
}
function asStr(v: unknown): string | null {
  return typeof v === 'string' && v ? v : null;
}

// Derive a label when the backend did not send one: prefer "App (account)",
// fall back to the bare domain.
function deriveLabel(rawLabel: unknown, domain: string, account: string | null): string {
  const explicit = asStr(rawLabel);
  if (explicit) return explicit;
  const app = appNameFromDomain(domain);
  return account ? `${app} (${account})` : app;
}

// Friendly app name from a domain (mail.google.com -> Gmail). Best-effort; the
// backend label wins when present. Kept small and obvious on purpose.
function appNameFromDomain(domain: string): string {
  const d = domain.toLowerCase();
  if (d.includes('mail.google')) return 'Gmail';
  if (d.includes('google')) return 'Google';
  if (d.includes('linkedin')) return 'LinkedIn';
  if (d.includes('github')) return 'GitHub';
  if (d.includes('slack')) return 'Slack';
  if (d.includes('notion')) return 'Notion';
  if (d.includes('x.com') || d.includes('twitter')) return 'X';
  if (d.includes('calendar')) return 'Calendar';
  // Strip a leading subdomain and the TLD: app.hubspot.com -> Hubspot.
  const parts = d.replace(/^www\./, '').split('.');
  const core = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
  return core.charAt(0).toUpperCase() + core.slice(1);
}

function reasonFor(label: string, account: string | null): string {
  return account
    ? `${label} is signed out or unreachable in your Implexa browser. Sign in as ${account} to let the agent run.`
    : `${label} is not reachable in your Implexa browser. Sign in once to let the agent run as you.`;
}

function mapConnections(raw: unknown): ConnectionAccount[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((c: any, i: number) => {
    const domain = asStr(c?.domain) || asStr(c?.account) || `account-${i}`;
    const account = asStr(c?.account);
    return {
      id: asStr(c?.id) || `${domain}-${i}`,
      label: deriveLabel(c?.label, domain, account),
      account,
      domain,
      profile: asProfile(c?.profile),
      status: asReach(c?.status),
      verified_at: asStr(c?.verified_at),
    };
  });
}

function mapAgents(raw: unknown): AgentConnections[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((a: any): AgentConnections | null => {
      const slug = asStr(a?.slug);
      if (!slug) return null;
      const needsRaw = Array.isArray(a?.needs) ? a.needs : [];
      const needs: AgentNeed[] = needsRaw.map((n: any, i: number) => {
        const domain = asStr(n?.domain) || asStr(n?.account) || `need-${i}`;
        const account = asStr(n?.account);
        // Tolerate either an explicit status or a boolean `reachable`.
        const status = n?.status != null
          ? asReach(n.status)
          : n?.reachable === true ? 'reachable'
          : n?.reachable === false ? 'unreachable'
          : 'unknown';
        return {
          label: deriveLabel(n?.label, domain, account),
          account,
          domain,
          status,
          profile: asProfile(n?.profile),
        };
      });
      return { slug, name: asStr(a?.name) || slug.replace(/[-_]+/g, ' '), needs };
    })
    .filter((a): a is AgentConnections => a !== null);
}

// Warnings: prefer the backend's own list; otherwise derive from each agent's
// unreachable needs so the loud banner still works against a half-built endpoint.
function mapWarnings(raw: unknown, agents: AgentConnections[]): ConnectionWarning[] {
  if (Array.isArray(raw) && raw.length > 0) {
    return raw
      .map((w: any): ConnectionWarning | null => {
        const slug = asStr(w?.agent_slug) || asStr(w?.slug);
        if (!slug) return null;
        const domain = asStr(w?.domain) || asStr(w?.account) || '';
        const account = asStr(w?.account);
        const label = deriveLabel(w?.label, domain, account);
        return {
          agent_slug: slug,
          agent_name: asStr(w?.agent_name) || asStr(w?.name) || slug.replace(/[-_]+/g, ' '),
          label,
          account,
          domain,
          reason: asStr(w?.reason) || reasonFor(label, account),
          detected_at: asStr(w?.detected_at) || asStr(w?.at),
        };
      })
      .filter((w): w is ConnectionWarning => w !== null);
  }
  // Derived fallback.
  return deriveWarnings(agents);
}

export function deriveWarnings(agents: AgentConnections[]): ConnectionWarning[] {
  const out: ConnectionWarning[] = [];
  for (const a of agents) {
    for (const need of a.needs) {
      if (need.status === 'unreachable') {
        out.push({
          agent_slug: a.slug,
          agent_name: a.name,
          label: need.label,
          account: need.account,
          domain: need.domain,
          reason: reasonFor(need.label, need.account),
          detected_at: null,
        });
      }
    }
  }
  return out;
}

/**
 * getConnectionStatus() - the owner-scoped reachability read for the signed-in
 * user: every connected account/app + per-agent needed-vs-reachable + warnings.
 * Calls GET /api/v2/me/connections with the caller's Supabase JWT. Returns null
 * (NOT an error) when the endpoint is not live yet or any read fails, so every
 * consumer can degrade to a calm not-set-up-yet state.
 */
export async function getConnectionStatus(): Promise<ConnectionStatus | null> {
  const { createClient } = await import('@/lib/supabase/server');
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return null;
  try {
    const res = await fetch(`${BACKEND}/api/v2/me/connections`, {
      headers: { authorization: `Bearer ${session.access_token}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as any;
    const connections = mapConnections(body?.connections);
    const agents = mapAgents(body?.agents);
    const warnings = mapWarnings(body?.warnings, agents);
    return { connections, agents, warnings, live: true };
  } catch {
    return null;
  }
}

/** Warnings scoped to one agent (drives the per-agent banner on /workflows/[slug]). */
export function warningsForAgent(status: ConnectionStatus | null, slug: string): ConnectionWarning[] {
  if (!status) return [];
  return status.warnings.filter((w) => w.agent_slug === slug);
}

export const REACH_PRESENTATION: Record<
  ReachState,
  { label: string; classes: string; dot: string }
> = {
  // Follows the run-state + remote-safety pattern: raw tailwind color with an
  // explicit dark: variant so it reads right under forced dark mode.
  reachable: {
    label: 'Reachable',
    classes: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
    dot: 'bg-emerald-500 dark:bg-emerald-400',
  },
  unreachable: {
    label: 'Not reachable',
    classes: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
    dot: 'bg-rose-500 dark:bg-rose-400',
  },
  unknown: {
    label: 'Not checked',
    classes: 'bg-ink-800 text-ink-300',
    dot: 'bg-ink-500',
  },
};
