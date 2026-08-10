// node --test lib/review-spatial-contract.test.ts
//
// Cross-repo parity for the Wave 2 spatial + evidence wire, against the EXACT backend
// commit this dashboard was built and accepted against. Same discipline as
// review-submit-contract.test.ts: the pin is a full sha, the backend source is read
// back with `git show` from any sibling checkout that contains the commit, and a
// disagreement fails here — before a reviewer discovers it as a refused anchor.
//
// The pinned commit is the Wave 2 backend head (based on backend main 48de6efc677,
// where migration 0155's contract already lives unchanged): it adds the evidence wire
// surface, the submission evidence gate, and the executor evidence attachment.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { COORDINATE_SPACE, INTENT_CHANGE, INTENT_REFERENCE, SPATIAL_ANCHOR_TYPE, MAX_TIME_MS, MAX_VISUAL_EDGE } from './review-anchor.ts';
import { resolveReviewAction } from './review-actions.ts';

/** The Wave 2 backend this dashboard's spatial contract is accepted against. */
export const WAVE2_BACKEND_PIN = '7f657b2f7c29119d0fb48f50a3eb4f84b198e057';
/** The backend MAIN the Wave 2 branch is based on — 0155's contract, unchanged. */
export const WAVE2_BACKEND_BASE = '48de6efc6776b096ed1174659c0b078752c94ac4';

const backendRepo = (() => {
  for (const up of [['..', '..'], ['..', '..', '..'], ['..', '..', '..', '..'],
    ['..', '..', '..', '..', '..'], ['..', '..', '..', '..', '..', '..']]) {
    const workspace = join(import.meta.dirname, ...up);
    if (!existsSync(workspace)) continue;
    for (const name of readdirSync(workspace)) {
      if (!/backend/i.test(name)) continue;
      const dir = join(workspace, name);
      if (!existsSync(join(dir, '.git'))) continue;
      try {
        execFileSync('git', ['cat-file', '-e', `${WAVE2_BACKEND_PIN}^{commit}`], { cwd: dir, stdio: 'ignore' });
        return dir;
      } catch { /* not this one */ }
    }
  }
  return null;
})();

const atPin = (path: string, sha: string = WAVE2_BACKEND_PIN) =>
  execFileSync('git', ['show', `${sha}:${path}`], { cwd: backendRepo!, encoding: 'utf8' });

test('the pin is a full sha and is not the base it claims to build on', () => {
  assert.match(WAVE2_BACKEND_PIN, /^[0-9a-f]{40}$/);
  assert.match(WAVE2_BACKEND_BASE, /^[0-9a-f]{40}$/);
  assert.notEqual(WAVE2_BACKEND_PIN, WAVE2_BACKEND_BASE);
});

test('the v2 anchor constants agree byte-for-byte with the pinned backend validator', { skip: !backendRepo }, () => {
  const source = atPin('src/lib/review-anchor.js');
  assert.match(source, new RegExp(`SPATIAL_ANCHOR_TYPE = '${SPATIAL_ANCHOR_TYPE}'`));
  assert.match(source, new RegExp(`COORDINATE_SPACE = '${COORDINATE_SPACE}'`));
  assert.match(source, new RegExp(`INTENT_CHANGE = '${INTENT_CHANGE}'`));
  assert.match(source, new RegExp(`INTENT_REFERENCE = '${INTENT_REFERENCE}'`));
  // Declared as an arithmetic expression (24 * 60 * 60 * 1000) — compare the product,
  // not the spelling.
  const maxTime = /const MAX_TIME_MS = ([\d_* ]+);/.exec(source);
  assert.ok(maxTime, 'MAX_TIME_MS is not declared at the pin');
  const product = maxTime![1].split('*').map((n) => Number(n.trim().replace(/_/g, ''))).reduce((a, b) => a * b, 1);
  assert.equal(MAX_TIME_MS, product);
  const maxEdge = /const MAX_VISUAL_EDGE = ([\d_]+);/.exec(source);
  assert.ok(maxEdge, 'MAX_VISUAL_EDGE is not declared at the pin');
  assert.equal(MAX_VISUAL_EDGE, Number(maxEdge![1].replace(/_/g, '')));
});

test('the anchor validator at the pin is byte-identical to the one at backend MAIN — 0155 unchanged', { skip: !backendRepo }, () => {
  assert.equal(atPin('src/lib/review-anchor.js'), atPin('src/lib/review-anchor.js', WAVE2_BACKEND_BASE),
    'the Wave 2 branch was never supposed to edit the anchor contract itself');
});

test('the evidence routes this dashboard calls exist at the pin, on the JWT router', { skip: !backendRepo }, () => {
  const route = atPin('src/routes/review.js');
  const request = resolveReviewAction('request_evidence', { issueId: 'dddddddd-1111-4111-8111-111111111111' });
  const status = resolveReviewAction('evidence_status', { sessionId: 'aaaaaaaa-1111-4111-8111-111111111111' });
  assert.ok(typeof request === 'object' && typeof status === 'object');
  assert.match(route, /router\.post\('\/issues\/:issueId\/evidence'/,
    'the capture-request route this dashboard posts to is gone at the pin');
  assert.match(route, /router\.get\('\/sessions\/:sessionId\/evidence'/,
    'the polling route this dashboard reads is gone at the pin');
  // And the client emits exactly those paths.
  assert.match((request as { path: string }).path, /\/api\/v2\/review\/issues\/[0-9a-f-]+\/evidence$/);
  assert.match((status as { path: string }).path, /\/api\/v2\/review\/sessions\/[0-9a-f-]+\/evidence$/);
});

test('the submission gate refusal carries the fields the footer reads', { skip: !backendRepo }, () => {
  const service = atPin('src/services/run-review.service.js');
  assert.match(service, /evidencePending: true/,
    'the compile gate no longer refuses with evidencePending — the blocked-submit copy would lie');
  assert.match(service, /pendingEvidenceIssueIds/,
    'the per-issue pending list is gone — retry cannot name what failed');
});

test('ready is the only green: the pinned projection grants ready:true exactly once', { skip: !backendRepo }, () => {
  const lib = atPin('src/lib/review-evidence.js');
  const grants = lib.match(/ready: true/g) || [];
  assert.equal(grants.length, 1,
    'publicEvidence grants ready in more than one branch — pending/stale frames could read as verified');
});
