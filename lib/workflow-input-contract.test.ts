import test from 'node:test';
import assert from 'node:assert/strict';
import { missingRequiredInputs, orderedInputFields, serializeArtifactBindings, type WorkflowInputContract } from './workflow-input-contract.ts';

const contract: WorkflowInputContract = { version: 1, fields: [
  { key: 'inspiration_video', label: 'Inspiration video', description: 'Optional reference.', kind: 'file', required: false, cardinality: 'one', order: 2 },
  { key: 'target_video', label: 'Target video', description: 'Video to process.', kind: 'file', required: true, cardinality: 'one', order: 1 },
] };

test('run form order comes from persisted contract order, not object/upload order', () => {
  assert.deepEqual(orderedInputFields(contract).map((f) => f.key), ['target_video', 'inspiration_video']);
});

test('only required inputs block submission', () => {
  assert.deepEqual(missingRequiredInputs(contract, {}).map((f) => f.key), ['target_video']);
  assert.deepEqual(missingRequiredInputs(contract, { target_video: { artifactId: 'a', sha256: 'b', displayName: 'target.mp4' } }), []);
});

test('submission strips display names and preserves semantic keys', () => {
  const serialized = serializeArtifactBindings({
    inspiration_video: { artifactId: 'inspiration', sha256: '2', displayName: 'first-upload.mov' },
    target_video: { artifactId: 'target', sha256: '1', displayName: 'second-upload.mp4' },
  });
  assert.deepEqual(serialized, {
    inspiration_video: { artifactId: 'inspiration', sha256: '2' },
    target_video: { artifactId: 'target', sha256: '1' },
  });
});
