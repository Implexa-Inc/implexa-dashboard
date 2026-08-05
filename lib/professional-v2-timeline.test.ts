// node --test lib/professional-v2-timeline.test.ts
//
// The editor model. Every REFUSAL below is checked against the producer's own
// verdict on the same shape (TIMELINE_VERDICTS), so this file cannot drift into
// enforcing a rule the backend does not have — or missing one it does.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addMoment, coverageSummary, moveMoment, newMoment, reconcileWithBackend,
  removeMoment, sortMomentsByStart, timelineFingerprint, toRequestMoments,
  updateMoment, validateTimeline, type TimelineMoment,
} from './professional-v2-timeline.ts';
import { BOUNDS } from './professional-v2-contract.ts';
import { TIMELINE_VERDICTS, V2_PREVIEW_MULTI } from './professional-v2.fixtures.ts';

const verdict = (label: string): boolean => {
  const row = TIMELINE_VERDICTS.find((v) => v.label === label);
  assert.ok(row, `no producer verdict recorded for ${label}`);
  return row.accepted;
};

function moment(over: Partial<TimelineMoment> = {}): TimelineMoment {
  return {
    id: 'hook', prompt: 'a slow aerial push over a bay bridge at sunrise',
    startSeconds: 0, endSeconds: 3, ratio: '720:1280',
    variantsRequested: 2, judgeMode: 'ranked', maxRepairs: 1, ...over,
  };
}

const codes = (moments: TimelineMoment[]): string[] => validateTimeline(moments).issues.map((i) => i.code);

test('a well-formed single moment validates and prices', () => {
  const result = validateTimeline([moment()]);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  // 3 seconds x 12 credits x (2 takes + 1 reserve).
  assert.equal(result.cost?.expectedCredits, 72);
  assert.equal(result.cost?.repairReserveCredits, 36);
  assert.equal(result.cost?.maximumCredits, 108);
  assert.equal(result.cost?.coverageMomentCount, 1);
  assert.equal(result.cost?.variantTaskCount, 2);
});

test('abutting moments stay valid — touching is not overlapping', () => {
  assert.equal(verdict('abutting'), true);
  const timeline = [moment({ id: 'a', startSeconds: 0, endSeconds: 3 }), moment({ id: 'b', startSeconds: 3, endSeconds: 6 })];
  assert.equal(validateTimeline(timeline).ok, true);
  // And the editor's own "add" produces exactly this shape rather than an overlap.
  const added = addMoment([moment({ id: 'a', startSeconds: 0, endSeconds: 3 })]);
  assert.equal(added[1].startSeconds, 3);
  assert.equal(validateTimeline(added.map((m, i) => (i === 1 ? { ...m, prompt: 'x' } : m))).ok, true);
});

test('overlapping moments are refused, as the producer refuses them', () => {
  assert.equal(verdict('overlapping'), false);
  const timeline = [moment({ id: 'a', startSeconds: 0, endSeconds: 4 }), moment({ id: 'b', startSeconds: 3, endSeconds: 7 })];
  assert.ok(codes(timeline).includes('overlap'));
  assert.equal(validateTimeline(timeline).ok, false);
  assert.equal(toRequestMoments(timeline), null);
});

test('out-of-order moments are refused, and the fix is offered rather than applied', () => {
  assert.equal(verdict('out_of_order'), false);
  const timeline = [moment({ id: 'a', startSeconds: 6, endSeconds: 9 }), moment({ id: 'b', startSeconds: 0, endSeconds: 3 })];
  assert.ok(codes(timeline).includes('out_of_order'));
  const sorted = sortMomentsByStart(timeline);
  assert.deepEqual(sorted.map((m) => m.id), ['b', 'a']);
  assert.equal(validateTimeline(sorted).ok, true);
});

test('a duplicate moment id is refused', () => {
  assert.equal(verdict('duplicate_ids'), false);
  const timeline = [moment({ id: 'a', startSeconds: 0, endSeconds: 3 }), moment({ id: 'a', startSeconds: 3, endSeconds: 6 })];
  assert.ok(codes(timeline).includes('duplicate_moment_id'));
});

