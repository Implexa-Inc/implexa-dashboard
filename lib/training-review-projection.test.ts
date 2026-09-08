// node --test lib/training-review-projection.test.ts
//
// The read-only training record (F0 item 8), parsed from the BACKEND's own generated
// projections — every state below is a `reviews.*` entry the backend producer emitted,
// not a shape invented here.
//
// Three properties matter more than the field mapping:
//   UNAVAILABLE IS NOT EMPTY  — a failed read is `live:false` with a reason, never a
//                               record that renders as "nothing here yet";
//   THE SERVER'S FACTS ARE READ, NOT RECOMPUTED — liveness, terminality, permitted
//                               actions and the learning count come from the payload;
//   NO PATH REACHES THE BROWSER (§4.2, §6.1) — a backend that ever leaked one has it
//                               dropped here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  formatBytes, formatDuration, keptEvidence, looksLikePath, parseTrainingReview,
} from './training-review-projection.ts';
import {
  TRAINING_PROJECTION_VERSION, TRAINING_REVIEW_CONTRACT_VERSION,
} from './training-review-actions.ts';
import { activationStance, factSentence, FACT_UNKNOWN_SENTENCE } from './training-review-lifecycle.ts';

const fixture = JSON.parse(readFileSync(
  fileURLToPath(new URL('../test-fixtures/training-review-f0.v1.json', import.meta.url)), 'utf8',
));
const REVIEWS = fixture.backend.reviews;

const EXPECTED = {
  projectionVersion: TRAINING_PROJECTION_VERSION,
  contractVersion: TRAINING_REVIEW_CONTRACT_VERSION,
};

const parse = (raw: unknown) => parseTrainingReview(raw, EXPECTED);
const live = (review: unknown) => {
  const status = parse({ ok: true, review });
  assert.equal(status.live, true, `expected a live review: ${JSON.stringify(status)}`);
  return (status as { live: true; review: any }).review;
};

test('the backend\'s decided projection parses into source, moments, evidence, cards and state', () => {
  const review = live(REVIEWS.decided);
  assert.equal(review.source.kind, 'owner_demonstration');
  assert.equal(review.source.integrity, 'verified');
  assert.equal(review.annotations.length, REVIEWS.decided.annotations.length);
  assert.equal(keptEvidence(review).length, 2);
  assert.equal(review.decisions.length, 2);
  assert.equal(review.submission.annotationCount, 2);
  assert.equal(review.contractSkew, null);
  assert.equal(review.status, 'submitted');
  assert.equal(review.terminal, true);
  assert.deepEqual([...review.permittedActions], ['confirm_decisions']);
  assert.equal(review.authorityState.demonstrated.status, 'yes');
  assert.equal(review.authorityState.activated.status, 'no');
  assert.equal(activationStance(review.authorityState), 'inert_candidate');
});

test('every published review state parses, and none of them claims an activation', () => {
  for (const [name, raw] of Object.entries(REVIEWS)) {
    const review = live(raw);
    assert.equal(review.authorityState.activated.status, 'no', `${name} must report no activation`);
    assert.equal(activationStance(review.authorityState), 'inert_candidate', name);
    assert.equal(review.learning.activatedCount, 0, name);
    assert.equal(review.learning.versionsCreated, 0, name);
    for (const card of review.decisions) assert.equal(card.influenceState, 'inert', name);
  }
});

test('a superseded moment is still returned, and liveness comes from the server', () => {
  const review = live(REVIEWS.superseded);
  const superseded = review.annotations.find((a: any) => a.status === 'superseded');
  assert.ok(superseded, 'the replaced moment must still be readable');
  assert.equal(superseded.live, false);
  assert.equal(review.liveAnnotationCount, 2);
  const successor = review.annotations.find((a: any) => a.supersedesAnnotationId === superseded.annotationId);
  assert.ok(successor, 'the correction must name what it replaced');
  assert.equal(successor.live, true);
});

test('a stale recording is reported with the server\'s own words, and offers almost nothing', () => {
  const review = live(REVIEWS.staleRecording);
  assert.equal(review.source.integrity, 'stale');
  assert.match(review.source.integrityNote, /changed after the review began/);
  // The server permits only abandoning; the client renders that rather than deciding it.
  assert.deepEqual([...review.permittedActions], ['abandon_review']);
});

test('an unreadable, refused, or unreachable read is live:false with a reason', () => {
  const refused = parse({ ok: false, reason: 'review_not_found', error: 'not found' });
  assert.deepEqual(refused, { live: false, reason: 'review_not_found', unavailable: false });
  // The backend flags a projection it refused to BUILD; that is not the same state.
  assert.deepEqual(
    parse({ ok: false, unavailable: true, reason: 'training_review_source_missing', error: 'x' }),
    { live: false, reason: 'training_review_source_missing', unavailable: true },
  );
  assert.deepEqual(parse(null), { live: false, reason: 'unreadable', unavailable: true });
  assert.deepEqual(parse({ ok: true }), { live: false, reason: 'unreadable', unavailable: true });
  assert.deepEqual(parse({ ok: true, review: [] }), { live: false, reason: 'unreadable', unavailable: true });
  assert.deepEqual(
    parse({ ok: true, review: { ...REVIEWS.decided, status: 'invented' } }),
    { live: false, reason: 'unreadable', unavailable: true },
  );
});

