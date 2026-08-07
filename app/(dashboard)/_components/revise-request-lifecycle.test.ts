import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.join(process.cwd(), 'app/(dashboard)/_components/running-agents.tsx'), 'utf8');

test('revise request cards render every request-level lifecycle phase', () => {
  for (const status of ['picked_up', 'starting', 'running', 'verifying', 'built', 'start_failed', 'claim_expired', 'failed']) {
    assert.match(source, new RegExp(`\\b${status}:`), `${status} needs explicit card copy`);
  }
});

test('the queued wait notice is gated on the canonical queued status', () => {
  assert.match(source, /queuedWaitNotice\(\{[\s\S]*?status:\s*c\.status/);
  assert.match(source, /\['queued', 'picked_up', 'starting'\][\s\S]*\.includes\(c\.status\)[\s\S]*c\.requestId && !c\.runId/);
  assert.doesNotMatch(source, /picked_up[^\n]*Waiting to be picked up/i);
});

test('the backend lifecycle projection is consumed rather than emitted as dead data', () => {
  assert.match(source, /function statusFromLifecycle\(card: LiveCard\)/);
  assert.match(source, /items\.map\(\(card\) => \(\{ \.\.\.card, status: statusFromLifecycle\(card\) \}\)\)/);
});

test('a failed revise card shows the backend failure cause, not only the edit request text', () => {
  assert.match(source, /failureReason\?: string \| null/);
  assert.match(source, /\['failed', 'start_failed', 'claim_expired'\][\s\S]*\.includes\(c\.status\) && c\.failureReason/);
  assert.match(source, /\{c\.failureReason\}/);
});
