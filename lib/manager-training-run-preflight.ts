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
    optional?: true;
    installedCustomer?: true;
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
export type PreparedTrainingTest={testPreparationId:string;preparationDigest:string};
/** Query values select a prepared test, never create authority. The server
 * revalidates the owner/material at preflight and again at request birth. */
export function preparedTrainingTestQuery(id:unknown,digest:unknown):{state:'none'}|{state:'invalid'}|{state:'prepared';binding:PreparedTrainingTest}{
  if(id===undefined&&digest===undefined)return {state:'none'};
  return typeof id==='string'&&UUID.test(id)&&typeof digest==='string'&&/^[a-f0-9]{64}$/.test(digest)
    ?{state:'prepared',binding:{testPreparationId:id,preparationDigest:digest}}:{state:'invalid'};
}
export function preparedTrainingTestMatches(response:any,binding:PreparedTrainingTest){
  return response?.trainingTest?.testPreparationId===binding.testPreparationId&&response.trainingTest.preparationDigest===binding.preparationDigest;
}
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
  requirements: ManagerTrainingRequirements | null = null,
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
    const zero = requirements?.readiness === 'not_applicable' && requirements.reason === null
      && requirements.workflowVersionId === targetWorkflowVersionId
      && requirements.requiredPairs.length === 0 && requirements.fulfilledPairs.length === 0 && requirements.missingPairs.length === 0
      && ['eligibleRecordCount', 'alreadyAdoptedRecordCount', 'newlyAdoptableRecordCount', 'eligibleRouteCount'].every(key => value[key] === 0);
    if (value.reason !== null || value.sourceWorkflowVersionId === null
      || (!zero && Number(value.alreadyAdoptedRecordCount) < 1) || Number(value.newlyAdoptableRecordCount) !== 0) return null;
  } else if (value.reason === null) return null;
  return value as TrainingSuccessorAdoptionPreview;
}

export function trainingSuccessorAdoptionActionAvailable(
  value: TrainingSuccessorAdoptionPreview | null,
): value is TrainingSuccessorAdoptionPreview {
  return value?.readiness === 'adoption_available'
    && value.newlyAdoptableRecordCount > 0 && value.eligibleRouteCount > 0;
}

/** Proposed updates retain the reference projection; a new purpose cannot adopt it. */
export function trainingProposedAdoptionPreview(value: unknown, sourceId: string, targetId: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const { ok, expectedAdoptionDigest, managerPolicyRemap, managerTrainingRequirements, taskIdentityRepurpose, ...projection } = raw;
  const details = Object.hasOwn(raw, 'managerPolicyRemap') || Object.hasOwn(raw, 'managerTrainingRequirements');
  if (details && (!Object.hasOwn(raw, 'managerPolicyRemap') || !Object.hasOwn(raw, 'managerTrainingRequirements')
    || !isManagerTrainingRequirements(managerTrainingRequirements, targetId))) return null;
  const requirements = details ? managerTrainingRequirements as ManagerTrainingRequirements : null;
  // Zero is accepted only with the server's separately verified, genuinely
  // not-applicable requirements. It is never counted as positive coverage.
  const preview = trainingSuccessorAdoptionPreview(projection, targetId, requirements);
  const remap = managerPolicyRemap === null || managerPolicyRemap === undefined ? null
    : managerPolicyRemapReview(managerPolicyRemap, sourceId, targetId);
  if (details && managerPolicyRemap !== null && !remap) return null;
  const freshPurpose = Object.hasOwn(raw, 'taskIdentityRepurpose');
  const repurpose = freshPurpose ? taskIdentityRepurposeReview(taskIdentityRepurpose, sourceId, targetId) : null;
  // A new purpose is never reference adoption, including the zero-reference
  // "already adopted" case. Only the exact server projection can offer Apply.
  if (freshPurpose && (!details || !repurpose || remap || !preview
    || preview.readiness !== 'not_compatible' || preview.reason !== 'task_identity_changed'
    || !['eligibleRecordCount', 'alreadyAdoptedRecordCount', 'newlyAdoptableRecordCount', 'eligibleRouteCount']
      .every(key => projection[key] === 0))) return null;
  return ok === true && preview && preview.sourceWorkflowVersionId === sourceId
    && typeof expectedAdoptionDigest === 'string' && /^[a-f0-9]{64}$/.test(expectedAdoptionDigest)
    ? { ...preview,
      expectedAdoptionDigest, managerPolicyRemap: remap, managerTrainingRequirements: requirements,
      ...(repurpose ? { taskIdentityRepurpose: repurpose } : {}) } : null;
}

