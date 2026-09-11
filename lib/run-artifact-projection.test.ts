// node --test lib/run-artifact-projection.test.ts
//
// BLOCKER 12: the run page's artifact projection must carry what the recovery
// derivation needs (id, sha256, status) — the display projection alone made a
// validated final output invisible to deriveRecoveredWork.

import test from 'node:test';
import assert from 'node:assert/strict';
import { RUN_ARTIFACT_COLUMNS, projectRunArtifacts } from './run-artifact-projection.ts';
import { deriveRecoveredWork } from './run-recovery.ts';

const SHA = 'a'.repeat(64);
const rows = [
  { id: 'art-1', relative_path: 'out/final.mp4', validated_path: '/Users/x/Implexa Agents/w/out/final.mp4', role: 'final_output', status: 'validated', size_bytes: 1024, sha256: SHA },
  { id: 'art-2', relative_path: 'receipts/qa.json', validated_path: '/Users/x/Implexa Agents/w/receipts/qa.json', role: 'receipt', status: 'validated', size_bytes: 10, sha256: 'b'.repeat(64) },
  { id: 'art-3', relative_path: 'claimed.mp4', validated_path: null, role: 'final_output', status: 'declared', size_bytes: null, sha256: null },
];

test('the SELECT list names every column the projection reads', () => {
  for (const column of ['id', 'relative_path', 'validated_path', 'role', 'status', 'size_bytes', 'sha256']) assert.match(RUN_ARTIFACT_COLUMNS, new RegExp(`\\b${column}\\b`));
});

test('one projection serves both consumers: display fields for the list, identity + integrity + status for recovery', () => {
  const { verified, recovery } = projectRunArtifacts(rows, (role) => (role === 'final_output' ? 0 : 1));
  assert.deepEqual(verified, [
    { relativePath: 'out/final.mp4', validatedPath: '/Users/x/Implexa Agents/w/out/final.mp4', role: 'final_output', sizeBytes: 1024 },
    { relativePath: 'receipts/qa.json', validatedPath: '/Users/x/Implexa Agents/w/receipts/qa.json', role: 'receipt', sizeBytes: 10 },
  ]);
  assert.deepEqual(recovery, [
    { id: 'art-1', role: 'final_output', status: 'validated', relative_path: 'out/final.mp4', sha256: SHA },
    { id: 'art-2', role: 'receipt', status: 'validated', relative_path: 'receipts/qa.json', sha256: 'b'.repeat(64) },
  ]);
  assert.equal(recovery.some((a) => a.id === 'art-3'), false, 'a declared (unvalidated) claim is neither listed nor recoverable');
});

test('REAL-PAGE PATH: rows → projection → deriveRecoveredWork recognises the validated final output (the 2026-09-11 regression)', () => {
  const { recovery } = projectRunArtifacts(rows);
  const recovered = deriveRecoveredWork({ runState: 'failed', outputMarkdown: null, progress: { history: [{ at: '1', note: 'render complete' }] }, stepsState: [{ status: 'done' }], validatedArtifacts: recovery });
  assert.equal(recovered.recoverable, true);
  assert.deepEqual(recovered.deliverable, { id: 'art-1', role: 'final_output', relativePath: 'out/final.mp4', sha256: SHA });
  // The old display-only projection (no sha256) — what the page used to pass — never qualifies.
  const { verified } = projectRunArtifacts(rows);
  const displayOnly = deriveRecoveredWork({ runState: 'failed', outputMarkdown: null, progress: { history: [{ at: '1', note: 'render complete' }] }, stepsState: [{ status: 'done' }], validatedArtifacts: verified });
  assert.equal(displayOnly.recoverable, false);
  assert.equal(displayOnly.reason, 'transcript_only');
});

test('a malformed sha256 or a non-validated status is not integrity', () => {
  const { recovery } = projectRunArtifacts([{ ...rows[0], sha256: 'not-hex' }, { ...rows[0], id: 'art-9', status: 'rejected' }]);
  assert.equal(recovery.length, 1);
  assert.equal(recovery[0].sha256, null);
  assert.equal(deriveRecoveredWork({ runState: 'failed', progress: { history: [{ note: 'done' }] }, validatedArtifacts: recovery }).recoverable, false);
});
