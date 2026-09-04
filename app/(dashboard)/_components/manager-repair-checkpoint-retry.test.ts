import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(process.cwd(), 'app', '(dashboard)', '_components');
const component = readFileSync(join(dir, 'manager-repair-checkpoint-retry.tsx'), 'utf8');
const card = readFileSync(join(dir, 'run-judgment-card.tsx'), 'utf8');
const page = readFileSync(join(process.cwd(), 'app', '(dashboard)', 'runs', '[id]', 'page.tsx'), 'utf8');

test('terminal repair retry renders only for the exact failed request projection', () => {
  assert.match(card, /repairRequest\.status === 'done' && repairRequest\.lifecycle_state === 'failed'/);
  assert.match(card, /<ManagerRepairCheckpointRetry requestId=\{repairRequest\.id\}/);
  assert.match(page, /\.select\('id, status, lifecycle_state, run_id, created_at'\)/);
});

test('the browser supplies only authenticated request identity and never checkpoint authority', () => {
  assert.match(component, /\/manager-repairs\/\$\{encodeURIComponent\(requestId\)\}\/checkpoint-retry/);
  assert.match(component, /method: 'POST'/);
  assert.doesNotMatch(component, /body\s*:/);
  assert.doesNotMatch(component, /checkpointId|failedRunId|launchAttemptId|fencingEpoch/);
});

test('the action is explicit, single-flight, refreshes state, and reports a failed queue', () => {
  assert.match(component, /if \(busy\) return;/);
  assert.match(component, /disabled=\{busy\}/);
  assert.match(component, /Retry from original checkpoint/);
  assert.match(component, /router\.refresh\(\)/);
  assert.match(component, /role="alert"/);
});
