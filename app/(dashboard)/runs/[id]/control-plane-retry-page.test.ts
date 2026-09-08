import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const page = readFileSync(join(process.cwd(), 'app', '(dashboard)', 'runs', '[id]', 'page.tsx'), 'utf8');
const component = readFileSync(join(process.cwd(), 'app', '(dashboard)', '_components', 'control-plane-retry.tsx'), 'utf8');

test('the safe retry is mounted for the request this run was surfaced for, beside — never instead of — Run again', () => {
  assert.match(page, /import ControlPlaneRetry from '\.\.\/\.\.\/_components\/control-plane-retry';/);
  assert.match(page, /\.from\('run_requests'\)\s*\n\s*\.select\('id, status, lifecycle_state'\)\s*\n\s*\.eq\('run_id', r\.id\)\s*\n\s*\.eq\('status', 'done'\)\s*\n\s*\.eq\('lifecycle_state', 'failed'\)/);
  assert.match(page, /\{controlPlaneRetryRequestId && !supersededByRelated && \(\s*\n\s*<ControlPlaneRetry requestId=\{controlPlaneRetryRequestId\} \/>/);
  const retryAt = page.indexOf('<ControlPlaneRetry requestId=');
  const runAgainAt = page.indexOf('>Run again</Link>', retryAt);
  assert.ok(retryAt > 0 && runAgainAt > retryAt, 'Run again stays available on the same panel');
  assert.match(page, /<Link href=\{agentHref\} className="btn-outline text-sm px-4 py-2">Run again<\/Link>/,
    'Run again is still a navigation to a NEW request, never rewired to the safe retry');
});

test('the browser supplies request identity plus the pins it read back, never server-owned authority', () => {
  assert.match(component, /\/api\/v2\/me\/run-requests\/\$\{encodeURIComponent\(requestId\)\}\/control-plane-retry/);
  assert.match(component, /expectedDrainRetryEpoch: presentation\.pins\.expectedDrainRetryEpoch/);
  assert.match(component, /expectedWorkflowVersionId: presentation\.pins\.expectedWorkflowVersionId/);
  assert.match(component, /expectedInputBindingsDigest: presentation\.pins\.expectedInputBindingsDigest/);
  assert.doesNotMatch(component, /failedLaunchAttemptId|failedFencingEpoch|parentProof|fencingEpoch:/);
  assert.match(component, /if \(!retryConfirmed\(result\)\) throw new Error\('unconfirmed'\);/);
  assert.match(component, /role="alert"/);
  assert.match(component, /RETRY_SAFELY_DISTINCTION/);
  assert.match(component, /RUN_AGAIN_DISTINCTION/);
});
