// workflow-catalog.ts - server-only helpers that read the workflow artifacts
// (artifact_type='workflow') from the backend.
//
// WHY THIS EXISTS (the RLS constraint): workflow artifacts live in Supabase
// `aggregated_skills`, which is service-role-only RLS. The dashboard's
// anon/authenticated Supabase client reads ZERO rows from it. So we cannot
// fetch workflow steps directly from the dashboard's Supabase client. Instead
// we reuse the SAME public read path the marketing site (implexa.ai/workflows)
// uses: the backend's read-only MCP tools list_workflows / get_workflow, called
// over the /api/v2/mcp JSON-RPC endpoint with a public search token.
//
// Two consumers:
//   1. /workflows            (index - the user's workflow-routines as cards)
//   2. /workflows/[slug]     (detail - one workflow, full steps + outcome)
//
// Everything degrades gracefully (returns [] / null on any failure) so the
// pages never 500: the public token may be unset in some environments, and the
// backend tools live in a separate deploy.
//
// SWAP NOTE: when the backend ships a user-scoped workflows endpoint that also
// carries the authoritative remote verdict (see lib/remote-safety.ts and the
// report), this file is the single place to change the data source.

import type { WorkflowInputContract } from './workflow-input-contract';

const BACKEND = (
  process.env.NEXT_PUBLIC_IMPLEXA_API_URL || 'https://core.implexa.ai'
).replace(/\/$/, '');
// Server-only token (NOT NEXT_PUBLIC - never shipped to the browser). Mirrors
// the marketing site's IMPLEXA_PUBLIC_SEARCH_TOKEN. When unset, the catalog
// reads return empty and the Workflows view shows its empty state.
const TOKEN = process.env.IMPLEXA_PUBLIC_SEARCH_TOKEN ?? '';

export type WorkflowCapability = {
  id: string;
  name: string;
  why: string;
  install_hint: string;
  tool_prefix?: string | null;
};

export type WorkflowCard = {
  source: string;
  slug: string;
  name: string;
  description: string;
  vertical: string | null;
  cadence: string | null;
  primary_outcome: string | null;
  step_count: number;
  bound_step_count: number;
  capabilities: WorkflowCapability[];
  // catalog signals (activity proof + ranking for the first-run shelf)
  run_count: number;
  scheduled_count: number;
  curated: boolean;
  unproven: boolean;
  last_seen_at: string | null;
};

export type WorkflowStepRefSummary = {
  name: string;
  description: string | null;
  preview: string | null;
};

export type WorkflowBuildEvidence = {
  version?: number;
  scope?: string;
  source?: string;
  provenRuns?: number;
  verifiedRuns?: number;
  deliveredRuns?: number;
  partialRuns?: number;
  failedRuns?: number;
  ratedRuns?: number;
  latestAt?: string | null;
  proof?: 'verified' | 'delivered' | 'partial' | 'failed' | 'none' | string;
  bindableSteps?: number;
  boundSteps?: number;
  provenSteps?: number;
  verifiedSteps?: number;
  patternSteps?: number;
  unprovenBoundSteps?: number;
  summary?: string;
  status?: string;
};

export type WorkflowStep = {
  order: number;
  kind: string; // 'skill' | 'tool' | 'decision'
  label: string;
  detail: string | null;
  ref: { source: string; slug: string } | null;
  ref_summary: WorkflowStepRefSummary | null;
  same_as_step: number | null;
  gap: boolean;
  fallbacks: string[];
  build_evidence: WorkflowBuildEvidence | null;
  proven_pattern: {
    workflow: { source: string; slug: string; name: string };
    source_step_order: number | null;
    source_step_label: string;
    ref: { source: string; slug: string } | null;
    relevance: number | null;
    evidence: WorkflowBuildEvidence;
  } | null;
};

export type WorkflowActivity = {
  run_count: number;
  apply_count: number;
  scheduled_count: number;
  last_run_at: string | null;
};

export type WorkflowVersionEntry = {
  version: number;
  summary: string | null;
  source: string;
  at: string;
};

