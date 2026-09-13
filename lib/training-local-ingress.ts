export const TRAINING_LOCAL_CONTRACT_VERSION = '2';
export const TRAINING_STAGE_ROUTING_VERSION = 'manager-training-applicability.v1';

export type TrainingEligiblePredecessor = {
  sessionId: string;
  baseVersionId: string;
  acceptedLocalRecordCount: number;
};

export type TrainingSuccessorProjection = {
  contractVersion: 'agent-training-successor-projection.v1';
  activeVersionId: string | null;
  eligiblePredecessor: TrainingEligiblePredecessor | null;
};

export type TrainingCoveragePair = { stage: TrainingStage; property: string; relation: 'accepted' | 'rejected' | 'contrast' | 'exception' };
export type ManagerTrainingRequirements = {
  contractVersion: 'manager-training-requirements.v1';
  scope: 'workflow_version';
  workflowVersionId: string;
  classified: boolean;
  requiredPairs: TrainingCoveragePair[];
  fulfilledPairs: TrainingCoveragePair[];
  missingPairs: TrainingCoveragePair[];
  readiness: 'not_applicable' | 'ready' | 'coach_training_required';
  reason: null | 'manager_required_training_missing';
};

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const exact = (value: unknown, keys: readonly string[]): value is Record<string, unknown> => Boolean(
  value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length
  && keys.every((key) => Object.hasOwn(value, key)),
);

export function isTrainingSuccessorProjection(
  value: unknown,
  currentVersionId: string | null,
): value is TrainingSuccessorProjection {
  if (!exact(value, ['contractVersion', 'activeVersionId', 'eligiblePredecessor'])
    || value.contractVersion !== 'agent-training-successor-projection.v1'
    || value.activeVersionId !== currentVersionId
    || (value.activeVersionId !== null && (typeof value.activeVersionId !== 'string' || !UUID.test(value.activeVersionId)))) return false;
  const predecessor = value.eligiblePredecessor;
  if (predecessor === null) return true;
  return value.activeVersionId !== null
    && exact(predecessor, ['sessionId', 'baseVersionId', 'acceptedLocalRecordCount'])
    && typeof predecessor.sessionId === 'string' && UUID.test(predecessor.sessionId)
    && typeof predecessor.baseVersionId === 'string' && UUID.test(predecessor.baseVersionId)
    && predecessor.baseVersionId !== value.activeVersionId
    && Number.isSafeInteger(predecessor.acceptedLocalRecordCount)
    && Number(predecessor.acceptedLocalRecordCount) > 0;
}

export const TRAINING_STAGE_OPTIONS = [
  { value: 'planning', label: 'Plan the treatment', help: 'Use before tools, generation, or paid actions are chosen.' },
  { value: 'scene_contract', label: 'Design scene contracts', help: 'Use while deciding the layout and behavior of individual scenes.' },
  { value: 'asset_selection', label: 'Select assets', help: 'Use while deciding which source, generated, or researched assets belong in the work.' },
  { value: 'build', label: 'Build the composition', help: 'Use while implementing the editable composition.' },
  { value: 'preview', label: 'Review previews', help: 'Use while assessing preview renders before final production.' },
  { value: 'render', label: 'Render the output', help: 'Use only when the decision affects final rendering behavior.' },
  { value: 'qa', label: 'Check final quality', help: 'Use during technical and visual quality checks.' },
  { value: 'revision', label: 'Revise from feedback', help: 'Use while correcting a later version.' },
] as const;

export type TrainingStage = typeof TRAINING_STAGE_OPTIONS[number]['value'];

const RELATIONS = new Set(['accepted', 'rejected', 'contrast', 'exception']);
function pairKeys(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > TRAINING_STAGE_OPTIONS.length * 15 * 4) return null;
  const keys: string[] = [];
  for (const pair of value) {
    if (!exact(pair, ['stage', 'property', 'relation'])
      || !TRAINING_STAGE_OPTIONS.some(({ value: stage }) => stage === pair.stage)
      || typeof pair.property !== 'string' || !/^[a-z][a-z0-9_]{0,99}$/.test(pair.property)
      || typeof pair.relation !== 'string' || !RELATIONS.has(pair.relation)) return null;
    keys.push(`${pair.stage}\u0000${pair.property}\u0000${pair.relation}`);
  }
  return keys.some((key, index) => index > 0 && keys[index - 1] >= key) ? null : keys;
}

