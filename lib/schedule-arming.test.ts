// node --test lib/schedule-arming.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isArmed, isNeverArmed, isImplexaOwned, type ArmingRow } from './schedule-arming.ts';

const row = (over: Partial<ArmingRow> = {}): ArmingRow => ({
  status: 'active', claude_task_id: null, scheduler_owner: null, ...over,
});

// ── THE FOUNDER-HIT BUG (2026-07-24) ────────────────────────────────────────
// An implexa-owned schedule is fired by the BACKEND cron evaluator and is
// deliberately never armed as a native routine, so claude_task_id is null
// permanently and by design. Reading that as "never armed" produced a Home row
// that was false, gave advice that was wrong for a backend-fired schedule
// ("keep the Claude app open"), and could NEVER be cleared by the user.

test('an implexa-owned schedule with NO claude_task_id is NOT unarmed — the backend fires it', () => {
  const r = row({ scheduler_owner: 'implexa', claude_task_id: null });
  assert.equal(isNeverArmed(r), false, 'this is the unclearable false alarm the fix removes');
  assert.equal(isArmed(r), true, 'the backend cron evaluator IS what fires it');
});

test('a NATIVE routine with no claude_task_id is still genuinely unarmed', () => {
  // The original signal must keep working — this is real, actionable, and the
  // user really can fix it by opening the app.
  const r = row({ scheduler_owner: null, claude_task_id: null });
  assert.equal(isNeverArmed(r), true);
  assert.equal(isArmed(r), false);
});

test('a native routine that HAS been armed is armed and not flagged', () => {
  const r = row({ claude_task_id: 'implexa-daily-reel' });
  assert.equal(isNeverArmed(r), false);
  assert.equal(isArmed(r), true);
});

test('only status=active can be "never armed" — a paused/failed row is a different state', () => {
  for (const status of ['paused', 'failed', 'archived']) {
    assert.equal(isNeverArmed(row({ status })), false, status);
  }
});

test('isArmed is what makes an implexa-owned schedule ELIGIBLE for the overdue check', () => {
  // The mirror-image bug: gating overdue on claude_task_id meant an implexa-owned
  // schedule that genuinely stopped firing could never be reported — a false
  // all-clear on exactly the rows the backend scheduler now owns.
  assert.equal(isArmed(row({ scheduler_owner: 'implexa', claude_task_id: null })), true);
});

test('an unknown/absent scheduler_owner is treated as NATIVE — fail toward the actionable signal', () => {
  // Degrading an unrecognised owner to "implexa" would silently suppress a real
  // unarmed routine. Suppressing a true alarm is worse than showing a fixable one.
  assert.equal(isImplexaOwned(row({ scheduler_owner: 'something-new' })), false);
  assert.equal(isNeverArmed(row({ scheduler_owner: 'something-new', claude_task_id: null })), true);
  assert.equal(isImplexaOwned(row({ scheduler_owner: undefined })), false);
});