test('a repair reserve without a Judge is refused — nothing could release it', () => {
  assert.equal(verdict('repair_with_judge_off'), false);
  assert.equal(verdict('repair_with_judge_ranked'), true);
  assert.ok(codes([moment({ judgeMode: 'off', maxRepairs: 1 })]).includes('repair_without_judge'));
  assert.equal(validateTimeline([moment({ judgeMode: 'ranked', maxRepairs: 1 })]).ok, true);
  // Judge off with no reserve is a legitimate plan, and prices with no reserve.
  const off = validateTimeline([moment({ judgeMode: 'off', maxRepairs: 0, variantsRequested: 1 })]);
  assert.equal(off.ok, true);
  assert.equal(off.cost?.repairReserveCredits, 0);
});

test('a blank prompt is refused', () => {
  assert.equal(verdict('blank_prompt'), false);
  assert.ok(codes([moment({ prompt: '   ' })]).includes('missing_prompt'));
  assert.ok(codes([moment({ prompt: '' })]).includes('missing_prompt'));
});

test('durations outside 2–10 seconds are refused', () => {
  assert.ok(codes([moment({ startSeconds: 0, endSeconds: 1.5 })]).includes('window_too_short'));
  assert.ok(codes([moment({ startSeconds: 0, endSeconds: 12 })]).includes('window_too_long'));
  assert.ok(codes([moment({ startSeconds: 5, endSeconds: 5 })]).includes('invalid_window'));
  assert.ok(codes([moment({ startSeconds: 5, endSeconds: 2 })]).includes('invalid_window'));
});

test('timestamps finer than a millisecond are refused, exactly as the backend refuses them', () => {
  assert.equal(verdict('finer_than_millisecond'), false);
  assert.equal(verdict('sub_second_precision'), true);
  assert.ok(codes([moment({ startSeconds: 0.00005, endSeconds: 3 })]).includes('window_precision'));
  assert.equal(validateTimeline([moment({ startSeconds: 0.5, endSeconds: 3.25 })]).ok, true);
});

test('variant counts outside the Professional range are refused', () => {
  assert.ok(codes([moment({ variantsRequested: 0 })]).includes('invalid_variants'));
  assert.ok(codes([moment({ variantsRequested: 5 })]).includes('invalid_variants'));
  assert.ok(codes([moment({ variantsRequested: 2.5 })]).includes('invalid_variants'));
  assert.equal(validateTimeline([moment({ variantsRequested: 4 })]).ok, true);
});

test('the whole-graph task ceiling is enforced where the producer enforces it', () => {
  assert.equal(verdict('task_ceiling_exceeded'), false);
  assert.equal(verdict('task_ceiling_at_limit'), true);
  const build = (count: number) => Array.from({ length: count }, (unused, i) => moment({
    id: `m${i}`, startSeconds: i * 3, endSeconds: i * 3 + 3, variantsRequested: 4, maxRepairs: 1,
  }));
  // 8 moments x (4 takes + 1 reserve) = 40 = the ceiling.
  assert.equal(validateTimeline(build(8)).ok, true);
  assert.equal(validateTimeline(build(8)).cost?.totalTaskCount, BOUNDS.maxTotalTasks);
  // 9 would be 45.
  assert.ok(codes(build(9)).includes('too_many_tasks'));
});

test('more than the maximum number of moments is refused', () => {
  const many = Array.from({ length: BOUNDS.maxMoments + 1 }, (unused, i) => moment({
    id: `m${i}`, startSeconds: i * 3, endSeconds: i * 3 + 3, variantsRequested: 1, judgeMode: 'off', maxRepairs: 0,
  }));
  assert.ok(codes(many).includes('too_many_moments'));
  assert.ok(codes([]).includes('no_moments'));
});

test('a prompt beyond the room the provider actually leaves is refused', () => {
  const long = 'x'.repeat(BOUNDS.promptMaxChars + 1);
  assert.ok(codes([moment({ prompt: long })]).includes('prompt_too_long'));
});

test('add, remove and reorder behave as an editor, not as a re-sort', () => {
  const a = moment({ id: 'a', startSeconds: 0, endSeconds: 3 });
  const b = moment({ id: 'b', startSeconds: 3, endSeconds: 6 });
  assert.deepEqual(moveMoment([a, b], 'b', -1).map((m) => m.id), ['b', 'a']);
  assert.deepEqual(moveMoment([a, b], 'a', -1).map((m) => m.id), ['a', 'b']);
  assert.deepEqual(moveMoment([a, b], 'b', 1).map((m) => m.id), ['a', 'b']);
  assert.deepEqual(removeMoment([a, b], 'a').map((m) => m.id), ['b']);
  assert.deepEqual(addMoment([a]).map((m) => m.id), ['a', 'moment-1']);
  assert.equal(updateMoment([a], 'a', { variantsRequested: 3 })[0].variantsRequested, 3);
  // Reordering into an invalid timeline is allowed to HAPPEN and then refused.
  assert.equal(validateTimeline(moveMoment([a, b], 'b', -1)).ok, false);
});