export type WorkflowDetail = {
  id: string;
  source: string;
  slug: string;
  name: string;
  description: string;
  job: string;
  persona: string | null;
  vertical: string | null;
  cadence: string | null;
  primary_outcome: string | null;
  signals: string[];
  steps: WorkflowStep[];
  caveat: string | null;
  sources: string[];
  capabilities: WorkflowCapability[];
  content: string | null;
  source_url: string | null;
  last_seen_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  generated: boolean;
  unproven: boolean;
  build_evidence: WorkflowBuildEvidence | null;
  activity: WorkflowActivity;
  version: number | null;
  versions: WorkflowVersionEntry[];
  proposed_count: number;
  workflow_version_id: string | null;
  input_contract: WorkflowInputContract | null;
  input_contract_digest: string | null;
  run_input_version_source?: 'installed' | 'live';
  update_available?: {
    workflow_version_id: string;
    version: number;
    input_contract: WorkflowInputContract | null;
    input_contract_digest: string | null;
    state: string;
  } | null;
};

// The backend wraps MCP responses as Server-Sent-Events: `event: message\n
// data: {json}\n\n`. Tolerate plain JSON as a fallback.
function parseMcpResponse(text: string): unknown {
  const dataLine = text.split('\n').find((ln) => ln.startsWith('data: '));
  const jsonStr = dataLine ? dataLine.slice(6) : text;
  return JSON.parse(jsonStr);
}

type McpEnvelope = { result?: { content?: Array<{ text?: string }> } };

