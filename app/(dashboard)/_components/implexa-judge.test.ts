import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(process.cwd(), 'app', '(dashboard)', '_components');
const policy = readFileSync(join(dir, 'implexa-judge-policy.tsx'), 'utf8');
const card = readFileSync(join(dir, 'run-judgment-card.tsx'), 'utf8');
const activation = readFileSync(join(dir, 'activation-card.tsx'), 'utf8');
const workflow = readFileSync(join(process.cwd(), 'app', '(dashboard)', 'workflows', '[slug]', 'page.tsx'), 'utf8');
const runPage = readFileSync(join(process.cwd(), 'app', '(dashboard)', 'runs', '[id]', 'page.tsx'), 'utf8');

test('Judge is opt-in at Activate and remains editable in Setup', () => {
  assert.match(activation, /<ImplexaJudgePolicy slug=\{checklist\.slug\} compact/);
  assert.match(workflow, /<ImplexaJudgePolicy slug=\{workflow\.slug\}/);
  assert.match(policy, /mode: next/);
  assert.match(policy, /'every_run'/);
});

test('Judge copy discloses cross-engine preference, fresh fallback, and subscription use', () => {
  assert.match(policy, /Claude reviews Codex, or Codex reviews Claude/);
  assert.match(policy, /new session on the same engine/);
  assert.match(policy, /use your own subscriptions/);
});

test('AI judgment is visibly separate from evidence-based verification', () => {
  assert.match(card, /AI review/);
  assert.match(card, /separate from evidence-based “Verified complete.”/);
});

test('Judge activation discloses bounded automatic repair and human escalation', () => {
  // The disclosure MOVED (2026-07-19) from the always-on description into the
  // auto-repair opt-in, because that is the only mode it is true in. The
  // requirement is unchanged: bounded passes + what escalates to a human must be
  // stated where the user makes the choice.
  assert.match(policy, /up to two repair passes/);
  assert.match(policy, /Missing inputs, new permissions, approvals, and consequential actions/);
  assert.match(policy, /come back to you/);
  assert.match(card, /Automatic repair stopped after/);
  assert.match(card, /Human action required/);
});

test('the toggle knob is ANCHORED — no static-position drift or overflow', () => {
  // Without left-0 the knob falls back to its static position, and a <button>
  // centers its content: off rendered half-on and on overflowed the pill.
  assert.match(policy, /absolute left-0 top-0\.5 h-5 w-5/, 'the knob must be anchored to the track');
  assert.match(policy, /enabled \? 'translate-x-\[22px\]' : 'translate-x-0\.5'/,
    'w-11 track (44px) minus w-5 knob (20px) leaves 22px travel — equal 2px inset both ends');
});

test('turning Judge ON does not opt the user into SPENDING', () => {
  // 'every_run' is in the backend's AUTO_REPAIR_MODES: it queues repair
  // continuations that re-run the agent on the user's own Claude/Codex
  // subscription. Enabling a review feature must land on 'observe'.
  assert.match(policy, /setEnabled = \(enabled: boolean\) => save\(enabled \? 'observe' : 'off'\)/,
    'the switch must enable OBSERVE, never every_run');
  assert.match(policy, /setAutoRepair/, 'auto-repair must be its own explicit control');
});

test('an OBSERVING policy renders as ON, not as Off', () => {
  // The shipped version coerced anything that was not 'every_run' to 'off', so a
  // policy that was actively reviewing every run displayed as disabled.
  assert.match(policy, /const enabled = mode === 'observe' \|\| mode === 'every_run'/);
  assert.doesNotMatch(policy, /const enabled = mode === 'every_run';/,
    'reading only every_run as enabled is the bug that hid observe');
});

test('the always-on copy does not promise repairs that only happen in every_run', () => {
  // Describing work the feature will not do is the same class of lie as an
  // all-clear over an unread source.
  assert.match(policy, /nothing is changed and nothing is re-run unless you turn on automatic repair/i);
});

test('the status line distinguishes reviewing from repairing', () => {
  assert.match(policy, /Reviews every run and reports back/, 'observe must say what it actually does');
  assert.match(policy, /Reviews every run and safely repairs/, 'and every_run must say the stronger thing');
});

test('the run page reads the judgment-origin request rather than guessing repair progress', () => {
  assert.match(runPage, /\.eq\('judge_origin_judgment_id', judgment\.id\)/);
  assert.match(runPage, /<RunJudgmentPending phase="repair"/);
  assert.match(runPage, /repairRequest=\{repairRequest\}/);
});

// ── the agent-header Judge badge ─────────────────────────────────────────────

const slugPage = readFileSync(join(process.cwd(), 'app', '(dashboard)', 'workflows', '[slug]', 'page.tsx'), 'utf8');

test('the header badge distinguishes observe from every_run — one label would hide the spending mode', () => {
  // every_run may RE-RUN the agent on the user's own subscription; observe never
  // does. Collapsing both into "Judge: on" would hide the one that costs money.
  assert.match(slugPage, /judgePolicy === 'observe'/);
  assert.match(slugPage, /judgePolicy === 'every_run'/);
  assert.match(slugPage, /Judge: on · repair/, 'the auto-repair mode must say so');
  assert.doesNotMatch(slugPage, /judgePolicy !== 'off'/,
    'a single !== off badge would collapse the two modes');
});

test('a missing or unreadable Judge policy shows NO badge rather than breaking the page', () => {
  assert.match(slugPage, /\.maybeSingle\(\)\s*\n?\s*\.then\(\(r\) => \(r && r\.data \? r\.data\.mode : null\), \(\) => null\)/,
    'the read degrades to null on both empty and error');
});

// ── Pause must describe something that can actually happen ───────────────────

test('Pause is offered ONLY for a routine that can fire on a clock', () => {
  // Activation writes a scheduled_skills row for every activated agent, including
  // on-demand ones (trigger_type 'on_demand', no cron). Gating Pause on status
  // alone showed the control for agents that were never scheduled and would never
  // fire — the user reads "Pause" as "this is running on a schedule".
  assert.match(slugPage, /function isClockScheduled\(r: Routine\): boolean/);
  assert.match(slugPage, /if \(r\.trigger_type === 'on_demand'\) return false;/,
    'an on-demand row has nothing to pause');
  assert.match(slugPage, /return !!\(r\.cron_expression \|\| r\.fire_at\);/,
    'cron (recurring) or fire_at (one-time) is what makes it real');
  // BOTH pause sites must use it — the catalog page and the schedule-only fallback.
  assert.equal((slugPage.match(/&& isClockScheduled\(r\)\)/g) || []).length, 2,
    'both the workflow page and the skill-only fallback must gate identically');
  // and the columns it depends on must actually be selected
  assert.equal((slugPage.match(/claude_task_id, trigger_type, fire_at'\)/g) || []).length, 2,
    'both queries must select trigger_type + fire_at or the predicate reads undefined');
});