export function isManagerTrainingRequirements(value: unknown, workflowVersionId: string | null): value is ManagerTrainingRequirements {
  if (!workflowVersionId || !exact(value, ['contractVersion', 'scope', 'workflowVersionId', 'classified',
    'requiredPairs', 'fulfilledPairs', 'missingPairs', 'readiness', 'reason'])
    || value.contractVersion !== 'manager-training-requirements.v1' || value.scope !== 'workflow_version'
    || value.workflowVersionId !== workflowVersionId || typeof value.classified !== 'boolean') return false;
  const required = pairKeys(value.requiredPairs); const fulfilled = pairKeys(value.fulfilledPairs); const missing = pairKeys(value.missingPairs);
  if (!required || !fulfilled || !missing) return false;
  const requiredSet = new Set(required); const fulfilledSet = new Set(fulfilled); const missingSet = new Set(missing);
  if (fulfilled.some((key) => missingSet.has(key)) || [...fulfilled, ...missing].some((key) => !requiredSet.has(key))
    || required.some((key) => !fulfilledSet.has(key) && !missingSet.has(key))) return false;
  if (value.readiness === 'not_applicable') return value.reason === null && (!value.classified || required.length === 0)
    && fulfilled.length === 0 && missing.length === 0;
  if (value.readiness === 'ready') return value.classified && value.reason === null && required.length > 0
    && missing.length === 0 && fulfilled.length === required.length;
  return value.readiness === 'coach_training_required' && value.classified
    && value.reason === 'manager_required_training_missing' && missing.length > 0;
}

export function requiredStagesForDecision(requirements: ManagerTrainingRequirements | null, property: string, relation: string): TrainingStage[] {
  if (!requirements) return [];
  const required = new Set(requirements.requiredPairs
    .filter((pair) => pair.property === property && pair.relation === relation).map((pair) => pair.stage));
  return TRAINING_STAGE_OPTIONS.map(({ value }) => value).filter((stage) => required.has(stage));
}

const commonCreativeStages: TrainingStage[] = ['planning', 'build', 'preview', 'qa', 'revision'];
const sceneContractProperties = new Set([
  'layout_variety',
  'information_hierarchy',
  'typography_treatment',
  'transition_quality',
  'animation_continuity',
  'composition_density',
]);

export function deriveTrainingStages(property: string): TrainingStage[] {
  const stages = [...commonCreativeStages];
  if (sceneContractProperties.has(property)) stages.splice(1, 0, 'scene_contract');
  return stages;
}

export function normalizeTrainingStages(stages: readonly string[] | null | undefined): TrainingStage[] {
  const selected = new Set(stages || []);
  return TRAINING_STAGE_OPTIONS.map(({ value }) => value).filter((stage) => selected.has(stage));
}

export function trainingStageLabel(stage: string) {
  return TRAINING_STAGE_OPTIONS.find((option) => option.value === stage)?.label || stage.replaceAll('_', ' ');
}

export type TrainingPreviewIdentity = { token: string; timeMs: number };

export function formatTrainingTime(ms: number) {
  const safe = Math.max(0, Math.floor(ms));
  const hours = Math.floor(safe / 3_600_000);
  const minutes = Math.floor((safe % 3_600_000) / 60_000);
  const seconds = Math.floor((safe % 60_000) / 1_000);
  const millis = safe % 1_000;
  return `${hours ? `${String(hours).padStart(2, '0')}:` : ''}${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

export function previewMatches(
  preview: TrainingPreviewIdentity | null,
  sourceToken: string | null | undefined,
  timeMs: number,
) {
  return Boolean(preview && sourceToken && preview.token === sourceToken && preview.timeMs === timeMs);
}
