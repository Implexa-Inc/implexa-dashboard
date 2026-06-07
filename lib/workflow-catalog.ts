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
  activity: WorkflowActivity;
  version: number | null;
  versions: WorkflowVersionEntry[];
  proposed_count: number;
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

// Shared mapper: raw workflow-detail object (from get_workflow or me/workflows)
// -> the dashboard WorkflowDetail shape.
function mapWorkflowDetail(w: any, slug: string, source: string): WorkflowDetail {
  const num = (v: unknown) => (typeof v === 'number' && v >= 0 ? v : 0);
  return {
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
  };
}
