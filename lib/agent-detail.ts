/**
 * lib/agent-detail.ts — the ONE authenticated read behind /workflows/[slug].
 *
 * GET /api/v2/me/agents/:slug/detail returns everything the agent page needs
 * in a single envelope: the workflow (owner-visibility + installed-version
 * authority applied server-side), activation checklist, THIS agent's
 * connection warnings, the owner/private grade, judge policy, schedules, the
 * Runs-tab rows, and the raw run/revise lifecycle rows. It replaces the page's
 * former waterfall: getMyWorkflow ×2 → getWorkflow ×2 → getConnectionStatus
 * (full roster) → getActivationChecklist → run_requests/skill_runs reads →
 * getMyAgents (full roster, for ONE grade) → /agents/:slug/grade.
 *
 * Honesty contract (same as lib/agents-feed-core.ts): 'ready' vs 'not_found'
 * vs 'unavailable' are distinct. A dead backend must never render as a
 * missing agent, and a missing agent must never render as an empty page.
 *
 * The mapped sections reuse the EXACT mappers the legacy reads used —
 * mapWorkflowDetail, mapActivationChecklist, buildInboxItems — so what each
 * tab shows is byte-identical to the pre-envelope page.
 *
 * Takes the caller's JWT as an argument: the page already resolved the session
 * once; helpers must not re-run getSession().
 */

// Relative, alias-free imports on purpose: node:test resolves no '@/' alias,
// and this reader must stay unit-testable (lib/agent-detail.test.ts).
import { mapWorkflowDetail, type WorkflowDetail } from './workflow-catalog.ts';
import { mapActivationChecklist } from './activation-core.ts';
import type { ActivationChecklist } from './activation';
import { buildInboxItems, oneLine } from './inbox-items.ts';
import type { RunRow } from './run-state';
import type { ConnectionWarning } from './connection-warning-types';
import type { InboxItem } from '../app/(dashboard)/inbox/inbox-list';
import type { Recommendation } from '../app/(dashboard)/_components/next-agent-cards';

const BACKEND = (process.env.NEXT_PUBLIC_IMPLEXA_API_URL || 'https://core.implexa.ai').replace(/\/$/, '');

/** One row of the user's schedules for this agent (the page's Routine shape). */
export type AgentRoutine = {
  id: string;
  skill_slug: string;
  schedule_nl: string;
  cron_expression: string | null;
  trigger_type?: string | null;
  fire_at?: string | null;
  status: 'active' | 'paused' | 'failed';
  last_run_at: string | null;
  run_count: number;
  destination: { type: string; target?: string };
  claude_task_id: string | null;
};

export type AgentGrade = {
  hasGrade: boolean;
  rate: number;
  label: 'reliable' | 'mixed' | 'unproven';
  runs: number;
  confidence: number;
};

/** Raw in-flight rows — the page derives queued/running + revise-pending itself. */
export type AgentLifecycle = {
  requests: Array<{ status: string; kind: string; created_at: string }>;
  runningRun: boolean;
};

/**
 * Sections the backend could NOT read. A name here means "unknown", never
 * "empty" — the page must render it as unavailable and must not offer an
 * action whose safety depends on the section it could not read.
 */
export type AgentSection =
  | 'activation' | 'connections' | 'grade' | 'judge_policy'
  | 'schedules' | 'runs' | 'lifecycle' | 'latest_run' | 'own_generated' | 'dismissed';

export type AgentDetail = {
  workflow: WorkflowDetail;
  checklist: ActivationChecklist | null;
  connectionWarnings: ConnectionWarning[];
  grade: AgentGrade | null;
  judgePolicy: string | null;
  routines: AgentRoutine[];
  runs: InboxItem[];
  lifecycle: AgentLifecycle | null;
  unavailable: string[];
  /**
   * `unavailable` as a predicate. Read THIS rather than testing a section's
   * value for emptiness: a null checklist and an unreadable checklist are the
   * same value and opposite facts.
   */
  isUnavailable: (section: AgentSection) => boolean;
};

export type AgentDetailResult =
  | { status: 'ready'; detail: AgentDetail }
  | { status: 'not_found' }
  | { status: 'unavailable' };

function asStr(v: unknown): string | null {
  return typeof v === 'string' && v ? v : null;
}