async function callMcpTool<T>(
  name: string,
  args: Record<string, unknown>,
  revalidate: number,
): Promise<T | null> {
  if (!TOKEN) return null;
  try {
    const upstream = await fetch(`${BACKEND}/api/v2/mcp`, {
      method: 'POST',
      headers: {
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
        authorization: `Bearer ${TOKEN}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name, arguments: args },
      }),
      signal: AbortSignal.timeout(10000),
      next: { revalidate },
    });
    if (!upstream.ok) return null;
    const text = await upstream.text();
    const body = parseMcpResponse(text) as McpEnvelope;
    const raw = body?.result?.content?.[0]?.text;
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function mapCapabilities(raw: unknown): WorkflowCapability[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((c: any) => ({
    id: String(c?.id ?? ''),
    name: String(c?.name ?? ''),
    why: String(c?.why ?? ''),
    install_hint: String(c?.install_hint ?? ''),
    tool_prefix: typeof c?.tool_prefix === 'string' ? c.tool_prefix : null,
  }));
}

/**
 * listWorkflows() - the full public workflow catalog. Cached 1h (the catalog
 * changes only when workflows are seeded or generated). Used by /workflows to
 * decide which of the user's routines run a workflow (slug match) and to render
 * cards without an N+1 detail fetch.
 */
export async function listWorkflows(): Promise<WorkflowCard[]> {
  type Resp = { ok: boolean; workflows?: any[] };
  const resp = await callMcpTool<Resp>('list_workflows', {}, 3600);
  if (!resp?.ok || !Array.isArray(resp.workflows)) return [];
  return resp.workflows.map((w) => ({
    source: String(w.source ?? 'web-seed'),
    slug: String(w.slug ?? ''),
    name: String(w.name ?? String(w.slug ?? '').replace(/-/g, ' ')),
    description: String(w.description ?? ''),
    vertical: w.vertical ?? null,
    cadence: w.cadence ?? null,
    primary_outcome: w.primary_outcome ?? null,
    step_count: typeof w.step_count === 'number' ? w.step_count : 0,
    bound_step_count:
      typeof w.bound_step_count === 'number' ? w.bound_step_count : 0,
    capabilities: mapCapabilities(w.capabilities),
    run_count: typeof w.run_count === 'number' ? w.run_count : 0,
    scheduled_count: typeof w.scheduled_count === 'number' ? w.scheduled_count : 0,
    curated: w.curated === true,
    unproven: w.unproven === true,
    last_seen_at: w.last_seen_at ?? null,
  }));
}

export type MyWorkflowCard = {
  workflow_id: string;
  source: string;
  slug: string;
  name: string;
  description: string;
  vertical: string | null;
  cadence: string | null;
  primary_outcome: string | null;
  step_count: number;
  origin: 'captured' | 'generated';
  run_count: number;
  scheduled_count: number;
  is_scheduled: boolean;
  last_run_at: string | null;
  shared: boolean;
  unproven: boolean;
};

/**
 * listMyWorkflows() - the signed-in user's OWN workflows (captured + generated),
 * INCLUDING private ones the public catalog hides. Calls the authed backend
 * route GET /api/v2/me/workflows with the caller's Supabase session JWT (so it's
 * owner-scoped, never anyone else's). Degrades to [] on any failure.
 */
export async function listMyWorkflows(): Promise<MyWorkflowCard[]> {
  const { createClient } = await import('@/lib/supabase/server');
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return [];
  try {
    const res = await fetch(`${BACKEND}/api/v2/me/workflows`, {
      headers: { authorization: `Bearer ${session.access_token}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { workflows?: MyWorkflowCard[] };
    return Array.isArray(body.workflows) ? body.workflows : [];
  } catch {
    return [];
  }
}

export type DismissedAgent = {
  slug: string;
  name: string;
  source: string;
  dismissedAt: string | null;
  /** This archived agent can STILL FIRE (the caller has a schedule on it).
   *  Archiving stops schedules, so this is normally false — but archive is the
   *  one place things are out of sight, so when it IS true the row has to say
   *  so out loud rather than hide a running agent. */
  isLive?: boolean;
};

/**
 * listDismissedWorkflows() - the signed-in user's ARCHIVED agents (the ones they
 * removed from their list). Calls GET /api/v2/me/workflows/dismissed with the
 * session JWT (owner-scoped). Powers the "Archived" restore section. Degrades
 * to [] on any failure.
 */
export async function listDismissedWorkflows(): Promise<DismissedAgent[]> {
  const { createClient } = await import('@/lib/supabase/server');
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return [];
  try {
    const res = await fetch(`${BACKEND}/api/v2/me/workflows/dismissed`, {
      headers: { authorization: `Bearer ${session.access_token}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { dismissed?: DismissedAgent[] };
    return Array.isArray(body.dismissed) ? body.dismissed : [];
  } catch {
    return [];
  }
}

/**
 * listFavoriteSlugs() - the signed-in user's STARRED agent slugs, so the agent
 * list can float favorites to the top. GET /api/v2/me/workflows/favorites,
 * owner-scoped. Degrades to [] on any failure (a favorites hiccup must never
 * break the list).
 */
export async function listFavoriteSlugs(): Promise<string[]> {
  const { createClient } = await import('@/lib/supabase/server');
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return [];
  try {
    const res = await fetch(`${BACKEND}/api/v2/me/workflows/favorites`, {
      headers: { authorization: `Bearer ${session.access_token}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { favorites?: string[] };
    return Array.isArray(body.favorites) ? body.favorites : [];
  } catch {
    return [];
  }
}

export type SuggestedAgent = {
  kind: 'recommended' | 'popular';
  title: string;
  reason: string;
  skill_slug: string | null;
  workflow_slug: string | null;
  suggested_intent: string | null;
  score: number | null;
};

/**
 * listSuggestedAgents() - the always-on "Suggested for you" shelf. Calls the
 * authed backend GET /api/v2/me/suggested-agents, which blends personalized
 * recommendations with popular-workflow cold-start padding and excludes agents
 * the user already has. Owner-scoped via the session JWT. Degrades to [].
 */
export async function listSuggestedAgents(limit = 6): Promise<SuggestedAgent[]> {
  const { createClient } = await import('@/lib/supabase/server');
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return [];
  try {
    const res = await fetch(`${BACKEND}/api/v2/me/suggested-agents?limit=${limit}`, {
      headers: { authorization: `Bearer ${session.access_token}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { suggestions?: SuggestedAgent[] };
    return Array.isArray(body.suggestions) ? body.suggestions : [];
  } catch {
    return [];
  }
}

/**
 * getWorkflow(slug, source) - full detail for one workflow. Cached 10m. source
 * defaults to 'web-seed' (the seeded catalog); 'generated' for user-generated
 * workflows.
 */
export async function getWorkflow(
  slug: string,
  source = 'web-seed',
): Promise<WorkflowDetail | null> {
  type Resp = { ok: boolean; workflow?: any };
  const resp = await callMcpTool<Resp>('get_workflow', { slug, source }, 600);
  if (!resp?.ok || !resp.workflow) return null;
  return mapWorkflowDetail(resp.workflow, slug, source);
}

/**
 * getMyWorkflow(slug, source) - full detail for ONE of the caller's OWN
 * workflows, including a PRIVATE (unshared) one the public get_workflow 404s.
 * Calls the authed backend route GET /api/v2/me/workflows/:slug with the
 * session JWT (owner-scoped). The dashboard detail page falls back to this when
 * the public read returns null.
 */
export async function getMyWorkflow(slug: string, source = 'generated'): Promise<WorkflowDetail | null> {
  const { createClient } = await import('@/lib/supabase/server');
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return null;
  try {
    const res = await fetch(
      `${BACKEND}/api/v2/me/workflows/${encodeURIComponent(slug)}?source=${encodeURIComponent(source)}`,
      { headers: { authorization: `Bearer ${session.access_token}` }, cache: 'no-store', signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) return null;
    const body = (await res.json()) as { workflow?: any };
    if (!body?.workflow) return null;
    return mapWorkflowDetail(body.workflow, slug, source);
  } catch {
    return null;
  }
}

/**
 * The versioned run-input identity every Run surface must hand <AgentActions/>.
 *
 * WHY THIS IS ITS OWN THING: a workflow version that declares an input contract
 * makes POST /api/v2/me/run-requests REFUSE any run that does not carry the
 * envelope (backend resolveVersionedRunInputs → `versioned_input_envelope_required`).
 * <AgentActions/> can only render the "Run inputs" section — and therefore can
 * only build that envelope — when it is given all three of these. A surface that
 * renders Run now without them offers a button that cannot succeed, and the user
 * gets a refusal with nowhere on that screen to supply the inputs. That is exactly
 * what the activation card did until this type existed to be threaded through it.
 */
export type WorkflowRunInputs = {
  workflowVersionId: string | null;
  inputContract: WorkflowInputContract | null;
  inputContractDigest: string | null;
};

/**
 * The ONE derivation, so no Run surface invents its own field mapping. Takes a
 * REAL workflow: "I could not read the workflow" is expressed by getWorkflowRunInputs
 * returning null, never by feeding nothing in here and getting back a record of
 * nulls that reads like a confident "declares no inputs".
 */
export function workflowRunInputs(w: WorkflowDetail): WorkflowRunInputs {
  return {
    workflowVersionId: w.workflow_version_id ?? null,
    inputContract: w.input_contract ?? null,
    inputContractDigest: w.input_contract_digest ?? null,
  };
}

/**
 * The two reads getWorkflowRunInputs chains, injectable so the CHAIN can be
 * tested. It is not a formality: the branch that matters most — every read
 * missing resolving to null rather than to a record of nulls — is unreachable
 * from a test that can only exercise the real network path, and that branch is
 * precisely the one whose collapse re-creates the bug this file exists to fix.
 */
export type WorkflowReaders = {
  mine: (slug: string, source: string) => Promise<WorkflowDetail | null>;
  shared: (slug: string, source: string) => Promise<WorkflowDetail | null>;
};

/**
 * Run-input identity for a surface that holds only a slug (the activation
 * screen), where the agent detail page already holds the whole WorkflowDetail.
 *
 * Owner read FIRST, for the same reason the detail page does it: getWorkflow's
 * public catalog read is cached 10 minutes, long enough to hand back a version id
 * that a revise has already superseded — and a superseded id is not a smaller
 * envelope, it is a hard `workflow_version_mismatch` refusal.
 *
 * Returns null when the workflow could NOT be read, which is deliberately NOT the
 * same value as a workflow that declares no inputs (that resolves to a record of
 * nulls). Collapsing the two would let a failed read render as the confident claim
 * "this agent needs no inputs" — see the caller, which renders the difference.
 */
export async function getWorkflowRunInputs(
  slug: string,
  source = 'generated',
  readers: WorkflowReaders = { mine: getMyWorkflow, shared: getWorkflow },
): Promise<WorkflowRunInputs | null> {
  const w = (await readers.mine(slug, source === 'web-seed' ? 'generated' : source))
    || (await readers.mine(slug, 'community'))
    || (await readers.shared(slug, source));
  return w ? workflowRunInputs(w) : null;
}

// Shared mapper: raw workflow-detail object (from get_workflow or me/workflows)
// -> the dashboard WorkflowDetail shape.
function mapWorkflowDetail(w: any, slug: string, source: string): WorkflowDetail {
  const num = (v: unknown) => (typeof v === 'number' && v >= 0 ? v : 0);
  return {
    id: String(w.id ?? ''),
    source: String(w.source ?? source),
    slug: String(w.slug ?? slug),
    name: String(w.name ?? String(w.slug ?? slug).replace(/-/g, ' ')),
    description: String(w.description ?? ''),
    job: String(w.job ?? w.description ?? ''),
    persona: w.persona ?? null,
    vertical: w.vertical ?? null,
    cadence: w.cadence ?? null,
    primary_outcome: w.primary_outcome ?? null,
    signals: Array.isArray(w.signals) ? w.signals : [],
    steps: Array.isArray(w.steps)
      ? w.steps.map((s: any) => {
          const rs = s?.ref_summary;
          return {
            order: typeof s?.order === 'number' ? s.order : 0,
            kind: s?.kind || 'skill',
            label: s?.label || '',
            detail: typeof s?.detail === 'string' && s.detail ? s.detail : null,
            ref:
              s?.ref && s.ref.slug
                ? { source: String(s.ref.source ?? ''), slug: String(s.ref.slug) }
                : null,
            ref_summary:
              rs && typeof rs === 'object'
                ? {
                    name: String(rs.name ?? ''),
                    description:
                      typeof rs.description === 'string' ? rs.description : null,
                    preview:
                      typeof rs.preview === 'string' && rs.preview
                        ? rs.preview
                        : null,
                  }
                : null,
            same_as_step:
              typeof s?.same_as_step === 'number' ? s.same_as_step : null,
            gap: s?.gap === true,
            fallbacks: Array.isArray(s?.fallbacks) ? s.fallbacks : [],
            build_evidence:
              s?.build_evidence && typeof s.build_evidence === 'object'
                ? s.build_evidence
                : null,
            proven_pattern:
              s?.proven_pattern && typeof s.proven_pattern === 'object' && s.proven_pattern.workflow
                ? s.proven_pattern
                : null,
          };
        })
      : [],
    caveat: w.caveat ?? null,
    sources: Array.isArray(w.sources) ? w.sources : [],
    capabilities: mapCapabilities(w.capabilities),
    content: w.content ?? null,
    source_url: w.source_url ?? null,
    last_seen_at: w.last_seen_at ?? null,
    created_at: w.created_at ?? null,
    updated_at: w.updated_at ?? null,
    generated: w.generated === true,
    unproven: w.unproven === true,
    build_evidence:
      w.build_evidence && typeof w.build_evidence === 'object'
        ? w.build_evidence
        : null,
    activity: {
      run_count: num(w.activity?.run_count),
      apply_count: num(w.activity?.apply_count),
      scheduled_count: num(w.activity?.scheduled_count),
      last_run_at: w.activity?.last_run_at ?? null,
    },
    version: typeof w.version === 'number' ? w.version : null,
    versions: Array.isArray(w.versions)
      ? w.versions
          .filter((v: any) => v && typeof v.version === 'number')
          .map((v: any) => ({
            version: v.version as number,
            summary: typeof v.summary === 'string' ? v.summary : null,
            source: String(v.source ?? 'manual'),
            at: String(v.at ?? ''),
          }))
      : [],
    proposed_count: num(w.proposed_count),
    workflow_version_id: typeof w.workflow_version_id === 'string' ? w.workflow_version_id : null,
    input_contract: w.input_contract?.version === 1 && Array.isArray(w.input_contract.fields) ? w.input_contract : null,
    input_contract_digest: typeof w.input_contract_digest === 'string' ? w.input_contract_digest : null,
    run_input_version_source: w.run_input_version_source === 'installed' ? 'installed' : 'live',
    update_available: w.update_available
      && typeof w.update_available.workflow_version_id === 'string'
      && typeof w.update_available.input_contract_digest === 'string'
      ? {
          workflow_version_id: w.update_available.workflow_version_id,
          version: Number(w.update_available.version) || 0,
          input_contract: w.update_available.input_contract?.version === 1
            && Array.isArray(w.update_available.input_contract.fields)
            ? w.update_available.input_contract : null,
          input_contract_digest: w.update_available.input_contract_digest,
          state: String(w.update_available.state || 'available'),
        }
      : null,
  };
}
