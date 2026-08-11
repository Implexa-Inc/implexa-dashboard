import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const source = fs.readFileSync(path.join(process.cwd(), 'app/(dashboard)/_components/running-agents.tsx'), 'utf8');
const fixture = JSON.parse(fs.readFileSync(
  path.join(process.cwd(), 'app/(dashboard)/_components/backend-step-safe-contract.json'), 'utf8',
)) as { lifecycleStates: string[] };

test('consumes the backend-produced lifecycle contract', () => {
  for (const state of ['selecting_executor', 'switching_executor', 'resuming', 'fallback_blocked']) {
    assert.ok(fixture.lifecycleStates.includes(state), `backend fixture omitted ${state}`);
    assert.match(source, new RegExp(state));
  }
});

test('renders every executor fallback lifecycle state distinctly', () => {
  for (const phrase of [
    'Selecting executor', 'Starting the selected executor', 'Switching executor',
    'Resuming from the last safe step', 'Running',
    'Fallback blocked: consequential state uncertain', 'Failed', 'Needs attention',
  ]) assert.match(source, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('Cancel remains pre-live and Stop is fenced to running only', () => {
  assert.match(source, /\['queued', 'selecting', 'picked_up', 'starting', 'switching', 'resuming'\]/);
  assert.match(source, /c\.status === 'running'[\s\S]{0,700}Stop run/);
  assert.doesNotMatch(source, /c\.status === 'switching'[\s\S]{0,120}Stop run/);
});

test('run detail metadata includes original attempt reason and resume step', () => {
  assert.match(source, /fallbackFromAttemptId/);
  assert.match(source, /fallbackReason/);
  assert.match(source, /Resuming from step/);
});