export type TaskIdentityRepurposeAcknowledgement = {
  kind: 'task_identity_repurpose'; fromVersionId: string; targetVersionId: string;
  sourceLearningIdentityDigest: string; targetLearningIdentityDigest: string;
  sourcePolicySetDigest: string; targetPolicySetDigest: string; repurposeDigest: string;
};
function taskIdentityRepurposeReview(value: unknown, source: string, target: string) {
  if (!exact(value, ['acknowledgement', 'activationReceiptDigest'])
    || typeof value.activationReceiptDigest !== 'string' || !/^[a-f0-9]{64}$/.test(value.activationReceiptDigest)) return null;
  const ack = value.acknowledgement;
  if (!exact(ack, ['kind', 'fromVersionId', 'targetVersionId', 'sourceLearningIdentityDigest',
    'targetLearningIdentityDigest', 'sourcePolicySetDigest', 'targetPolicySetDigest', 'repurposeDigest'])
    || ack.kind !== 'task_identity_repurpose' || !UUID.test(source) || !UUID.test(target) || source === target
    || ack.fromVersionId !== source || ack.targetVersionId !== target
    || !['sourceLearningIdentityDigest', 'targetLearningIdentityDigest', 'sourcePolicySetDigest',
      'targetPolicySetDigest', 'repurposeDigest'].every(key => typeof ack[key] === 'string' && /^[a-f0-9]{64}$/.test(ack[key] as string))
    || ack.sourceLearningIdentityDigest === ack.targetLearningIdentityDigest) return null;
  return { acknowledgement: ack as TaskIdentityRepurposeAcknowledgement, activationReceiptDigest: value.activationReceiptDigest };
}

export type ManagerPolicyRemapAcknowledgement = { fromVersionId: string; targetVersionId: string;
  sourcePolicySetDigest: string; targetPolicySetDigest: string; remapDigest: string };
type RemapEntry = { from: { order: number; kind: string; label: string; policyDigest: string };
  to: { order: number; label: string }; disposition: 'moved' | 'consolidated' };
function managerPolicyRemapReview(value: unknown, source: string, target: string) {
  if (!exact(value, ['acknowledgement', 'entries', 'retiredLabels', 'activationReceiptDigest'])
    || typeof value.activationReceiptDigest !== 'string' || !/^[a-f0-9]{64}$/.test(value.activationReceiptDigest)) return null;
  const ack = value.acknowledgement;
  if (!exact(ack, ['fromVersionId', 'targetVersionId', 'sourcePolicySetDigest', 'targetPolicySetDigest', 'remapDigest'])
    || ack.fromVersionId !== source || ack.targetVersionId !== target
    || !['sourcePolicySetDigest', 'targetPolicySetDigest', 'remapDigest'].every(key => typeof ack[key] === 'string' && /^[a-f0-9]{64}$/.test(ack[key] as string))
    || !Array.isArray(value.entries) || value.entries.length < 1 || value.entries.length > 16
    || !Array.isArray(value.retiredLabels) || !value.retiredLabels.every(label => typeof label === 'string' && /^[a-z_]{1,40}$/.test(label))) return null;
  for (const e of value.entries) {
    if (!exact(e, ['from', 'to', 'disposition']) || !exact(e.from, ['order', 'kind', 'label', 'policyDigest'])
      || !exact(e.to, ['order', 'label']) || !['moved', 'consolidated'].includes(String(e.disposition))
      || ![e.from, e.to].every(loc => Number.isSafeInteger(loc.order) && Number(loc.order) > 0
        && typeof loc.label === 'string' && /^[a-z_]{1,40}$/.test(loc.label))
      || !['skill', 'tool', 'decision', 'workflow'].includes(String(e.from.kind))
      || typeof e.from.policyDigest !== 'string' || !/^[a-f0-9]{64}$/.test(e.from.policyDigest)) return null;
  }
  return { acknowledgement: ack as ManagerPolicyRemapAcknowledgement, entries: value.entries as RemapEntry[], retiredLabels: value.retiredLabels as string[], activationReceiptDigest: value.activationReceiptDigest };
}

