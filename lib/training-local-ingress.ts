export const TRAINING_LOCAL_CONTRACT_VERSION = '2';
export const TRAINING_STAGE_ROUTING_VERSION = 'manager-training-applicability.v1';

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
