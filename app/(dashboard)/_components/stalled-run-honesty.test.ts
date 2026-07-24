// node --test "app/(dashboard)/_components/stalled-run-honesty.test.ts"
//
// THE INCIDENT (2026-07-23). A Continue silently never ran. Implexa Manager
// diagnosed it correctly — but the dashboard buried that under a hard-coded
// guess: every `needs_attention` run rendered "most likely it's waiting on a
// permission" and offered browser permissions, an action that could not possibly
// help. The run detail page then linked the agent's last SUCCESSFUL run, so
// "view the reason" opened a completed deliverable and implied the work had
// happened. These pin that the UI stops asserting a cause it doesn't know.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = import.meta.dirname;
const running = readFileSync(join(dir, 'running-agents.tsx'), 'utf8');
const runPage = readFileSync(join(dir, '..', 'runs', '[id]', 'page.tsx'), 'utf8');

test('a needs_attention run no longer ASSERTS a permission cause', () => {
  assert.doesNotMatch(running, /This run stalled — most likely it’s waiting on a permission/,
    'the hard-coded guess that sent the user to the wrong action must be gone');
});

test('a needs_attention run points at its own diagnosis instead of guessing', () => {
  const i = running.indexOf("c.status === 'needs_attention' ? (");
  assert.notEqual(i, -1, 'needs_attention must take its own branch');
  // Slice to the ternary's `) : (` so this reads ONLY the needs_attention arm —
  // the else arm legitimately keeps StuckRunButton for the soft-stuck case.
  const branch = running.slice(i, running.indexOf(') : (', i));
  assert.match(branch, /needs you/i, 'it states the honest fact: it stopped and needs you');
  assert.match(branch, /\/runs\/\$\{c\.runId\}/, 'and links the run, where the real reason lives');
  assert.doesNotMatch(branch, /StuckRunButton/,
    'the permission shortcut must NOT be offered when something already determined a real cause');
});

test('the permission shortcut survives ONLY for the soft heartbeat-stale signal', () => {
  // `stuck` (a running run whose heartbeat went stale) genuinely does correlate
  // with a pending permission prompt — that offer stays. The distinction is the
  // whole fix: guess only where there is nothing better.
  assert.match(running, /StuckRunButton/, 'the soft-stuck path keeps the approve shortcut');
  assert.match(running, /if it’s waiting on a permission to continue, you can approve it now/,
    'and keeps its appropriately hedged wording');
});

test('the run page never links a prior SUCCESSFUL run as "the reason"', () => {
  const i = runPage.indexOf('let siblingRun');
  assert.notEqual(i, -1);
  const block = runPage.slice(i, i + 1400);
  assert.match(block, /\.neq\('run_state', 'completed'\)/,
    'a completed run\'s output is a deliverable, not an explanation of why THIS run stopped — '
    + 'linking it is what made a never-run Continue look like it had succeeded');
});
