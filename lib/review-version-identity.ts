import type { ReviewArtifact } from './review.ts';

export type ReviewVersion = {
  runId: string;
  label: string;
  runState?: string | null;
  startedAt?: string | null;
};

export function versionForRun(runId: string, versions: ReviewVersion[]): ReviewVersion | null {
  return versions.find((version) => version.runId === runId) ?? null;
}

export function latestValidatedFinalOutput(artifacts: ReviewArtifact[]): ReviewArtifact | null {
  const finals = artifacts.filter((artifact) => artifact.status === 'validated' && artifact.role === 'final_output');
  if (finals.length <= 1) return finals[0] ?? null;
  const dated = finals.map((artifact) => ({
    artifact,
    time: artifact.validatedAt ? Date.parse(artifact.validatedAt) : Number.NaN,
  }));
  // An id or input array position is not chronology. If any competing artifact has
  // no valid verification time, the latest authority is unknown and must stay so.
  if (dated.some(({ time }) => !Number.isFinite(time))) return null;
  dated.sort((a, b) => b.time - a.time);
  if (dated[0].time === dated[1].time) return null;
  return dated[0].artifact;
}

export function reviewTimestamp(iso: string | null | undefined): string {
  if (!iso) return 'time unavailable';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'time unavailable';
  return date.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

export function artifactOptionLabel(artifact: ReviewArtifact, versionLabel: string | null): string {
  const name = artifact.relativePath.split('/').at(-1) || artifact.relativePath;
  const role = artifact.role ? artifact.role.replaceAll('_', ' ') : 'file';
  return `${versionLabel || 'Version unavailable'} · ${name} · ${role} · verified ${reviewTimestamp(artifact.validatedAt)}`;
}
