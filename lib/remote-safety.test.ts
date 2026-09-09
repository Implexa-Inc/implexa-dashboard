// node --test lib/remote-safety.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { remoteSafety } from './remote-safety.ts';

const workflow = (steps: Array<Record<string, unknown>>) => ({ steps }) as never;

test('a Remotion browser executable is local tooling, not Chrome-session automation', () => {
  const safety = remoteSafety(workflow([{
    order: 2, kind: 'tool', ref: null, fallbacks: [],
    label: 'Resolve a local Remotion browser executable. Keep the browser path out of the portable bundle.',
  }]));
  assert.equal(safety.verdict, 'local');
  assert.match(safety.reason, /without requiring a signed-in browser/);
  assert.doesNotMatch(safety.reason, /site with no API/);
});

test('actual signed-in browser work remains local for the browser reason', () => {
  const safety = remoteSafety(workflow([{
    order: 1, kind: 'tool', ref: null, fallbacks: [],
    label: 'Open the CRM web portal in the browser and click through the account.',
  }]));
  assert.equal(safety.verdict, 'local');
  assert.match(safety.reason, /site with no API/);
});
