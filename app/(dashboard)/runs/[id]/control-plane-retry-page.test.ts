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

test('the browser supplies request identity plus the opaque grant it read back, never server-owned authority', () => {
  assert.match(component, /\/api\/v2\/me\/run-requests\/\$\{encodeURIComponent\(requestId\)\}\/control-plane-retry/);
  assert.match(component, /body: \{ grantId: presentation\.grantId \},/);
  assert.doesNotMatch(component, /expected[A-Z]|failedLaunchAttemptId|failedFencingEpoch|parentProof|fencingEpoch:|inputBindingsDigest|intentDigest/);
  assert.match(component, /if \(!retryConfirmed\(result\)\) throw new Error\('unconfirmed'\);/);
  assert.match(component, /role="alert"/);
  assert.match(component, /RETRY_SAFELY_DISTINCTION/);
  assert.match(component, /RUN_AGAIN_DISTINCTION/);
});

test('the no-work claim is rendered only behind mayClaimNoWork (affirmative eligibility or a queued receipt)', () => {
  assert.match(component, /\{mayClaimNoWork\(presentation\) && \(\s*\n\s*<p[^>]*>\{NO_WORK_CLAIM\}<\/p>/);
  assert.equal((component.match(/NO_WORK_CLAIM/g) || []).length, 2, 'imported once, rendered once, behind the guard');
  assert.doesNotMatch(component, /No work or provider action started/, 'the sentence lives in the classifier, not as loose copy');
  const lib = readFileSync(join(process.cwd(), 'lib', 'control-plane-retry.ts'), 'utf8');
  assert.match(lib, /return p\.state === 'available' \|\| p\.state === 'queued';/);
});
