// node --test lib/schedule-trigger.test.ts
//
// These are BEHAVIOURAL: the predicate is pure, so the regression that shipped can
// be reproduced directly rather than asserted about source text.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isPausableRoutine, isOnDemandRoutine, cronToPickerState } from './schedule-trigger.ts';

test('on_demand is the ONLY thing with nothing to pause', () => {
  assert.equal(isPausableRoutine({ trigger_type: 'on_demand', cron_expression: null, fire_at: null }), false);
  assert.equal(isOnDemandRoutine({ trigger_type: 'on_demand' }), true);
});

test('REGRESSION: watch/until stay pausable despite cron_expression = null', () => {
  // _insertWorkflowWatchRoutine writes cron_expression: null on purpose — these are
  // fired by a Claude /loop session. Requiring cron/fire_at (the first fix) hid
  // Pause for genuinely RUNNING routines, so the user lost the only control that
  // stops them. That is worse than the phantom-Pause bug it was fixing.
  assert.equal(isPausableRoutine({ trigger_type: 'watch', cron_expression: null, fire_at: null }), true,
    'an active watch routine must remain pausable');
  assert.equal(isPausableRoutine({ trigger_type: 'until', cron_expression: null, fire_at: null }), true,
    'an active until routine must remain pausable');
});

test('clock-driven triggers are pausable', () => {
  assert.equal(isPausableRoutine({ trigger_type: 'cron', cron_expression: '0 9 * * *' }), true);
  assert.equal(isPausableRoutine({ trigger_type: 'once', fire_at: '2026-07-21T09:00:00Z' }), true);
});

test('an unknown/absent trigger stays pausable — fail toward keeping the control', () => {
  // Losing the ability to stop a running routine is the expensive direction.
  assert.equal(isPausableRoutine({}), true);
  assert.equal(isPausableRoutine({ trigger_type: null }), true);
});

test('the TYPE models every value the database allows (0073)', () => {
  // The original defect: types said 'cron'|'watch'|'until', so TS asserted
  // on_demand could not exist and nothing was forced to handle it.
  const src = readFileSync(join(process.cwd(), 'lib', 'schedule-trigger.ts'), 'utf8');
  for (const v of ['cron', 'watch', 'until', 'once', 'on_demand']) {
    assert.match(src, new RegExp(`'${v}'`), `TriggerType must include ${v}`);
  }
  for (const p of ['app/(dashboard)/scheduled/page.tsx', 'app/(dashboard)/scheduled/schedule-row.tsx']) {
    const f = readFileSync(join(process.cwd(), p), 'utf8');
    assert.doesNotMatch(f, /trigger_type\?:\s*'cron' \| 'watch' \| 'until'/,
      `${p} must not re-declare a union that omits on_demand/once`);
  }
});

test('the Routines list excludes on_demand — it is not autopilot', () => {
  const f = readFileSync(join(process.cwd(), 'app', '(dashboard)', 'scheduled', 'page.tsx'), 'utf8');
  assert.match(f, /\.filter\(\(r\) => !isOnDemandRoutine\(r\)\)/);
});

// ── cronToPickerState: the "edit opens on the ACTUAL schedule" fix ───────────

test('THE BUG: noon daily hydrates to 12:00, not the hard-coded 09:00', () => {
  // "daily at 12pm" → cron 0 12 * * *. The editor must open on 12:00.
  assert.deepEqual(cronToPickerState('0 12 * * *'), { freq: 'day', time: '12:00', weekday: 1 });
});

test('every picker-emitted cron shape round-trips to its picker state', () => {
  assert.deepEqual(cronToPickerState('0 9 * * *'), { freq: 'day', time: '09:00', weekday: 1 });
  assert.deepEqual(cronToPickerState('30 6 * * *'), { freq: 'day', time: '06:30', weekday: 1 });
  assert.deepEqual(cronToPickerState('0 9 * * 1-5'), { freq: 'weekday', time: '09:00', weekday: 1 });
  assert.deepEqual(cronToPickerState('0 14 * * 3'), { freq: 'week', time: '14:00', weekday: 3 });
  assert.deepEqual(cronToPickerState('0 0 * * 0'), { freq: 'week', time: '00:00', weekday: 0 });
  assert.equal(cronToPickerState('0 * * * *')?.freq, 'hour');
});

test('a cron the picker cannot represent returns null (caller falls back to defaults, never a WRONG prefill)', () => {
  assert.equal(cronToPickerState('0 9 1 * *'), null);      // day-of-month
  assert.equal(cronToPickerState('0 9 * 6 *'), null);      // specific month
  assert.equal(cronToPickerState('*/15 9 * * *'), null);   // minute step the picker has no control for
  assert.equal(cronToPickerState('0 9 * * 1,3,5'), null);  // dow list
  assert.equal(cronToPickerState('0 25 * * *'), null);     // out-of-range hour
  assert.equal(cronToPickerState(''), null);
  assert.equal(cronToPickerState(null), null);
  assert.equal(cronToPickerState('nonsense'), null);
});

// ── the Judge verdict must be reachable from where results are READ ──────────

test('the inbox overlay surfaces the Judge verdict AND a run permalink', () => {
  // The verdict rendered only on /runs/<id>, and the overlay linked nowhere — so
  // once a result was open the review was unreachable. Founder, during the smoke
  // test: "I have no clue how to check it again."
  const overlay = readFileSync(join(process.cwd(), 'app', '(dashboard)', 'inbox', 'inbox-list.tsx'), 'utf8');
  assert.match(overlay, /openItem\.judgment && \(/, 'the overlay must render the verdict');
  assert.match(overlay, /Full review, evidence/, 'and route to the full card for the detail');
  assert.match(overlay, /Open full run/, 'a permalink must exist even with no verdict');
});

test('a missing run_judgments table costs the VERDICT, never the inbox', () => {
  // Same isolation the recommendations fetch uses: pre-0121 the table may not
  // exist, and an inbox that empties itself is far worse than a missing badge.
  const loader = readFileSync(join(process.cwd(), 'lib', 'inbox.ts'), 'utf8');
  const block = loader.slice(loader.indexOf('const judgmentByRun'), loader.indexOf('return runs'));
  assert.match(block, /try \{/, 'the judgment fetch must be isolated');
  assert.match(block, /catch \{/);
  assert.match(block, /\.from\('run_judgments'\)/);
});
