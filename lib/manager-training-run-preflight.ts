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
  | { state: 'unavailable';reason?:'training_served_snapshot_version_mismatch' };

type AdoptionPreviewFields = {
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

export type TrainingSuccessorAdoptionPreview = AdoptionPreviewFields & (
  | { contractVersion: 'manager-training-successor-adoption-preview.v1' }
  | { contractVersion: 'manager-training-successor-adoption-preview.v2';
      ancestorRecovery: { planDigest: string; versionIds: string[] } }
);

type AdoptionReceiptFields = {
  ok: true;
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

export type TrainingSuccessorAdoptionReceipt = AdoptionReceiptFields & (
  | { contractVersion: 'manager-training-successor-adoption.v1' }
  | { contractVersion: 'manager-training-successor-adoption.v2'; expectedAdoptionDigest: string }
);

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
  const ancestor = Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && (value as Record<string, unknown>).contractVersion === 'manager-training-successor-adoption-preview.v2');
  if (!exact(value, ['contractVersion', 'targetWorkflowVersionId', 'sourceWorkflowVersionId',
    'eligibleRecordCount', 'alreadyAdoptedRecordCount', 'newlyAdoptableRecordCount',
    'eligibleRouteCount', 'readiness', 'reason', ...(ancestor ? ['ancestorRecovery'] : [])])
    || (!ancestor && value.contractVersion !== 'manager-training-successor-adoption-preview.v1')
    || value.targetWorkflowVersionId !== targetWorkflowVersionId
    || (value.sourceWorkflowVersionId !== null
      && (typeof value.sourceWorkflowVersionId !== 'string' || !UUID.test(value.sourceWorkflowVersionId)
        || value.sourceWorkflowVersionId === targetWorkflowVersionId))
    || !['eligibleRecordCount', 'alreadyAdoptedRecordCount', 'newlyAdoptableRecordCount', 'eligibleRouteCount']
      .every((key) => Number.isSafeInteger(value[key]) && Number(value[key]) >= 0)
    || Number(value.newlyAdoptableRecordCount) !== Math.max(Number(value.eligibleRecordCount) - Number(value.alreadyAdoptedRecordCount), 0)
    || !['adoption_available', 'already_adopted', 'not_compatible'].includes(String(value.readiness))
    || (value.reason !== null && (typeof value.reason !== 'string' || !ADOPTION_REASONS.has(value.reason)))) return null;
  if (ancestor) {
    const recovery = value.ancestorRecovery;
    if (!exact(recovery, ['planDigest', 'versionIds'])
      || typeof recovery.planDigest !== 'string' || !/^[a-f0-9]{64}$/.test(recovery.planDigest)
      || !Array.isArray(recovery.versionIds) || recovery.versionIds.length < 3 || recovery.versionIds.length > 65
      || recovery.versionIds.some(id => typeof id !== 'string' || !UUID.test(id))
      || new Set(recovery.versionIds).size !== recovery.versionIds.length
      || recovery.versionIds[0] !== value.sourceWorkflowVersionId
      || recovery.versionIds.at(-1) !== targetWorkflowVersionId
      || Number(value.eligibleRecordCount) < 1 || Number(value.eligibleRouteCount) < 1
      || Number(value.alreadyAdoptedRecordCount) > Number(value.eligibleRecordCount)
      || value.reason !== null || value.readiness === 'not_compatible') return null;
    if (value.readiness === 'already_adopted' && (!requirements
      || requirements.workflowVersionId !== targetWorkflowVersionId || requirements.reason !== null
      || !(requirements.readiness === 'reference_training_ready'
        || (requirements.readiness === 'not_applicable' && requirements.requiredPairs.length === 0
          && requirements.fulfilledPairs.length === 0 && requirements.missingPairs.length === 0)))) return null;
  }
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

/** The active-version projection, never a historical session's coverage. */
export function trainingContinuityStatus(preview: unknown, requirements: ManagerTrainingRequirements | null,
  targetVersionId: string | null, sourceVersionId: string | null): { state: 'carried' | 'available'; count: number } | { state: 'review'; reason: string } | { state: 'unknown' } {
  if (!targetVersionId || !isManagerTrainingRequirements(requirements, targetVersionId)) return { state: 'unknown' };
  const checked = trainingSuccessorAdoptionPreview(preview, targetVersionId, requirements);
  if (!checked || !sourceVersionId || (checked.contractVersion === 'manager-training-successor-adoption-preview.v2'
    ? !checked.ancestorRecovery.versionIds.slice(0,-1).includes(sourceVersionId)
    : checked.sourceWorkflowVersionId !== sourceVersionId)) return { state: 'unknown' };
  if (checked.readiness === 'not_compatible') {
    // A moved version or lost ownership invalidates this read; it says nothing
    // about whether the teaching needs review.
    return checked.reason === 'agent_active_version_changed' || checked.reason === 'agent_not_owned'
      ? { state: 'unknown' } : { state: 'review', reason: checked.reason! };
  }
  if (checked.readiness === 'adoption_available' && checked.newlyAdoptableRecordCount > 0 && checked.eligibleRouteCount > 0) {
    return { state: 'available', count: checked.newlyAdoptableRecordCount };
  }
  if (checked.readiness === 'already_adopted' && checked.eligibleRecordCount > 0
    && checked.alreadyAdoptedRecordCount === checked.eligibleRecordCount
    && checked.newlyAdoptableRecordCount === 0 && checked.eligibleRouteCount > 0
    && (requirements!.readiness === 'reference_training_ready' || requirements!.readiness === 'not_applicable')) {
    return { state: 'carried', count: checked.alreadyAdoptedRecordCount };
  }
  return { state: 'unknown' };
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
  // Ancestor recovery is an explicit active-version action, never proposed
  // revision adoption. Keep the existing proposed contract unchanged.
  if (preview?.contractVersion === 'manager-training-successor-adoption-preview.v2') return null;
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
  const ancestor = preview.contractVersion === 'manager-training-successor-adoption-preview.v2';
  if (!exact(value, ['ok', 'contractVersion', 'created', 'agentSlug', 'targetWorkflowVersionId',
    'sourceWorkflowVersionId', 'adoptedRecordCount', 'adoptionReceiptIds', 'eligibleRouteCount',
    'adoptionSetDigest', 'managerTrainingRequirements', ...(ancestor ? ['expectedAdoptionDigest'] : [])])
    || value.ok !== true || value.contractVersion !== (ancestor
      ? 'manager-training-successor-adoption.v2' : 'manager-training-successor-adoption.v1')
    || (ancestor && value.expectedAdoptionDigest !== preview.ancestorRecovery.planDigest)
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
  if(root.ok===false&&root.reason==='training_served_snapshot_version_mismatch')return {state:'unavailable',reason:'training_served_snapshot_version_mismatch'};
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

/** The owner's Run action carries already-accepted compatible visual guidance,
 * not capability procedures or new permissions. SQL owns compatibility and the
 * immutable adoption ledger. One write at most; an uncertain delivery retries
 * with the same owner/target operation identity, including after a reload. */
export async function prepareTrainingRun({slug,workflowVersionId,trainingTest=null,skipOptionalCarry=false,read,adopt}: {
  slug:string;workflowVersionId:string|null;trainingTest?:PreparedTrainingTest|null;skipOptionalCarry?:boolean;
  read:()=>Promise<unknown>;
  adopt:(body:{expectedActiveVersionId:string;expectedAdoptionDigest?:string},key:string)=>Promise<unknown>;
}):Promise<{preflight:ManagerTrainingRunPreflight;carryError?:string}> {
  const before=managerTrainingRunPreflight(await read(),workflowVersionId,trainingTest);
  if(trainingTest||before.state!=='training_required'||before.installedCustomer
    ||(before.optional&&skipOptionalCarry)||!trainingSuccessorAdoptionActionAvailable(before.successorAdoption))
    return {preflight:before};
  const preview=before.successorAdoption;
  try{
    const result=await adopt({expectedActiveVersionId:preview.targetWorkflowVersionId,
      ...(preview.contractVersion==='manager-training-successor-adoption-preview.v2'
        ?{expectedAdoptionDigest:preview.ancestorRecovery.planDigest}:{})},
      `training-continuity:v1:${preview.targetWorkflowVersionId}`);
    if(!trainingSuccessorAdoptionReceipt(result,slug,preview))
      throw Error('Training carry-forward was not confirmed. Check again to verify the same operation.');
    const fresh=await read();
    const preflight=managerTrainingRunPreflight(fresh,workflowVersionId,trainingTest);
    const home=(fresh as {home?:{successorAdoption?:unknown}})?.home;
    const proof=preflight.state==='ready'&&workflowVersionId
      ?trainingSuccessorAdoptionPreview(home?.successorAdoption,workflowVersionId,preflight.requirements):null;
    if(!proof||proof.readiness!=='already_adopted'||proof.eligibleRecordCount<preview.eligibleRecordCount
      ||proof.alreadyAdoptedRecordCount!==proof.eligibleRecordCount||proof.eligibleRouteCount<1)
      return {preflight:preflight.state==='ready'?{state:'unavailable'}:preflight,
        carryError:'Training was carried, but its current availability needs checking. No run has started.'};
    return {preflight};
  }catch(error){return {preflight:before,carryError:error instanceof Error?error.message:'Training carry-forward could not be confirmed.'};}
}
