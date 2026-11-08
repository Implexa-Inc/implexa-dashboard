/**
 * lib/activation-core.ts — the PURE slice of lib/activation.ts.
 *
 * lib/activation.ts imports 'server-only', which makes it unimportable from
 * node:test — the same reason lib/agents-feed-core.ts was split from
 * lib/agents-home.ts. This module holds the checklist mapper (shared by the
 * legacy GET /agents/:slug/activation read and the agent-detail envelope) with
 * type-only imports, so both the mapper and everything downstream of it stay
 * unit-testable.
 */

import type {
  ActivationChecklist,
  ActivationState,
  ActivationStep,
  ActivationVerification,
  AgentRequirementsPayload,
  CapabilityGap,
  AgentMachineTools,
  AgentSetupContext,
  AgentSetupTarget,
  AgentMacAccess,
} from './activation';
import { parseMarketplaceExecutionRequirements } from './marketplace-execution-requirements.ts';

type ToolService = AgentRequirementsPayload['services'][number];
export function managedToolConnection(report: AgentMacAccess | null | undefined,
  target: AgentSetupTarget | null | undefined, domain: string) {
  const observations = report?.toolConnections;
  if (!target || report?.ok !== true || report.slug !== target.slug
    || report.context?.accountId !== target.accountId || report.context.versionId !== target.versionId
    || report.context.requiredRouteClass !== target.requiredRouteClass
    || observations?.available !== true || observations.versionId !== target.versionId
    || !observations.machineId || !Array.isArray(observations.services)) return null;
  return observations.services.find(row => row.required === false && row.domain === domain
    && ['reachable', 'unreachable', 'unknown'].includes(row.status)) || null;
}

export function apiKeyAccessReady(service: ToolService, grants: Record<string, boolean> | null): boolean {
  return !!service.provider && service.keysReadable !== false && service.keyOnMachine && grants?.[service.provider] === true;
}
export function toolAccessReady(service: ToolService, grants: Record<string, boolean> | null, structured = true): boolean {
  const mode = service.accessMode ?? (service.apiKeyRequired === false ? 'browser' : service.apiKeyRequired === true ? 'api' : 'unknown');
  const browser = service.browserSession?.status === 'reachable';
  if (mode === 'browser') return browser;
  if (mode === 'api_and_browser') return browser && apiKeyAccessReady(service, grants);
  return (mode === 'api' || !structured && mode === 'unknown') && apiKeyAccessReady(service, grants);
}

function machineTools(value: unknown): AgentMachineTools | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (v.contract_type !== 'machine_capability_requirements' || v.contract_version !== 1
    || typeof v.digest !== 'string' || !/^[a-f0-9]{64}$/.test(v.digest)
    || !Array.isArray(v.requirements) || v.requirements.length < 1 || v.requirements.length > 32) return null;
  const requirements: AgentMachineTools['requirements'] = [];
  const ids = new Set<string>();
  for (const raw of v.requirements) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const r = raw as Record<string, unknown>;
    if (typeof r.id !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,79}$/.test(r.id) || ids.has(r.id)
      || typeof r.kind !== 'string' || typeof r.label !== 'string' || !r.label.trim() || r.label.length > 200
      || typeof r.required !== 'boolean') return null;
    ids.add(r.id);
    // Only software belongs in this list. Disk, network and cache readiness
    // remain in the existing preflight, never inferred as external tools.
    if (['managed_node_runtime', 'npm_runtime', 'local_cli', 'media_tool', 'cli_auth'].includes(r.kind)) {
      requirements.push({ id: r.id, kind: r.kind, label: r.label, required: r.required });
    }
  }
  return { digest: v.digest, requirements };
}

export function parseAgentSetupContext(value: unknown): AgentSetupContext | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const c = value as AgentSetupContext;
  if (typeof c.accountId !== 'string' || !/^[a-f0-9-]{36}$/.test(c.accountId)
    || typeof c.versionId !== 'string' || !c.versionId || c.versionId.length > 100
    || !['headless', 'browser', 'computer_use'].includes(c.requiredRouteClass)
    || typeof c.needsBrowser !== 'boolean' || typeof c.needsComputerUse !== 'boolean'
    || !Array.isArray(c.requiredGroups) || !Array.isArray(c.missingRequiredGroups)
    || c.requiredGroups.length > 32 || c.missingRequiredGroups.length > 32
    || [...c.requiredGroups, ...c.missingRequiredGroups].some((x) => typeof x !== 'string' || !/^[a-z_]{1,60}$/.test(x))
    || c.missingRequiredGroups.some((x) => !c.requiredGroups.includes(x))
    || c.requiredRouteClass !== (c.needsComputerUse ? 'computer_use' : c.needsBrowser ? 'browser' : 'headless')) return null;
  return { accountId: c.accountId, versionId: c.versionId, requiredRouteClass: c.requiredRouteClass,
    needsBrowser: c.needsBrowser, needsComputerUse: c.needsComputerUse,
    requiredGroups: [...c.requiredGroups], missingRequiredGroups: [...c.missingRequiredGroups] };
}

/**
 * Shared mapper: raw checklist payload (from /agents/:slug/activation or the
 * agent-detail envelope's checklist section) -> ActivationChecklist, with the
 * same defensive defaults either way. null when the payload isn't a checklist.
 */
export function mapActivationChecklist(b: Record<string, unknown> | null | undefined, slug: string): ActivationChecklist | null {
  if (!b?.ok) return null;
  return {
    slug: String(b.slug ?? slug),
    setupContext: parseAgentSetupContext(b.setupContext),
    name: String(b.name ?? slug),
    summary: (b.summary as string) ?? null,
    state: (b.state as ActivationState) ?? 'created',
    mode: (b.mode as ActivationChecklist['mode']) ?? undefined,
    requiresLocal: !!b.requiresLocal,
    nextRunAt: (b.nextRunAt as string) ?? null,
    // The activation card gates Run on this: a generated agent with unanswered
    // config questions must surface them at the Run moment, not fire blind.
    pendingQuestions: Number(b.pendingQuestions ?? 0),
    // Absent on an older backend → fall back to the total, which is exactly the
    // pre-change behaviour (every question was required).
    blockingQuestions: b.blockingQuestions === undefined ? undefined : Number(b.blockingQuestions),
    optionalQuestions: Number(b.optionalQuestions ?? 0),
    readyToRun: b.readyToRun === undefined ? undefined : !!b.readyToRun,
    // Absent on an older backend → [], so the section simply doesn't render.
    capabilityGaps: Array.isArray(b.capabilityGaps)
      ? (b.capabilityGaps as unknown[]).filter((g): g is CapabilityGap =>
          !!g && typeof (g as CapabilityGap).capability === 'string')
      : [],
    requirements: (b.requirements as AgentRequirementsPayload) ?? undefined,
    executionRequirements: parseMarketplaceExecutionRequirements(b.executionRequirements),
    machineTools: machineTools(b.machineCapabilityContract),
    source: (b.source as string) ?? 'generated',
    canActivate: !!b.canActivate,
    stepsLeft: Number(b.stepsLeft ?? 0),
    steps: Array.isArray(b.steps) ? (b.steps as ActivationStep[]) : [],
    // Absent (older backend) → treat as verified so the badge never regresses.
    verification: (b.verification as ActivationVerification) ?? { verified: true, checks: [] },
  };
}