export function trainingProposedAdoptionReceipt(value: unknown, agentSlug: string,
  preview: TrainingSuccessorAdoptionPreview) {
  if (!exact(value, ['ok', 'contractVersion', 'created', 'targetWorkflowVersionId',
    'sourceWorkflowVersionId', 'adoptedRecordCount', 'adoptionReceiptIds', 'eligibleRouteCount',
    'adoptionSetDigest', 'managerTrainingRequirements'])) return null;
  return trainingSuccessorAdoptionReceipt({ ...value, agentSlug }, agentSlug, preview);
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
    || !(value.managerTrainingRequirements.readiness === 'reference_training_ready'
      || (value.managerTrainingRequirements.readiness === 'not_applicable'
        && value.managerTrainingRequirements.requiredPairs.length === 0
        && value.managerTrainingRequirements.fulfilledPairs.length === 0
        && value.managerTrainingRequirements.missingPairs.length === 0))) return null;
  return value as TrainingSuccessorAdoptionReceipt;
}

/**
 * Interpret only the backend-owned, immutable-version training projection.
 * This is an early UX gate; request creation repeats the authoritative check.
 */
export function managerTrainingRunPreflight(
  response: unknown,
  workflowVersionId: string | null,
  expectedTrainingTest:PreparedTrainingTest|null=null,
): ManagerTrainingRunPreflight {
  if (!workflowVersionId || !response || typeof response !== 'object' || Array.isArray(response)) {
    return { state: 'unavailable' };
  }
  const root = response as Record<string, unknown>;
  if(expectedTrainingTest){
    if(!exact(root,['ok','contractVersion','agentFamilyId','workflowVersionId','managerTrainingRequirements','trainingTest'])
      ||root.ok!==true||root.contractVersion!=='prepared-agent-training-preflight.v1'||!preparedTrainingTestMatches(root,expectedTrainingTest)
      ||typeof root.agentFamilyId!=='string'||!UUID.test(root.agentFamilyId)||root.workflowVersionId!==workflowVersionId
      ||!isManagerTrainingRequirements(root.managerTrainingRequirements,workflowVersionId))return {state:'unavailable'};
    const requirements=root.managerTrainingRequirements;
    return requirements.readiness==='coach_reference_training_required'?{state:'training_required',requirements,hasEligiblePredecessor:false,successorAdoption:null}:{state:'ready',requirements};
  }
  if (root.contractVersion === 'installed-agent-training-preflight.v1') {
    if (!exact(root, ['ok', 'contractVersion', 'agentFamilyId', 'workflowVersionId', 'managerTrainingRequirements'])
      || root.ok !== true || typeof root.agentFamilyId !== 'string' || !UUID.test(root.agentFamilyId)
      || root.workflowVersionId !== workflowVersionId
      || !isManagerTrainingRequirements(root.managerTrainingRequirements, workflowVersionId)) return { state: 'unavailable' };
    const requirements = root.managerTrainingRequirements;
    return requirements.readiness === 'coach_reference_training_required'
      ? { state: 'training_required', requirements, installedCustomer: true,
        hasEligiblePredecessor: false, successorAdoption: null }
      : { state: 'ready', requirements };
  }
  if (Object.hasOwn(root, 'contractVersion')) return { state: 'unavailable' };
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
  const successorAdoption = home.successorAdoption === undefined
    ? null : trainingSuccessorAdoptionPreview(home.successorAdoption, workflowVersionId, requirements);
  if (home.successorAdoption !== undefined && !successorAdoption) return { state: 'unavailable' };
  if (requirements.readiness === 'coach_reference_training_required') {
    return {
      state: 'training_required', requirements,
      hasEligiblePredecessor: home.successorProjection.eligiblePredecessor !== null,
      successorAdoption,
    };
  }
  if (trainingSuccessorAdoptionActionAvailable(successorAdoption)) {
    return { state: 'training_required', requirements, optional: true,
      hasEligiblePredecessor: home.successorProjection.eligiblePredecessor !== null, successorAdoption };
  }
  return { state: 'ready', requirements };
}
