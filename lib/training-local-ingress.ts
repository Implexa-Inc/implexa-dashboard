export const TRAINING_LOCAL_CONTRACT_VERSION = '1';

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
