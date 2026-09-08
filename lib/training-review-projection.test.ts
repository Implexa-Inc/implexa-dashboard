// node --test lib/training-review-projection.test.ts
//
// The read-only training record (F0 item 8), parsed from the assumed backend fixture.
//
// Two properties matter more than the field mapping:
//   UNAVAILABLE IS NOT EMPTY  — a failed read is `live:false` with a reason, never a
//                               projection that renders as "nothing here yet"; and
//   NO PATH REACHES THE BROWSER (§4.2, §6.1) — a backend that leaks one where a
//                               machine label belongs has it dropped here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  formatBytes, formatDuration, looksLikePath, parseTrainingProjection,
} from './training-review-projection.ts';
import { TRAINING_CONTRACT_VERSION } from './training-review-actions.ts';
import { activationStance } from './training-review-lifecycle.ts';

const fixture = JSON.parse(readFileSync(
  fileURLToPath(new URL('../test-fixtures/training-review-f0.v1.json', import.meta.url)), 'utf8',
));

const parse = (raw: unknown) => parseTrainingProjection(raw, TRAINING_CONTRACT_VERSION);
const live = (raw: unknown) => {
  const status = parse(raw);
  assert.equal(status.live, true, `expected a live projection: ${JSON.stringify(status)}`);
  return (status as { live: true; projection: ReturnType<typeof parse> extends never ? never : any }).projection;
};

test('the assumed fixture parses into source, evidence, decisions, state and submission', () => {
  const projection = live(fixture.projection);
  assert.equal(projection.source.sourceKind, 'owner_demonstration');
  assert.equal(projection.source.custody, 'local_only');
  assert.equal(projection.source.machineLabel, 'Coach MacBook Pro');
  assert.equal(projection.evidence.length, 2);
  assert.equal(projection.decisions.length, 2);
  assert.equal(projection.submission.annotationCount, 2);
  assert.equal(projection.contractSkew, null);
  assert.equal(projection.authorityState.demonstrated.status, 'yes');
  assert.equal(projection.authorityState.activated.status, 'no');
  assert.equal(activationStance(projection.authorityState), 'inert_candidate');
});

test('an unreadable, refused, or unreachable read is live:false with a reason', () => {
  assert.deepEqual(parse(fixture.projectionRefused), { live: false, reason: 'That training session is not yours.' });
  assert.deepEqual(parse({ ok: false }), { live: false, reason: 'refused' });
  assert.deepEqual(parse(null), { live: false, reason: 'unreadable' });
  assert.deepEqual(parse({ ok: true }), { live: false, reason: 'unreadable' });
  assert.deepEqual(parse({ ok: true, projection: [] }), { live: false, reason: 'unreadable' });
});

test('a projection with no authorityState is ALL UNKNOWN, not all no', () => {
  const projection = live(fixture.projectionAllUnknown);
  for (const fact of Object.values(projection.authorityState) as { status: string }[]) {
    assert.equal(fact.status, 'unknown');
  }
  // The important consequence: the surface must not claim "not activated" for a
  // record whose activation it never read.
  assert.equal(activationStance(projection.authorityState), 'unknown');
});

test('an activated record is distinguishable from an inert one', () => {
  const activated = live(fixture.projectionActivated);
  assert.equal(activationStance(activated.authorityState), 'active_learning');
  const inert = live(fixture.projection);
  assert.notEqual(
    activationStance(activated.authorityState),
    activationStance(inert.authorityState),
  );
});

test('a partially unreadable state keeps each fact three-valued', () => {
  const projection = live(fixture.projectionUnreadableState);
  assert.equal(projection.authorityState.demonstrated.status, 'yes');
  assert.equal(projection.authorityState.implemented.status, 'unknown');
  assert.equal(projection.authorityState.accepted.status, 'no');
  assert.equal(projection.authorityState.activated.status, 'unknown');
});

test('a leaked local path is DROPPED, never rendered', () => {
  const projection = live(fixture.projectionPathLeak);
  assert.equal(projection.source.machineLabel, null);
  assert.equal(JSON.stringify(projection).includes('/Users/'), false);
  for (const value of ['/Users/coach/x.mov', '~/Movies/x.mov', 'C:\\Users\\x.mov', 'file:///tmp/x']) {
    assert.equal(looksLikePath(value), true, value);
  }
  assert.equal(looksLikePath('Coach MacBook Pro'), false);
  assert.equal(looksLikePath('Mac mini (office/lab)'), false);
});

test('a malformed source or evidence row is dropped rather than half-rendered', () => {
  const projection = live({
    ok: true,
    contractVersion: TRAINING_CONTRACT_VERSION,
    projection: {
      source: { id: 'nope', sourceKind: 'owner_demonstration', mediaSha256: 'a'.repeat(64) },
      evidence: [
        { id: '99999999-9999-4999-8999-999999999999', annotationId: 'bad', kind: 'clip', mediaSha256: 'a'.repeat(64) },
        { id: '99999999-9999-4999-8999-999999999999', annotationId: '44444444-4444-4444-8444-444444444444', kind: 'poster', mediaSha256: 'a'.repeat(64) },
      ],
      decisions: [],
    },
  });
  assert.equal(projection.source, null);
  assert.equal(projection.evidence.length, 0);
});

test('custody defaults to the stronger local claim, not to "already uploaded"', () => {
  const projection = live({
    ok: true, contractVersion: TRAINING_CONTRACT_VERSION,
    projection: {
      source: { id: '22222222-2222-4222-8222-222222222222', sourceKind: 'owner_demonstration', mediaSha256: 'a'.repeat(64) },
      evidence: [{ id: '99999999-9999-4999-8999-999999999999', annotationId: '44444444-4444-4444-8444-444444444444', kind: 'clip', mediaSha256: 'a'.repeat(64) }],
      decisions: [],
    },
  });
  assert.equal(projection.source.custody, 'local_only');
  assert.equal(projection.evidence[0].custody, 'local_only');
});

test('a contract skew is reported rather than blanking the record', () => {
  const projection = live({ ...fixture.projection, contractVersion: 'agent-training-review.v2' });
  assert.equal(projection.contractSkew, 'agent-training-review.v2');
  assert.equal(projection.decisions.length, 2);
});

test('sizes and durations format for a person', () => {
  assert.equal(formatBytes(null), null);
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(48234112), '46 MB');
  assert.equal(formatBytes(3 * 1024 * 1024 + 512 * 1024), '3.5 MB');
  assert.equal(formatDuration(null), null);
  assert.equal(formatDuration(254000), '4:14');
  assert.equal(formatDuration(5000), '0:05');
});
