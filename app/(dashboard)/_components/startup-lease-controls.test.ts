import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const running = fs.readFileSync(path.join(process.cwd(), 'app/(dashboard)/_components/running-agents.tsx'), 'utf8');
const building = fs.readFileSync(path.join(process.cwd(), 'app/(dashboard)/_components/building-agents.tsx'), 'utf8');

test('claim-only requests expose Cancel, never Stop', () => {
  assert.match(running, /\['queued', 'selecting', 'picked_up', 'starting', 'switching', 'resuming'\][\s\S]*c\.requestId && !c\.runId/);
  assert.match(running, /c\.status === 'running' && \(c\.runId \|\| c\.requestId\)/);
  assert.match(running, /const isRunningCancel = \(c:[^\n]+c\.status === 'running' && !!\(c\.runId \|\| c\.requestId\)/);
  assert.match(running, />\s*Cancel request\s*<\/button>/);
  assert.match(running, />\s*Stop run\s*<\/button>/);
});

test('startup has distinct in-flight and terminal copy', () => {
  for (const phrase of ['Starting executor', 'Start failed', 'Claim expired']) {
    assert.match(running + building, new RegExp(phrase));
  }
});

test('startup failures remain visible on Home and can notify the owner', () => {
  assert.match(running, /const NOTIFY:[^\n]+\['waiting_approval', 'needs_attention', 'fallback_blocked', 'start_failed', 'claim_expired', 'failed'/);
  assert.match(running, /\(!c\.runId && !c\.requestId\)/, 'a request-only failure must not be filtered out of notifications');
});

test('terminal startup failures expose a Retry path', () => {
  assert.match(running, /c\.status === 'start_failed' \|\| c\.status === 'claim_expired'/);
  assert.match(running, />\s*Retry from agent\s*<\/Link>/);
});

test('cancel copy does not claim the request is still unpicked', () => {
  assert.doesNotMatch(running, /before your Claude picks it up/);
  assert.match(running, /closes that claim without inventing a run/);
});