function mapEnvelopeWarnings(raw: unknown): ConnectionWarning[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((w: any): ConnectionWarning | null => {
      const slug = asStr(w?.agent_slug);
      if (!slug) return null;
      const domain = asStr(w?.domain) || asStr(w?.account) || '';
      return {
        agent_slug: slug,
        agent_name: asStr(w?.agent_name) || slug.replace(/[-_]+/g, ' '),
        label: asStr(w?.label) || domain,
        account: asStr(w?.account),
        domain,
        reason: asStr(w?.reason) || 'connection needs attention',
        detected_at: asStr(w?.detected_at),
      };
    })
    .filter((w): w is ConnectionWarning => w !== null);
}

function mapRoutines(raw: unknown): AgentRoutine[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r: any) => r && typeof r.id === 'string' && typeof r.skill_slug === 'string')
    .map((r: any): AgentRoutine => ({
      id: r.id,
      skill_slug: r.skill_slug,
      schedule_nl: String(r.schedule_nl ?? ''),
      cron_expression: r.cron_expression ?? null,
      trigger_type: r.trigger_type ?? null,
      fire_at: r.fire_at ?? null,
      status: r.status === 'paused' || r.status === 'failed' ? r.status : 'active',
      last_run_at: r.last_run_at ?? null,
      run_count: Number(r.run_count ?? 0),
      destination: r.destination && typeof r.destination === 'object' ? r.destination : { type: 'dashboard' },
      claude_task_id: r.claude_task_id ?? null,
    }));
}

function mapRuns(raw: any, workflow: WorkflowDetail): InboxItem[] {
  const rows: RunRow[] = Array.isArray(raw?.items) ? raw.items : [];
  const recsById = new Map<string, Recommendation[]>();
  for (const [id, recs] of Object.entries(raw?.recommendations ?? {})) {
    if (Array.isArray(recs)) recsById.set(id, recs as Recommendation[]);
  }
  const judgmentByRun = new Map<string, NonNullable<InboxItem['judgment']>>();
  for (const [id, j] of Object.entries(raw?.judgments ?? {})) {
    const row = j as { id?: string; verdict?: string; summary?: string | null; next_action?: string | null } | null;
    if (row && typeof row.id === 'string' && typeof row.verdict === 'string') {
      judgmentByRun.set(id, {
        id: row.id,
        verdict: row.verdict as NonNullable<InboxItem['judgment']>['verdict'],
        summary: row.summary ?? null,
        next_action: row.next_action ?? null,
      });
    }
  }
  return buildInboxItems(
    rows,
    () => ({ name: workflow.name, why: oneLine(workflow.primary_outcome) || oneLine(workflow.description) }),
    recsById,
    judgmentByRun,
  );
}

function mapGrade(raw: unknown): AgentGrade | null {
  const g = raw as AgentGrade | null;
  return g && g.hasGrade ? g : null;
}

/**
 * The single detail-envelope read. `token` is the caller's Supabase access
 * token, already in hand from the page's one getSession(). `fetchImpl` is
 * injectable for tests.
 */
export async function getAgentDetail(
  slug: string,
  token: string,
  opts: { source?: string; fetchImpl?: typeof fetch } = {},
): Promise<AgentDetailResult> {
  const doFetch = opts.fetchImpl ?? fetch;
  try {
    const qs = opts.source ? `?source=${encodeURIComponent(opts.source)}` : '';
    const res = await doFetch(`${BACKEND}/api/v2/me/agents/${encodeURIComponent(slug)}/detail${qs}`, {
      headers: { authorization: `Bearer ${token}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 404) return { status: 'not_found' };
    if (!res.ok) return { status: 'unavailable' };
    const body = (await res.json()) as any;
    if (!body?.ok || !body.workflow) return { status: 'unavailable' };

    const workflow = mapWorkflowDetail(body.workflow, slug, opts.source || 'web-seed');
    const unavailable: string[] = Array.isArray(body.unavailable)
      ? body.unavailable.filter((s: unknown): s is string => typeof s === 'string')
      : [];
    const unavailableSet = new Set(unavailable);
    return {
      status: 'ready',
      detail: {
        isUnavailable: (section: AgentSection) => unavailableSet.has(section),
        workflow,
        checklist: mapActivationChecklist(body.checklist ?? null, slug),
        connectionWarnings: mapEnvelopeWarnings(body.connections?.warnings),
        grade: mapGrade(body.grade),
        judgePolicy: asStr(body.judgePolicy),
        routines: mapRoutines(body.schedules),
        runs: mapRuns(body.runs, workflow),
        lifecycle: body.lifecycle && Array.isArray(body.lifecycle.requests)
          ? { requests: body.lifecycle.requests, runningRun: body.lifecycle.runningRun === true }
          : null,
        unavailable,
      },
    };
  } catch {
    return { status: 'unavailable' };
  }
}
