// node --test lib/schedule-readiness.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensureScheduleReadinessAfterSave } from './schedule-readiness.ts';

test('successful schedule setup asks a supported desktop to ensure readiness', async () => {
  let calls = 0;
  const result = await ensureScheduleReadinessAfterSave({
    ensureScheduleReadiness: async () => {
      calls += 1;
      return { status: 'action_required', reason: 'ac_system_sleep_enabled' };
    },
  });
  assert.equal(calls, 1);
  assert.equal(result?.status, 'action_required');
});

test('web/old-desktop and bridge failures cannot turn a saved schedule into an error', async () => {
  assert.equal(await ensureScheduleReadinessAfterSave(null), null);
  assert.equal(await ensureScheduleReadinessAfterSave({
    ensureScheduleReadiness: async () => { throw new Error('old app'); },
  }), null);
});

test('every dashboard schedule-creation pipe invokes the one readiness helper', () => {
  const activation = readFileSync(join(process.cwd(), 'app', '(dashboard)', '_components', 'activation-card.tsx'), 'utf8');
  const recurring = readFileSync(join(process.cwd(), 'app', '(dashboard)', '_components', 'make-recurring.tsx'), 'utf8');
  assert.match(activation, /await callBackend\([\s\S]*?void ensureScheduleReadinessAfterSave\(\)[\s\S]*?onSaved\(\)/);
  assert.match(recurring, /await callBackend\([\s\S]*?void ensureScheduleReadinessAfterSave\(\)[\s\S]*?setSavedNl\(nl\)/);
});

test('Routines renders readiness only when schedules exist and unknown is never green', () => {
  const page = readFileSync(join(process.cwd(), 'app', '(dashboard)', 'scheduled', 'page.tsx'), 'utf8');
  const card = readFileSync(join(process.cwd(), 'app', '(dashboard)', 'scheduled', 'schedule-readiness-card.tsx'), 'utf8');
  assert.match(page, /\{items\.length > 0 && <ScheduleReadinessCard \/>\}/);
  assert.match(card, /if \(state\.status === 'loading' \|\| state\.status === 'web'\) return null/);
  assert.match(card, /const ready = state\.status === 'ready'/);
  assert.doesNotMatch(card, /status !== 'action_required'.*ready/);
});
