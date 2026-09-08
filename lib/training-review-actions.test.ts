// node --test lib/training-review-actions.test.ts
//
// The Training Review write-path allowlist — the security boundary of the training
// write path, and the file the backend contract will be diffed against.
//
// The cross-authority refusals live in `review-subject.test.ts`. This file covers the
// bounds, the refusals, and the two contract properties that are easy to lose in a
// refactor: `activate` is pinned false on the wire, and evidence travels as a
// descriptor with local custody — never as bytes and never as a path.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ANNOTATION_BATCH_MAX, COACH_TEXT_MAX, TRAINING_BASE, TRAINING_CONTRACT_VERSION,
  parseTemporalRange, resolveTrainingReviewAction,
} from './training-review-actions.ts';

const TRAINING = '11111111-1111-4111-8111-111111111111';
const SOURCE = '22222222-2222-4222-8222-222222222222';
const REVIEW = '33333333-3333-4333-8333-333333333333';
const ANNOTATION = '44444444-4444-4444-8444-444444444444';
const SUBMISSION = '55555555-5555-4555-8555-555555555555';
const DECISION = '66666666-6666-4666-8666-666666666666';
const OTHER_DECISION = '77777777-7777-4777-8777-777777777777';
const DIGEST = 'a'.repeat(64);

const ok = (result: unknown) => {
  assert.notEqual(typeof result, 'string', `expected an upstream, got refusal: ${result}`);
  return result as { path: string; method: string; body?: Record<string, unknown> };
};

test('ensure_training_session names the training session, never a run', () => {
  const up = ok(resolveTrainingReviewAction('ensure_training_session', { trainingSessionId: TRAINING, sourceId: SOURCE }));
  assert.equal(up.path, `${TRAINING_BASE}/sessions/${TRAINING}/review-sessions`);
  assert.equal(up.method, 'POST');
  assert.equal(up.body!.sourceId, SOURCE);
  assert.equal(up.body!.contractVersion, TRAINING_CONTRACT_VERSION);
});

test('every action refuses a malformed identity rather than forwarding it', () => {
  assert.match(resolveTrainingReviewAction('ensure_training_session', { trainingSessionId: 'x', sourceId: SOURCE }) as string, /trainingSessionId/);
  assert.match(resolveTrainingReviewAction('ensure_training_session', { trainingSessionId: TRAINING }) as string, /sourceId/);
  assert.match(resolveTrainingReviewAction('discard_training_annotation', { annotationId: '' }) as string, /annotationId/);
  assert.equal(resolveTrainingReviewAction('teach_everything', {}), 'Unknown training review action.');
});

test('an annotation needs a bounded moment, the Coach words, and the recording digest', () => {
  const base = { reviewSessionId: REVIEW, sourceId: SOURCE, temporalRange: { startMs: 1000, endMs: 4000 }, coachText: 'because the corner is unreachable', anchorDigest: DIGEST };
  const up = ok(resolveTrainingReviewAction('create_training_annotation', base));
  assert.equal(up.path, `${TRAINING_BASE}/review-sessions/${REVIEW}/annotations`);
  assert.deepEqual(up.body!.temporalRange, { startMs: 1000, endMs: 4000 });

  assert.match(resolveTrainingReviewAction('create_training_annotation', { ...base, coachText: '   ' }) as string, /Say what happened/);
  assert.match(resolveTrainingReviewAction('create_training_annotation', { ...base, coachText: 'x'.repeat(COACH_TEXT_MAX + 1) }) as string, /Say what happened/);
  assert.match(resolveTrainingReviewAction('create_training_annotation', { ...base, anchorDigest: 'short' }) as string, /recording digest/);
  assert.match(resolveTrainingReviewAction('create_training_annotation', { ...base, temporalRange: { startMs: 5000, endMs: 4000 } }) as string, /after its start/);
});

test('a range end at or before its start is refused, never silently swapped', () => {
  assert.equal(parseTemporalRange({ startMs: 10, endMs: 10 }), null);
  assert.equal(parseTemporalRange({ startMs: 10, endMs: 9 }), null);
  assert.deepEqual(parseTemporalRange({ startMs: 10, endMs: null }), { startMs: 10, endMs: null });
  assert.deepEqual(parseTemporalRange({ startMs: 10.4, endMs: 20.6 }), { startMs: 10, endMs: 21 });
  // A point is `endMs: null`, not a missing key: the shape must be complete.
  assert.equal(parseTemporalRange({ startMs: 10 }), null);
  assert.equal(parseTemporalRange({ startMs: -1, endMs: null }), null);
  assert.equal(parseTemporalRange(null), null);
});

