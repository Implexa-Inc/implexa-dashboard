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
} from './activation';
import { parseMarketplaceExecutionRequirements } from './marketplace-execution-requirements.ts';

/**
 * Shared mapper: raw checklist payload (from /agents/:slug/activation or the
 * agent-detail envelope's checklist section) -> ActivationChecklist, with the
 * same defensive defaults either way. null when the payload isn't a checklist.
 */
export function mapActivationChecklist(b: Record<string, unknown> | null | undefined, slug: string): ActivationChecklist | null {
  if (!b?.ok) return null;
  return {
    slug: String(b.slug ?? slug),
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
    source: (b.source as string) ?? 'generated',
    canActivate: !!b.canActivate,
    stepsLeft: Number(b.stepsLeft ?? 0),
    steps: Array.isArray(b.steps) ? (b.steps as ActivationStep[]) : [],
    // Absent (older backend) → treat as verified so the badge never regresses.
    verification: (b.verification as ActivationVerification) ?? { verified: true, checks: [] },
  };
}
