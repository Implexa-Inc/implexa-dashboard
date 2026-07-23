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
  assert.match(comp, /if \(cancelled \|\| stalled\) return;/, 'the poll effect must bail out early for a cancelled OR stalled request');
  assert.match(comp, /No verdict will be produced for this request\./);
});

// ── Stall ceiling (review follow-up): run_requests has no 'failed' status —
// a worker crashing right after CLAIMING (consumed) the request leaves it
// stuck there forever with no terminal marker at all. Without a client-side
// deadline, an open tab would call router.refresh() every 20s indefinitely.
test('a request outstanding past the stall ceiling stops polling and shows its own message — not indefinite "reviewing"', () => {
  assert.match(comp, /STALL_CEILING_MS\s*=\s*20\s*\*\s*60\s*\*\s*1000/, '20 minutes, not a shorter window that would fire on a genuinely slow review');
  assert.match(comp, /const parsedAgeMs\s*=\s*createdAt\s*\?\s*Date\.now\(\)\s*-\s*new Date\(createdAt\)\.getTime\(\)\s*:\s*0;/);
  assert.match(comp, /const stalled\s*=\s*!cancelled\s*&&\s*ageMs\s*>\s*STALL_CEILING_MS;/,
    'stalled must be independent of (not overridden by) the cancelled state');
  assert.match(comp, /taking unusually long/i);
  assert.doesNotMatch(comp, /taking unusually long[\s\S]{0,400}Implexa Judge is reviewing this run/,
    'the stalled message must REPLACE the reviewing banner, not render alongside it');
});

test('with no createdAt (older callers / migration not applied), age is treated as zero — never stalled by default', () => {
  // createdAt is optional; a caller that cannot supply it must not have every
  // request immediately read as infinitely aged and stalled.
  assert.match(comp, /createdAt\s*\?\s*Date\.now\(\)\s*-\s*new Date\(createdAt\)\.getTime\(\)\s*:\s*0/);
});

// ── Fail CLOSED on a corrupt timestamp (review follow-up) ────────────────────
// Date.now() - NaN = NaN, and NaN > STALL_CEILING_MS is ALWAYS false in JS —
// so a malformed createdAt used to silently bypass the ceiling and poll
// forever, the exact failure mode this component exists to prevent. An
// invalid (non-null, unparseable) timestamp must be treated as ALREADY
// stalled, not as ageless — distinct from a genuinely MISSING createdAt,
// which stays ageless (0ms) since older callers may not supply it at all.
test('an INVALID createdAt is treated as already stalled (fail closed), not silently unstalled forever', () => {
  assert.match(comp, /const invalidCreatedAt = createdAt != null && Number\.isNaN\(parsedAgeMs\);/,
    'a corrupt (non-null) timestamp must be distinguished from a genuinely missing one');
  assert.match(comp, /const ageMs = invalidCreatedAt \? Infinity : parsedAgeMs;/,
    'an invalid timestamp must compute as maximally aged, not as zero/ageless');
});

test('the invalid-timestamp fix does not change behavior for a genuinely missing createdAt', () => {
  // Re-runs the exact scenario from the fake-behavior perspective: this pins
  // that `createdAt != null` (not just `createdAt`) gates invalidCreatedAt, so
  // `createdAt === null` still short-circuits parsedAgeMs to 0 and never
  // trips invalidCreatedAt.
  assert.match(comp, /const parsedAgeMs = createdAt \? Date\.now\(\) - new Date\(createdAt\)\.getTime\(\) : 0;/);
});

test('the run page fetches judge-request status AND created_at, and threads both into BOTH pending banners', () => {
  assert.match(runPage, /\.in\('status', \['pending', 'consumed', 'cancelled'\]\)/,
    'without cancelled in the query, the page can never distinguish a dead request from a live one');
  assert.match(runPage, /\.select\('status, created_at'\)\.eq\('judge_target_run_id', params\.id\)/,
    'created_at must be selected, or the client has no way to compute a stall ceiling');
  assert.match(runPage, /judgeRequestStatus\s*=\s*\(jq && jq\.status\)/);
  assert.match(runPage, /judgeRequestCreatedAt\s*=\s*\(jq && jq\.created_at\)/);
  assert.match(runPage, /<RunJudgmentPending requestStatus=\{judgeRequestStatus\} createdAt=\{judgeRequestCreatedAt\} \/>/,
    'the primary review banner must receive BOTH the real status and its age, not render blind');
  assert.match(runPage, /\.select\('status, run_id, created_at'\)\.eq\('judge_origin_judgment_id', judgment\.id\)/,
    'the repair request query must also carry created_at, or the repair banner is exempt from the same stall protection');
  assert.match(runPage, /<RunJudgmentPending phase="repair" requestStatus=\{[^}]+\} createdAt=\{repairRequest\?\.created_at \|\| null\} \/>/,
    'the repair-phase banner must also receive status + age, or it inherits the same unbounded-poll risk');
});
