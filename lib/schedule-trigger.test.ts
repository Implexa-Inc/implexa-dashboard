// node --test lib/schedule-trigger.test.ts
//
// These are BEHAVIOURAL: the predicate is pure, so the regression that shipped can
// be reproduced directly rather than asserted about source text.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isPausableRoutine, isOnDemandRoutine } from './schedule-trigger.ts';

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
