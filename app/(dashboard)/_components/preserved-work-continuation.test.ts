import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(import.meta.dirname, 'preserved-work-continuation.tsx'), 'utf8');

test('queues the existing managed continuation contract against the exact parent run', () => {
  assert.match(source, /callBackend\('\/api\/v2\/me\/run-requests'/);
  assert.match(source, /kind: 'continue'/);
  assert.match(source, /runId,/);
  assert.match(source, /note: PRESERVED_WORK_CONTINUATION_NOTE/);
  assert.match(source, /source: 'dashboard'/);
});

test('the recovery intent preserves completed work and never claims completion', () => {
  assert.match(source, /Desktop-validated preserved work/);
  assert.match(source, /Verify and reuse every completed artifact/);
  assert.match(source, /do not repeat paid provider calls/);
  assert.match(source, /Resume at the first pending step/);
  assert.match(source, /QA, Judge, and Manager proof/);
  assert.doesNotMatch(source, /Mark as done|status:\s*'completed'|record_scheduled_run/);
});

test('success navigates to active work and a refusal stays actionable', () => {
  assert.match(source, /router\.push\('\/workflows'\)/);
  assert.match(source, /runRequestRefusalCopy/);
  assert.match(source, /role="alert"/);
  assert.match(source, /Continue preserved work/);
});
