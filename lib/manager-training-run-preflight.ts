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
    successorAdoption: TrainingSuccessorAdoptionPreview | null;
  }
  | { state: 'unavailable' };

export type TrainingSuccessorAdoptionPreview = {
  contractVersion: 'manager-training-successor-adoption-preview.v1';
  targetWorkflowVersionId: string;
  sourceWorkflowVersionId: string | null;
  eligibleRecordCount: number;
  alreadyAdoptedRecordCount: number;
  newlyAdoptableRecordCount: number;
  eligibleRouteCount: number;
  readiness: 'adoption_available' | 'already_adopted' | 'not_compatible';
  reason: null | 'agent_not_owned' | 'agent_active_version_changed' | 'version_lineage_incompatible'
    | 'task_identity_changed' | 'manager_policy_changed' | 'training_successor_no_eligible_records'
    | 'training_successor_adoption_incomplete';
};

export type TrainingSuccessorAdoptionReceipt = {
  ok: true;
  contractVersion: 'manager-training-successor-adoption.v1';
  created: boolean;
  agentSlug: string;
  targetWorkflowVersionId: string;
  sourceWorkflowVersionId: string;
  adoptedRecordCount: number;
  adoptionReceiptIds: string[];
  eligibleRouteCount: number;
  adoptionSetDigest: string;
  managerTrainingRequirements: ManagerTrainingRequirements;
};

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const ADOPTION_REASONS = new Set([
  'agent_not_owned', 'agent_active_version_changed', 'version_lineage_incompatible',
  'task_identity_changed', 'manager_policy_changed', 'training_successor_no_eligible_records',
  'training_successor_adoption_incomplete',
]);
const exact = (value: unknown, keys: readonly string[]): value is Record<string, unknown> => Boolean(
  value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key)),
);

export function trainingSuccessorAdoptionPreview(
  value: unknown,
  targetWorkflowVersionId: string,
): TrainingSuccessorAdoptionPreview | null {
  if (!exact(value, ['contractVersion', 'targetWorkflowVersionId', 'sourceWorkflowVersionId',
    'eligibleRecordCount', 'alreadyAdoptedRecordCount', 'newlyAdoptableRecordCount',
    'eligibleRouteCount', 'readiness', 'reason'])
    || value.contractVersion !== 'manager-training-successor-adoption-preview.v1'
    || value.targetWorkflowVersionId !== targetWorkflowVersionId
    || (value.sourceWorkflowVersionId !== null
      && (typeof value.sourceWorkflowVersionId !== 'string' || !UUID.test(value.sourceWorkflowVersionId)
        || value.sourceWorkflowVersionId === targetWorkflowVersionId))
    || !['eligibleRecordCount', 'alreadyAdoptedRecordCount', 'newlyAdoptableRecordCount', 'eligibleRouteCount']
      .every((key) => Number.isSafeInteger(value[key]) && Number(value[key]) >= 0)
    || Number(value.newlyAdoptableRecordCount) !== Math.max(Number(value.eligibleRecordCount) - Number(value.alreadyAdoptedRecordCount), 0)
    || !['adoption_available', 'already_adopted', 'not_compatible'].includes(String(value.readiness))
    || (value.reason !== null && (typeof value.reason !== 'string' || !ADOPTION_REASONS.has(value.reason)))) return null;
  if (value.readiness === 'adoption_available') {
    if (value.reason !== null || value.sourceWorkflowVersionId === null
      || Number(value.newlyAdoptableRecordCount) < 1) return null;
  } else if (value.readiness === 'already_adopted') {
    if (value.reason !== null || value.sourceWorkflowVersionId === null
      || Number(value.alreadyAdoptedRecordCount) < 1 || Number(value.newlyAdoptableRecordCount) !== 0) return null;
  } else if (value.reason === null || Number(value.newlyAdoptableRecordCount) !== 0) return null;
  return value as TrainingSuccessorAdoptionPreview;
}

export function trainingSuccessorAdoptionActionAvailable(
  value: TrainingSuccessorAdoptionPreview | null,
): value is TrainingSuccessorAdoptionPreview {
  return value?.readiness === 'adoption_available'
    && value.newlyAdoptableRecordCount > 0 && value.eligibleRouteCount > 0;
}

export function trainingSuccessorAdoptionReceipt(
  value: unknown,
  agentSlug: string,
  preview: TrainingSuccessorAdoptionPreview,
): TrainingSuccessorAdoptionReceipt | null {
  if (!exact(value, ['ok', 'contractVersion', 'created', 'agentSlug', 'targetWorkflowVersionId',
    'sourceWorkflowVersionId', 'adoptedRecordCount', 'adoptionReceiptIds', 'eligibleRouteCount',
    'adoptionSetDigest', 'managerTrainingRequirements'])
    || value.ok !== true || value.contractVersion !== 'manager-training-successor-adoption.v1'
    || typeof value.created !== 'boolean' || value.agentSlug !== agentSlug
    || value.targetWorkflowVersionId !== preview.targetWorkflowVersionId
    || value.sourceWorkflowVersionId !== preview.sourceWorkflowVersionId
    || !Number.isSafeInteger(value.adoptedRecordCount)
    || value.adoptedRecordCount !== preview.eligibleRecordCount
    || value.eligibleRouteCount !== preview.eligibleRouteCount
    || typeof value.adoptionSetDigest !== 'string' || !/^[a-f0-9]{64}$/.test(value.adoptionSetDigest)
    || !Array.isArray(value.adoptionReceiptIds)
    || value.adoptionReceiptIds.length !== value.adoptedRecordCount
    || value.adoptionReceiptIds.some((id, index, ids) => typeof id !== 'string' || !UUID.test(id)
      || (index > 0 && ids[index - 1] >= id))
    || !isManagerTrainingRequirements(value.managerTrainingRequirements, preview.targetWorkflowVersionId)
    || value.managerTrainingRequirements.readiness !== 'reference_training_ready') return null;
  return value as TrainingSuccessorAdoptionReceipt;
}

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
    const successorAdoption = home.successorAdoption === undefined
      ? null : trainingSuccessorAdoptionPreview(home.successorAdoption, workflowVersionId);
    if (home.successorAdoption !== undefined && !successorAdoption) return { state: 'unavailable' };
    return {
      state: 'training_required', requirements,
      hasEligiblePredecessor: home.successorProjection.eligiblePredecessor !== null,
      successorAdoption,
    };
  }
  return { state: 'ready', requirements };
}