test('a review with NO learning block is UNKNOWN about activation, not "no"', () => {
  const { learning, ...withoutLearning } = REVIEWS.decided;
  const review = live(withoutLearning);
  assert.equal(review.learning, null);
  assert.equal(review.authorityState.activated.status, 'unknown');
  // The consequence: the surface must not claim "not activated" for a record whose
  // activation it never read.
  assert.equal(activationStance(review.authorityState), 'unknown');
  assert.equal(factSentence(review.authorityState.activated), FACT_UNKNOWN_SENTENCE);
});

test('the four facts F0 does not carry are UNKNOWN and say why, in their own words', () => {
  const review = live(REVIEWS.decided);
  for (const key of ['requested', 'implemented', 'verified', 'accepted'] as const) {
    const fact = review.authorityState[key];
    assert.equal(fact.status, 'unknown', key);
    // Neither the failed-read sentence nor the confident "no": a third, honest one.
    assert.notEqual(factSentence(fact), FACT_UNKNOWN_SENTENCE, key);
    assert.ok(fact.detail && fact.detail.length > 10, key);
  }
  // And confirming cards must NOT have moved `accepted`: accepting a revised result is
  // a different fact from confirming a teaching (§1.3).
  assert.equal(review.decisions.some((c: any) => c.status === 'confirmed'), true);
  assert.notEqual(review.authorityState.accepted.status, 'yes');
});

test('a card claiming it is NOT inert is dropped rather than rendered as active', () => {
  const forged = {
    ...REVIEWS.decided,
    proposals: [{ ...REVIEWS.decided.proposals[0], influenceState: 'active' }],
  };
  const review = live(forged);
  assert.equal(review.decisions.length, 0, 'this contract cannot produce an active teaching');
});

test('a malformed source, moment or excerpt is dropped rather than half-rendered', () => {
  const review = live({
    ...REVIEWS.marked,
    source: { ...REVIEWS.marked.source, recordingDigest: 'nope' },
    annotations: [
      // No Coach words: the transcript beside it would read as the teaching.
      { ...REVIEWS.marked.annotations[0], coachText: '   ' },
      // An excerpt with no consent receipt has no standing to be shown as kept.
      {
        ...REVIEWS.marked.annotations[1],
        evidence: [{ ...REVIEWS.marked.annotations[1].evidence[0], consentReceiptDigest: null }],
      },
    ],
  });
  assert.equal(review.source, null);
  assert.equal(review.annotations.length, 1);
  assert.equal(keptEvidence(review).length, 0);
});

test('a revoked excerpt is not counted among the moments kept', () => {
  const review = live({
    ...REVIEWS.marked,
    annotations: REVIEWS.marked.annotations.map((a: any) => ({
      ...a,
      evidence: (a.evidence ?? []).map((e: any) => ({ ...e, revocationState: 'revoked' })),
    })),
  });
  assert.equal(keptEvidence(review).length, 0);
});

test('custody defaults to the stronger local claim, not to "already uploaded"', () => {
  const review = live({
    ...REVIEWS.marked,
    annotations: REVIEWS.marked.annotations.map((a: any) => ({
      ...a,
      evidence: (a.evidence ?? []).map((e: any) => ({ ...e, custodyState: undefined })),
    })),
  });
  for (const entry of keptEvidence(review)) assert.equal(entry.custodyState, 'local_only');
});

test('a subject naming a different session than its review is refused, not resolved', () => {
  const review = live({
    ...REVIEWS.decided,
    subject: { ...REVIEWS.decided.subject, trainingSessionId: '00000099-0000-4000-8000-000000000099' },
  });
  assert.equal(review.subject, null);
});

test('a leaked local path is DROPPED, never rendered', () => {
  const review = live({
    ...REVIEWS.decided,
    source: { ...REVIEWS.decided.source, custodyNote: '/Users/coach/Movies/demo.mov' },
    statusReason: 'file:///tmp/leak',
  });
  assert.equal(review.source.custodyNote, null);
  assert.equal(review.statusReason, null);
  assert.equal(JSON.stringify(review).includes('/Users/'), false);
  for (const value of ['/Users/coach/x.mov', '~/Movies/x.mov', 'C:\\Users\\x.mov', 'file:///tmp/x']) {
    assert.equal(looksLikePath(value), true, value);
  }
  assert.equal(looksLikePath('Coach MacBook Pro'), false);
  assert.equal(looksLikePath('Mac mini (office/lab)'), false);
});

test('a contract skew is reported rather than blanking the record', () => {
  const review = live({ ...REVIEWS.decided, projectionVersion: 'agent-training-review.v2' });
  assert.equal(review.contractSkew, 'agent-training-review.v2');
  assert.equal(review.decisions.length, 2);
  const both = live({
    ...REVIEWS.decided,
    projectionVersion: 'agent-training-review.v2',
    contractVersion: 'agent-training-review-session.v2',
  });
  assert.equal(both.contractSkew, 'agent-training-review.v2, agent-training-review-session.v2');
});

test('an unknown permitted action is dropped rather than rendered as a control', () => {
  const review = live({ ...REVIEWS.marked, permittedActions: ['add_moment', 'activate_learning', 'add_moment'] });
  assert.deepEqual([...review.permittedActions], ['add_moment']);
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