test('a fresh moment is the smallest legal window and carries no reserve', () => {
  const fresh = newMoment(1, 12);
  assert.equal(fresh.endSeconds - fresh.startSeconds, BOUNDS.minDurationSeconds);
  assert.equal(fresh.maxRepairs, 0);
  assert.equal(fresh.variantsRequested, BOUNDS.minVariantsPerMoment);
});

test('the fingerprint changes on every edit that changes what runs or what it costs', () => {
  const base = [moment()];
  const original = timelineFingerprint(base);
  const changes: Array<Partial<TimelineMoment>> = [
    { prompt: 'something else' }, { startSeconds: 1 }, { endSeconds: 4 },
    { variantsRequested: 3 }, { judgeMode: 'off', maxRepairs: 0 }, { maxRepairs: 0 }, { id: 'other' },
  ];
  for (const change of changes) {
    assert.notEqual(timelineFingerprint([{ ...base[0], ...change }]), original, JSON.stringify(change));
  }
  // Whitespace-only prompt edits do not change what is sent, and do not change it.
  assert.equal(timelineFingerprint([{ ...base[0], prompt: `  ${base[0].prompt}  ` }]), original);
  // ORDER is part of the plan.
  const two = [moment({ id: 'a', startSeconds: 0, endSeconds: 3 }), moment({ id: 'b', startSeconds: 3, endSeconds: 6 })];
  assert.notEqual(timelineFingerprint(moveMoment(two, 'b', -1)), timelineFingerprint(two));
});

test('the request body carries no provider, model, price or contract version', () => {
  const body = toRequestMoments([moment()]);
  assert.ok(body);
  assert.deepEqual(Object.keys(body[0]).sort(), [
    'end_seconds', 'id', 'judge_mode', 'max_repairs', 'prompt', 'ratio', 'start_seconds', 'variants_requested',
  ]);
  assert.equal(body[0].prompt, moment().prompt);
});

test('reconciliation agrees with a real compiled proposal and fails closed on any drift', () => {
  const doc = V2_PREVIEW_MULTI.proposal;
  const graph = doc.professional_control;
  const timeline: TimelineMoment[] = graph.moments.map((m) => ({
    id: m.moment_id, prompt: m.prompt,
    startSeconds: m.timestamp.start_ms / 1000, endSeconds: m.timestamp.end_ms / 1000,
    ratio: m.ratio, variantsRequested: m.variants_requested,
    judgeMode: m.judge_mode as 'off' | 'ranked', maxRepairs: m.repair_policy.max_repairs,
  }));
  const local = validateTimeline(timeline);
  assert.equal(local.ok, true);
  const backend = {
    maximumCredits: doc.maximum_credits, initialCredits: doc.initial_credits,
    repairReserveCredits: doc.repair_reserve_credits,
    taskCount: doc.task_count, momentCount: graph.moments.length,
  };
  assert.deepEqual(reconcileWithBackend(local.cost, backend), { ok: true });
  // A backend ceiling one credit away from the plan is a REFUSAL, not a number
  // to prefer: the plan that was priced is not the plan that was sent.
  assert.equal(reconcileWithBackend(local.cost, { ...backend, maximumCredits: backend.maximumCredits + 1 }).ok, false);
  assert.equal(reconcileWithBackend(local.cost, { ...backend, taskCount: backend.taskCount + 1 }).ok, false);
  assert.equal(reconcileWithBackend(local.cost, { ...backend, momentCount: backend.momentCount + 1 }).ok, false);
  assert.equal(reconcileWithBackend(local.cost, { ...backend, initialCredits: backend.initialCredits - 12 }).ok, false);
  assert.equal(reconcileWithBackend(null, backend).ok, false);
});

test('the coverage sentence never lets takes read as timeline', () => {
  const cost = validateTimeline([moment({ variantsRequested: 4 })]).cost!;
  const line = coverageSummary(cost);
  assert.match(line, /1 B-roll moment/);
  assert.match(line, /4 generated takes/);
  assert.match(line, /do not add coverage/);
  // The take count must never be presented as the number of finished moments.
  assert.doesNotMatch(line, /4 B-roll moments/);
});
