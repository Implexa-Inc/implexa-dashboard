import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(process.cwd(), 'app', '(dashboard)', '_components');
const comp = readFileSync(join(dir, 'run-judgment-pending.tsx'), 'utf8');
const runPage = readFileSync(join(process.cwd(), 'app', '(dashboard)', 'runs', '[id]', 'page.tsx'), 'utf8');

// THE BUG: a run had a recorded `run_judgments` row (verdict: uncertain), but
// the page still showed "Implexa Judge is reviewing this run". Root cause: the
// polling loop stopped calling router.refresh() after a fixed 24 polls
// (2 minutes) and never resumed — a real video Judge review (artifact
// inspection, media probes) can easily take longer than that, so the page
// froze on the stale "reviewing" render until a manual reload.
test('polling has NO fixed poll-count cap — a real review can outlast 2 minutes', () => {
  assert.doesNotMatch(comp, /polls\s*>=\s*24/, 'the old hard-stop-after-24-polls must be gone');
  assert.doesNotMatch(comp, /clearInterval\(timer\);\s*\/\/\s*two-minute live window/,
    'the old "give up after two minutes" comment/logic must not survive');
});

test('polling backs off from fast to slow instead of running forever at one cadence', () => {
  assert.match(comp, /FAST_POLL_MS\s*=\s*5000/);
  assert.match(comp, /SLOW_POLL_MS\s*=\s*20000/);
  assert.match(comp, /FAST_POLL_WINDOW_MS/);
  // The scheduling itself must actually branch on elapsed time, not just
  // declare the constants without using them.
  assert.match(comp, /elapsed\s*<\s*FAST_POLL_WINDOW_MS\s*\?\s*FAST_POLL_MS\s*:\s*SLOW_POLL_MS/);
});

test('a genuinely CANCELLED judge request stops polling and shows a terminal message, not indefinite "reviewing"', () => {
  assert.match(comp, /requestStatus\s*===\s*'cancelled'/);
  assert.match(comp, /if \(cancelled\) return;/, 'the poll effect must bail out early for a cancelled request');
  assert.match(comp, /No verdict will be produced for this request\./);
});

test('the run page fetches judge-request status including cancelled, and threads it into BOTH pending banners', () => {
  assert.match(runPage, /\.in\('status', \['pending', 'consumed', 'cancelled'\]\)/,
    'without cancelled in the query, the page can never distinguish a dead request from a live one');
  assert.match(runPage, /judgeRequestStatus\s*=\s*\(jq && jq\.status\)/);
  assert.match(runPage, /<RunJudgmentPending requestStatus=\{judgeRequestStatus\} \/>/,
    'the primary review banner must receive the real status, not render blind');
  assert.match(runPage, /<RunJudgmentPending phase="repair" requestStatus=\{/,
    'the repair-phase banner must also receive status, or it inherits the same stale-poll bug');
});
