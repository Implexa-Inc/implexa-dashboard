// Shared client types + helpers for the "Here's the plan — change anything?"
// step (2026-07-23). The dashboard NEVER chooses vendors itself: it expresses
// the user's preferences and re-asks the backend, which resolves them into the
// authoritative stack. So the only client state is the list of preferences; the
// returned plan is the source of truth for what's rendered.

export type ToolChoice = {
  id: string;
  label: string;
  accessMode: 'api_key' | 'browser_login' | 'local_tool' | 'none' | string;
  accessModeLabel: string;
  costNote: string | null;
};

export type PlanCapability = {
  id: string;
  label: string;
  purpose: string;
  requiredness: 'required_to_deliver' | 'recommended' | 'optional';
  recommendedTool: ToolChoice | null;
  alternatives: ToolChoice[];
  selectedToolId: string | null;
  /** Set when the capability has NO viable tool — an explicit gap, never a substitute. */
  unresolved?: { reason: string };
};

export type AgentPlan = {
  intent: string;
  proposedName: string;
  proposedDescription: string;
  capabilities: PlanCapability[];
  toolPreferences: string[];
  toolUnavailable: string[];
  overridesApplied: { tool: string; toolLabel: string; capabilities: string[] }[];
  unresolvedOverrides: string[];
  draftSteps: { order: number; capability: string; label: string; modelOnly: boolean }[];
};

/** POST /api/agents/plan-preview — the zero-write draft plan. */
export async function fetchPlanPreview(
  intent: string,
  toolPreferences: string[] = [],
  toolUnavailable: string[] = [],
): Promise<AgentPlan> {
  const res = await fetch('/api/agents/plan-preview', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ intent, toolPreferences, toolUnavailable }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) throw new Error(data?.error || 'could not build the plan');
  return data as AgentPlan;
}

/** POST /api/agents/create — enqueue the build AFTER the user accepts the plan. */
export async function createAgentBuild(input: {
  intent: string;
  toolPreferences?: string[];
  toolUnavailable?: string[];
  mode?: string;
  cron?: string;
  timezone?: string;
}): Promise<{ ok: boolean; error?: string; request?: unknown }> {
  const res = await fetch('/api/agents/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) return { ok: false, error: data?.error || 'enqueue failed' };
  return { ok: true, request: data.request };
}

/** A stable "use <label>" preference string the backend's _resolveToolName parses. */
export function preferenceFor(toolLabel: string): string {
  return `use ${toolLabel}`;
}
