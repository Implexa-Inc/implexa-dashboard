import {
  isManagerTrainingRequirements,
  isTrainingSuccessorProjection,
  type ManagerTrainingRequirements,
} from './training-local-ingress.ts';

export type ManagerTrainingRunPreflight =
  | { state: 'ready'; requirements: ManagerTrainingRequirements }
  | {
    state: 'training_required';
    requirements: ManagerTrainingRequirements;
    hasEligiblePredecessor: boolean;
  }
  | { state: 'unavailable' };

/**
 * Interpret only the backend-owned, immutable-version training projection.
 * This is an early UX gate; request creation repeats the authoritative check.
 */
export function managerTrainingRunPreflight(
  response: unknown,
  workflowVersionId: string | null,
): ManagerTrainingRunPreflight {
  if (!workflowVersionId || !response || typeof response !== 'object' || Array.isArray(response)) {
    return { state: 'unavailable' };
  }
  const root = response as Record<string, unknown>;
  if (root.ok !== true || !root.home || typeof root.home !== 'object' || Array.isArray(root.home)) {
    return { state: 'unavailable' };
  }
  const home = root.home as Record<string, unknown>;
  if (!home.agent || typeof home.agent !== 'object' || Array.isArray(home.agent)) {
    return { state: 'unavailable' };
  }
  const agent = home.agent as Record<string, unknown>;
  if (agent.currentVersionId !== workflowVersionId
    || !isTrainingSuccessorProjection(home.successorProjection, workflowVersionId)
    || !isManagerTrainingRequirements(home.managerTrainingRequirements, workflowVersionId)) {
    return { state: 'unavailable' };
  }
  const requirements = home.managerTrainingRequirements;
  if (requirements.readiness === 'coach_reference_training_required') {
    return {
      state: 'training_required', requirements,
      hasEligiblePredecessor: home.successorProjection.eligiblePredecessor !== null,
    };
  }
  return { state: 'ready', requirements };
}
