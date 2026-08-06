import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.join(process.cwd(), 'app/(dashboard)/_components/running-agents.tsx'), 'utf8');

test('revise request cards render every request-level lifecycle phase', () => {
  for (const status of ['picked_up', 'running', 'verifying', 'built', 'failed']) {
    assert.match(source, new RegExp(`\\b${status}:`), `${status} needs explicit card copy`);
  }
});

test('the queued wait notice is gated on the canonical queued status', () => {
  assert.match(source, /queuedWaitNotice\(\{[\s\S]*?status:\s*c\.status/);
  assert.match(source, /c\.status === 'queued' && c\.requestId/);
  assert.doesNotMatch(source, /picked_up[^\n]*Waiting to be picked up/i);
});
