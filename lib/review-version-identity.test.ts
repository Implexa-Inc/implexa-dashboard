import test from 'node:test';
import assert from 'node:assert/strict';
import { artifactOptionLabel, latestValidatedFinalOutput, versionForRun } from './review-version-identity.ts';
import type { ReviewArtifact } from './review.ts';

const artifact = (over: Partial<ReviewArtifact>): ReviewArtifact => ({
  id: 'a', runId: 'run-2', relativePath: 'out/master.mp4', role: 'final_output', status: 'validated',
  sha256: 'a'.repeat(64), sizeBytes: 10, mtime: null, validatedAt: '2026-08-27T16:15:00Z', ...over,
});

test('the exact current revision comes only from backend lineage', () => {
  const versions = [{ runId: 'run-1', label: 'Original', startedAt: '2026-08-26T10:00:00Z' },
    { runId: 'run-2', label: 'Revision 2', startedAt: '2026-08-27T16:00:00Z' }];
  assert.equal(versionForRun('run-2', versions)?.label, 'Revision 2');
  assert.equal(versionForRun('missing', versions), null);
});

test('latest authoritative file means the newest validated final_output, not array order', () => {
  const latest = latestValidatedFinalOutput([
    artifact({ id: 'new', validatedAt: '2026-08-27T16:15:00Z' }),
    artifact({ id: 'source', role: 'source', validatedAt: '2026-08-27T17:00:00Z' }),
    artifact({ id: 'old', validatedAt: '2026-08-27T15:00:00Z' }),
    artifact({ id: 'declared', status: 'declared', validatedAt: '2026-08-27T18:00:00Z' }),
  ]);
  assert.equal(latest?.id, 'new');
});

test('multiple finals without authoritative chronology do not invent a latest file', () => {
  assert.equal(latestValidatedFinalOutput([
    artifact({ id: 'one', validatedAt: null }),
    artifact({ id: 'two', validatedAt: 'invalid' }),
  ]), null);
});

test('artifact selector identifies revision, file role and verification time', () => {
  const label = artifactOptionLabel(artifact({}), 'Revision 2');
  assert.match(label, /Revision 2/);
  assert.match(label, /master\.mp4/);
  assert.match(label, /final output/);
  assert.match(label, /verified/);
});