test('evidence travels as a descriptor with local custody — no bytes, no path', () => {
  const up = ok(resolveTrainingReviewAction('attach_training_evidence', {
    annotationId: ANNOTATION, kind: 'clip', mediaSha256: DIGEST, temporalRange: { startMs: 0, endMs: 2000 },
    localPath: '/Users/coach/Movies/demo.mov', bytes: 'AAAA',
  }));
  assert.equal(up.body!.custody, 'local_only');
  const wire = JSON.stringify(up.body);
  assert.ok(!wire.includes('/Users/'), 'a local path must never reach the wire');
  assert.ok(!wire.includes('AAAA'), 'recording bytes must never reach the wire');
  assert.match(resolveTrainingReviewAction('attach_training_evidence', {
    annotationId: ANNOTATION, kind: 'screenshot', mediaSha256: DIGEST, temporalRange: { startMs: 0, endMs: 1 },
  }) as string, /clip, a frame, or a transcript/);
});

test('a submission freezes a bounded, distinct annotation set against a digest', () => {
  const up = ok(resolveTrainingReviewAction('submit_training_annotations', {
    reviewSessionId: REVIEW, annotationIds: [ANNOTATION], recordingDigest: DIGEST,
  }));
  assert.equal(up.path, `${TRAINING_BASE}/review-sessions/${REVIEW}/submissions`);
  assert.match(resolveTrainingReviewAction('submit_training_annotations', {
    reviewSessionId: REVIEW, annotationIds: [], recordingDigest: DIGEST,
  }) as string, new RegExp(String(ANNOTATION_BATCH_MAX)));
  // A duplicate id is a replay, not a bigger submission.
  assert.equal(typeof resolveTrainingReviewAction('submit_training_annotations', {
    reviewSessionId: REVIEW, annotationIds: [ANNOTATION, ANNOTATION], recordingDigest: DIGEST,
  }), 'string');
  assert.match(resolveTrainingReviewAction('submit_training_annotations', {
    reviewSessionId: REVIEW, annotationIds: [ANNOTATION], recordingDigest: 'nope',
  }) as string, /recording digest/);
});

test('confirming a decision pins activate:false and cannot be talked out of it', () => {
  for (const disposition of ['accepted', 'edited', 'discarded']) {
    const up = ok(resolveTrainingReviewAction('confirm_training_decision', {
      submissionId: SUBMISSION, decisionId: DECISION, disposition,
      // The exact forgery: a caller asking for activation.
      activate: true, activation: 'now', promote: true,
    }));
    assert.equal(up.body!.activate, false, `${disposition} must never request activation`);
    assert.ok(!('promote' in up.body!));
    assert.ok(!('activation' in up.body!));
  }
});

test('a merge must name what it merges into', () => {
  assert.match(resolveTrainingReviewAction('confirm_training_decision', {
    submissionId: SUBMISSION, decisionId: DECISION, disposition: 'merged',
  }) as string, /name the decision it merges into/);
  const up = ok(resolveTrainingReviewAction('confirm_training_decision', {
    submissionId: SUBMISSION, decisionId: DECISION, disposition: 'merged', mergedIntoDecisionId: OTHER_DECISION,
  }));
  assert.equal(up.body!.mergedIntoDecisionId, OTHER_DECISION);
  assert.match(resolveTrainingReviewAction('confirm_training_decision', {
    submissionId: SUBMISSION, decisionId: DECISION, disposition: 'activated',
  }) as string, /accepted, edited, merged, or discarded/);
});

test('the projection read is a GET that names both identities', () => {
  const up = ok(resolveTrainingReviewAction('read_training_projection', { trainingSessionId: TRAINING, sourceId: SOURCE }));
  assert.equal(up.method, 'GET');
  assert.equal(up.path, `${TRAINING_BASE}/sessions/${TRAINING}/projection?sourceId=${SOURCE}`);
  assert.equal(up.body, undefined);
});

test('an amend asks for a successor rather than rewriting the row', () => {
  const up = ok(resolveTrainingReviewAction('amend_training_annotation', {
    annotationId: ANNOTATION, coachText: 'clearer wording',
  }));
  assert.equal(up.path, `${TRAINING_BASE}/review-annotations/${ANNOTATION}/amend`);
  // The client never claims the successor id; the server mints and freezes it.
  assert.ok(!('annotationId' in up.body!));
  assert.ok(!('id' in up.body!));
});
