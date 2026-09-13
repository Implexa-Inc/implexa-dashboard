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

export const TRAINING_PROPERTY_CODES = [
  'composition_density', 'layout_variety', 'presenter_graphic_integration', 'information_hierarchy',
  'typography_treatment', 'palette_and_contrast', 'narrative_visual_alignment', 'motion_rhythm',
  'transition_quality', 'animation_continuity', 'evidence_legibility', 'internal_label_exclusion',
  'flicker_exclusion', 'repeated_template_avoidance', 'sparse_motion_avoidance',
] as const;
export type TrainingPropertyCode = typeof TRAINING_PROPERTY_CODES[number];
export const TRAINING_RELATIONS = ['accepted', 'rejected', 'contrast', 'exception'] as const;
export type TrainingRelation = typeof TRAINING_RELATIONS[number];
export type TrainingCoveragePair = { stage: TrainingStage; property: TrainingPropertyCode; relation: TrainingRelation };
export type ManagerTrainingRequirements = {
  contractVersion: 'manager-reference-training-readiness.v1';
  scope: 'workflow_version_quality_references';
  workflowVersionId: string;
  classified: boolean;
  requiredPairs: TrainingCoveragePair[];
  fulfilledPairs: TrainingCoveragePair[];
  missingPairs: TrainingCoveragePair[];
  readiness: 'not_applicable' | 'reference_training_ready' | 'coach_reference_training_required';
  reason: null | 'manager_required_reference_training_missing';
};

export type ManagerTrainingCoverage = {
  contractVersion: 'manager-training-coverage.v1'; scope: 'workflow_version'; workflowVersionId: string;
  classified: boolean; acceptedLocalRecordCount: number; listedSessionAcceptedRecordCount: number;
  acceptedPairs: TrainingCoveragePair[]; listedSessionAcceptedPairs: TrainingCoveragePair[];
  coveredPairs: TrainingCoveragePair[]; uncoveredPairs: TrainingCoveragePair[];
  readiness: 'not_applicable' | 'ready' | 'agent_update_required';
  reason: null | 'manager_quality_coverage_unclassified_training' | 'manager_quality_coverage_incomplete_training';
};

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
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

const RELATIONS = new Set<string>(TRAINING_RELATIONS);
const PROPERTY_CODES = new Set<string>(TRAINING_PROPERTY_CODES);
function pairKeys(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > TRAINING_STAGE_OPTIONS.length * 15 * 4) return null;
  const keys: string[] = [];
  for (const pair of value) {
    if (!exact(pair, ['stage', 'property', 'relation'])
      || !TRAINING_STAGE_OPTIONS.some(({ value: stage }) => stage === pair.stage)
      || typeof pair.property !== 'string' || !PROPERTY_CODES.has(pair.property)
      || typeof pair.relation !== 'string' || !RELATIONS.has(pair.relation)) return null;
    keys.push(`${pair.stage}\u0000${pair.property}\u0000${pair.relation}`);
  }
  return keys.some((key, index) => index > 0 && keys[index - 1] >= key) ? null : keys;
}

export function isManagerTrainingRequirements(value: unknown, workflowVersionId: string | null): value is ManagerTrainingRequirements {
  if (!workflowVersionId || !exact(value, ['contractVersion', 'scope', 'workflowVersionId', 'classified',
    'requiredPairs', 'fulfilledPairs', 'missingPairs', 'readiness', 'reason'])
    || value.contractVersion !== 'manager-reference-training-readiness.v1' || value.scope !== 'workflow_version_quality_references'
    || value.workflowVersionId !== workflowVersionId || typeof value.classified !== 'boolean') return false;
  const required = pairKeys(value.requiredPairs); const fulfilled = pairKeys(value.fulfilledPairs); const missing = pairKeys(value.missingPairs);
  if (!required || !fulfilled || !missing) return false;
  const requiredSet = new Set(required); const fulfilledSet = new Set(fulfilled); const missingSet = new Set(missing);
  if (fulfilled.some((key) => missingSet.has(key)) || [...fulfilled, ...missing].some((key) => !requiredSet.has(key))
    || required.some((key) => !fulfilledSet.has(key) && !missingSet.has(key))) return false;
  if (value.readiness === 'not_applicable') return value.reason === null && (!value.classified || required.length === 0)
    && fulfilled.length === 0 && missing.length === 0;
  if (value.readiness === 'reference_training_ready') return value.classified && value.reason === null && required.length > 0
    && missing.length === 0 && fulfilled.length === required.length;
  return value.readiness === 'coach_reference_training_required' && value.classified
    && value.reason === 'manager_required_reference_training_missing' && missing.length > 0;
}

export function isManagerTrainingCoverage(value: unknown, workflowVersionId: string | null): value is ManagerTrainingCoverage {
  if (!workflowVersionId || !exact(value, ['contractVersion', 'scope', 'workflowVersionId', 'classified',
    'acceptedLocalRecordCount', 'listedSessionAcceptedRecordCount', 'acceptedPairs', 'listedSessionAcceptedPairs',
    'coveredPairs', 'uncoveredPairs', 'readiness', 'reason'])
    || value.contractVersion !== 'manager-training-coverage.v1' || value.scope !== 'workflow_version'
    || value.workflowVersionId !== workflowVersionId || typeof value.classified !== 'boolean'
    || !Number.isSafeInteger(value.acceptedLocalRecordCount) || Number(value.acceptedLocalRecordCount) < 0
    || !Number.isSafeInteger(value.listedSessionAcceptedRecordCount) || Number(value.listedSessionAcceptedRecordCount) < 0
    || Number(value.listedSessionAcceptedRecordCount) > Number(value.acceptedLocalRecordCount)) return false;
  const accepted = pairKeys(value.acceptedPairs); const listed = pairKeys(value.listedSessionAcceptedPairs);
  const covered = pairKeys(value.coveredPairs); const uncovered = pairKeys(value.uncoveredPairs);
  if (!accepted || !listed || !covered || !uncovered || listed.some((key) => !accepted.includes(key))) return false;
  const coveredSet = new Set(covered); const uncoveredSet = new Set(uncovered); const acceptedSet = new Set(accepted);
  if (covered.some((key) => uncoveredSet.has(key)) || [...covered, ...uncovered].some((key) => !acceptedSet.has(key))
    || accepted.some((key) => !coveredSet.has(key) && !uncoveredSet.has(key))) return false;
  if (value.readiness === 'not_applicable') return value.reason === null && Number(value.acceptedLocalRecordCount) === 0
    && accepted.length === 0 && listed.length === 0 && covered.length === 0 && uncovered.length === 0;
  if (value.readiness === 'ready') return value.classified && value.reason === null && accepted.length > 0
    && uncovered.length === 0 && covered.length === accepted.length;
  if (value.readiness !== 'agent_update_required' || uncovered.length === 0) return false;
  if (value.reason === 'manager_quality_coverage_unclassified_training') return !value.classified
    && covered.length === 0 && uncovered.length === accepted.length;
  return value.reason === 'manager_quality_coverage_incomplete_training' && value.classified;
}

export function requiredStagesForDecision(requirements: ManagerTrainingRequirements | null, property: TrainingPropertyCode, relation: TrainingRelation): TrainingStage[] {
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
