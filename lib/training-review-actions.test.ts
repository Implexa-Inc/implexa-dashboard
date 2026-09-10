// node --test lib/training-review-actions.test.ts
//
// The Training Review write-path allowlist — the security boundary of the training
// write path, and the file the backend contract is diffed against.
//
// The cross-authority refusals live in `review-subject.test.ts`; the byte-for-byte
// agreement with the backend's generated fixture lives in
// `training-review-contract.test.ts`. This file covers the bounds and the refusals, and
// the contract properties that are easy to lose in a refactor: no server-derived field
// is ever sent, evidence travels as a consented descriptor rather than bytes or a path,
// and the decision vocabulary has no expression that could ask for an activation.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COACH_BASE, COACH_TEXT_MAX, IDEMPOTENCY_KEY_MIN, MAX_PROPOSAL_ORDINAL,
  parseRegion, parseTemporalRange, resolveTrainingReviewAction,
} from './training-review-actions.ts';

const TRAINING = '11111111-1111-4111-8111-111111111111';
const SOURCE = '22222222-2222-4222-8222-222222222222';
const REVIEW = '33333333-3333-4333-8333-333333333333';
const ANNOTATION = '44444444-4444-4444-8444-444444444444';
const SUBMISSION = '55555555-5555-4555-8555-555555555555';
const PROPOSAL = '66666666-6666-4666-8666-666666666666';
const MACHINE = '88888888-8888-4888-8888-888888888888';
const CAPABILITY = '99999999-9999-4999-8999-999999999999';
const DIGEST = 'a'.repeat(64);
const CONSENT = 'b'.repeat(64);

const ok = (result: unknown) => {
  assert.notEqual(typeof result, 'string', `expected an upstream, got refusal: ${result}`);
  return result as { path: string; method: string; body?: Record<string, unknown>; headers?: Record<string, string> };
};

const demo = {
  trainingSessionId: TRAINING, sourceId: SOURCE,
  localCapabilityId: CAPABILITY, machineId: MACHINE,
  mediaSha256: DIGEST, sizeBytes: 41943040, durationMs: 600000, mediaType: 'video/mp4',
};

test('a demonstration is a descriptor: digest, size, duration and a custody binding', () => {
  const up = ok(resolveTrainingReviewAction('training_attach_demonstration', demo));
  assert.equal(up.path, `${COACH_BASE}/sessions/${TRAINING}/demonstrations`);
  assert.equal(up.method, 'POST');
  assert.equal(up.body!.captureMode, 'supplied');
  assert.equal(up.body!.divergenceRunId, null);
  // Custody binding is required; without it the server refuses `custody_binding_required`.
  assert.match(resolveTrainingReviewAction('training_attach_demonstration',
    { ...demo, machineId: undefined }) as string, /custody capability and the machine/);
  assert.match(resolveTrainingReviewAction('training_attach_demonstration',
    { ...demo, mediaSha256: 'short' }) as string, /SHA-256/);
  assert.match(resolveTrainingReviewAction('training_attach_demonstration',
    { ...demo, sizeBytes: 0 }) as string, /positive recording size/);
  assert.match(resolveTrainingReviewAction('training_attach_demonstration',
    { ...demo, durationMs: 0 }) as string, /positive recording duration/);
});

test('native capture is refused here rather than sent to be refused there', () => {
  assert.match(resolveTrainingReviewAction('training_attach_demonstration',
    { ...demo, captureMode: 'native_capture' }) as string, /Screen capture is not available/);
});

test('no server-derived field is ever forwarded — the body is refused, not sanitised', () => {
  // Silently dropping these would let a caller believe it had labelled the source, the
  // authority or the influence of a teaching. The server refuses; so does this.
  for (const field of ['sourceKind', 'evidenceAuthority', 'anchorDigest', 'influenceState',
    'canonicalLinkState', 'custodyState', 'status', 'proposalDigest']) {
    const refusal = resolveTrainingReviewAction('training_attach_demonstration', { ...demo, [field]: 'forged' });
    assert.equal(typeof refusal, 'string', `${field} should have been refused`);
    assert.match(refusal as string, /derived by the server/);
  }
  // An annotation's ordinal is server-assigned too, and only on that route.
  assert.match(resolveTrainingReviewAction('training_add_annotation', {
    reviewSessionId: REVIEW, temporalRange: { startMs: 0, endMs: 10 }, coachText: 'x', ordinal: 3,
  }) as string, /derived by the server/);
  // ...but a PROPOSAL's ordinal is the compiler's own and must still be accepted.
  assert.equal(typeof resolveTrainingReviewAction('training_record_proposal', {
    submissionId: SUBMISSION, ordinal: 0, kind: 'decision', sourceAnnotationIds: [ANNOTATION],
  }), 'object');
});

test('opening a review needs a stable idempotency key, on the header', () => {
  const up = ok(resolveTrainingReviewAction('training_create_review', {
    trainingSessionId: TRAINING, sourceId: SOURCE, idempotencyKey: 'coach-abc-123',
  }));
  assert.equal(up.path, `${COACH_BASE}/reviews`);
  assert.deepEqual(up.headers, { 'Idempotency-Key': 'coach-abc-123' });
  // The server's own body key, not the envelope's.
  assert.deepEqual(up.body, { sessionId: TRAINING, sourceId: SOURCE });
  assert.match(resolveTrainingReviewAction('training_create_review', {
    trainingSessionId: TRAINING, sourceId: SOURCE, idempotencyKey: 'x'.repeat(IDEMPOTENCY_KEY_MIN - 1),
  }) as string, /idempotency key/);
});

test('every action refuses a malformed identity rather than forwarding it', () => {
  assert.match(resolveTrainingReviewAction('training_create_review',
    { trainingSessionId: 'x', sourceId: SOURCE, idempotencyKey: 'coach-abc-123' }) as string, /trainingSessionId/);
  assert.match(resolveTrainingReviewAction('training_read_review', { reviewSessionId: '' }) as string, /reviewSessionId/);
  assert.match(resolveTrainingReviewAction('training_decide_proposal', { proposalId: 'x' }) as string, /proposalId/);
  assert.equal(resolveTrainingReviewAction('teach_everything', {}), 'Unknown training review action.');
});

const annotation = {
  reviewSessionId: REVIEW,
  temporalRange: { startMs: 10000, endMs: 25000 },
  coachText: 'Chamfer the edge before the pocket cut.',
};

test('a moment needs a bounded range and the Coach\'s own words', () => {
  const up = ok(resolveTrainingReviewAction('training_add_annotation', annotation));
  assert.equal(up.path, `${COACH_BASE}/reviews/${REVIEW}/annotations`);
  // The server's flat fields, not a nested range object.
  assert.equal(up.body!.startsAtMs, 10000);
  assert.equal(up.body!.endsAtMs, 25000);
  assert.equal(up.body!.supersedesAnnotationId, null);

  assert.match(resolveTrainingReviewAction('training_add_annotation',
    { ...annotation, coachText: '   ' }) as string, /Say what happened/);
  assert.match(resolveTrainingReviewAction('training_add_annotation',
    { ...annotation, coachText: 'x'.repeat(COACH_TEXT_MAX + 1) }) as string, /Say what happened/);
  assert.match(resolveTrainingReviewAction('training_add_annotation',
    { ...annotation, temporalRange: { startMs: 5000, endMs: 4000 } }) as string, /after its start/);
});

test('a correction is an APPEND naming what it supersedes — there is no edit and no delete', () => {
  const up = ok(resolveTrainingReviewAction('training_add_annotation', {
    ...annotation, supersedesAnnotationId: ANNOTATION,
  }));
  assert.equal(up.body!.supersedesAnnotationId, ANNOTATION);
  // The client never claims the successor id; the server mints and freezes it.
  assert.ok(!('annotationId' in up.body!));
  // No action exists that could remove a moment.
  assert.equal(resolveTrainingReviewAction('discard_training_annotation', { annotationId: ANNOTATION }),
    'Unknown training review action.');
});

test('a transcript span is both-ended or absent, never half-stated', () => {
  assert.match(resolveTrainingReviewAction('training_add_annotation',
    { ...annotation, transcriptStartMs: 1000 }) as string, /both a start and an end/);
  assert.match(resolveTrainingReviewAction('training_add_annotation',
    { ...annotation, transcriptStartMs: 4000, transcriptEndMs: 4000 }) as string, /after its start/);
  const up = ok(resolveTrainingReviewAction('training_add_annotation', {
    ...annotation, transcriptStartMs: 12000, transcriptEndMs: 16000, transcriptText: 'take the feed rate off the table',
  }));
  assert.equal(up.body!.transcriptStartMs, 12000);
});

test('a range end at or before its start is refused, never silently swapped', () => {
  assert.equal(parseTemporalRange({ startMs: 10, endMs: 10 }), null);
  assert.equal(parseTemporalRange({ startMs: 10, endMs: 9 }), null);
  assert.deepEqual(parseTemporalRange({ startMs: 10, endMs: 20 }), { startMs: 10, endMs: 20 });
  // The server stores integers and both ends. A point range and a fractional one are
  // shapes it cannot hold, so they are refused rather than rounded into something else.
  assert.equal(parseTemporalRange({ startMs: 10, endMs: null }), null);
  assert.equal(parseTemporalRange({ startMs: 10.4, endMs: 20.6 }), null);
  assert.equal(parseTemporalRange({ startMs: 10 }), null);
  assert.equal(parseTemporalRange({ startMs: -1, endMs: 5 }), null);
  assert.equal(parseTemporalRange(null), null);
});

test('a marked area is a bounded rectangle inside the frame, or nothing', () => {
  assert.deepEqual(parseRegion({ x: 0.12, y: 0.34, w: 0.4, h: 0.22 }), { x: 0.12, y: 0.34, w: 0.4, h: 0.22 });
  assert.equal(parseRegion({ x: 0.8, y: 0, w: 0.4, h: 0.2 }), null);
  assert.equal(parseRegion({ x: 0, y: 0, w: 0, h: 0.2 }), null);
  assert.equal(parseRegion({ x: 0, y: 0, w: 0.2 }), null);
  assert.equal(parseRegion(null), null);
  assert.match(resolveTrainingReviewAction('training_add_annotation',
    { ...annotation, region: { x: 2, y: 0, w: 0.1, h: 0.1 } }) as string, /bounded rectangle/);
});

const evidence = {
  annotationId: ANNOTATION, evidenceKind: 'clip',
  temporalRange: { startMs: 31000, endMs: 40000 }, consentReceiptDigest: CONSENT,
};

test('evidence travels as a consented descriptor — no bytes, no path', () => {
  const up = ok(resolveTrainingReviewAction('training_attach_evidence', {
    ...evidence, mediaSha256: DIGEST,
    localPath: undefined, // not a derived field; simply never read
  }));
  assert.equal(up.path, `${COACH_BASE}/annotations/${ANNOTATION}/evidence`);
  assert.equal(up.body!.consentReceiptDigest, CONSENT);
  const wire = JSON.stringify(up.body);
  assert.ok(!wire.includes('/Users/'), 'a local path must never reach the wire');
  assert.match(resolveTrainingReviewAction('training_attach_evidence',
    { ...evidence, evidenceKind: 'screenshot' }) as string, /clip, a frame, or a transcript span/);
  // `transcript`, without `_span`, is the OLD spelling. It must not be accepted.
  assert.match(resolveTrainingReviewAction('training_attach_evidence',
    { ...evidence, evidenceKind: 'transcript' }) as string, /clip, a frame, or a transcript span/);
});

test('consent is required and is a receipt over the excerpt, not a boolean', () => {
  assert.match(resolveTrainingReviewAction('training_attach_evidence',
    { ...evidence, consentReceiptDigest: undefined }) as string, /recorded consent/);
  assert.match(resolveTrainingReviewAction('training_attach_evidence',
    { ...evidence, consentReceiptDigest: true }) as string, /recorded consent/);
});

test('a frame names an instant; only a transcript span carries words', () => {
  assert.match(resolveTrainingReviewAction('training_attach_evidence',
    { ...evidence, evidenceKind: 'frame' }) as string, /name the instant/);
  assert.match(resolveTrainingReviewAction('training_attach_evidence',
    { ...evidence, frameAtMs: 32000 }) as string, /Only a frame/);
  assert.match(resolveTrainingReviewAction('training_attach_evidence',
    { ...evidence, evidenceKind: 'transcript_span' }) as string, /must carry the words/);
  assert.match(resolveTrainingReviewAction('training_attach_evidence',
    { ...evidence, transcriptText: 'words' }) as string, /Only a transcript span/);
});

test('freezing a submission sends NO body — the server freezes what it holds', () => {
  const up = ok(resolveTrainingReviewAction('training_freeze_submission', { reviewSessionId: REVIEW }));
  assert.equal(up.path, `${COACH_BASE}/reviews/${REVIEW}/submission`);
  assert.equal(up.method, 'POST');
  // A client-supplied id list would be a second opinion about what is in the submission.
  assert.equal(up.body, undefined);
});

test('a decision card is bounded, kinded, and cites its moments', () => {
  const base = { submissionId: SUBMISSION, kind: 'decision', ordinal: 0, sourceAnnotationIds: [ANNOTATION] };
  const up = ok(resolveTrainingReviewAction('training_record_proposal', {
    ...base, triggerText: 't', selectedTreatment: 's', rationale: 'r', proposedScope: 'both', confidence: 'high',
  }));
  assert.equal(up.path, `${COACH_BASE}/submissions/${SUBMISSION}/proposals`);
  assert.match(resolveTrainingReviewAction('training_record_proposal',
    { ...base, ordinal: MAX_PROPOSAL_ORDINAL + 1 }) as string, /at most/);
  assert.match(resolveTrainingReviewAction('training_record_proposal',
    { ...base, kind: 'guess' }) as string, /decision or an explicit insufficient_evidence/);
  assert.match(resolveTrainingReviewAction('training_record_proposal',
    { ...base, sourceAnnotationIds: [] }) as string, /cite the moments/);
  assert.match(resolveTrainingReviewAction('training_record_proposal',
    { ...base, proposedScope: 'everywhere' }) as string, /name where it would apply/);
  // Confidence is the server's three levels, not a number.
  assert.match(resolveTrainingReviewAction('training_record_proposal',
    { ...base, confidence: 0.9 }) as string, /low, medium, or high/);
});

test('insufficient_evidence is a first-class kind and must say what it could not justify', () => {
  assert.match(resolveTrainingReviewAction('training_record_proposal', {
    submissionId: SUBMISSION, kind: 'insufficient_evidence', ordinal: 1,
  }) as string, /could not justify/);
  const up = ok(resolveTrainingReviewAction('training_record_proposal', {
    submissionId: SUBMISSION, kind: 'insufficient_evidence', ordinal: 1,
    insufficientEvidenceReason: 'the recording never shows the feed rate being chosen',
  }));
  // It needs no cited moment: that is exactly what it is reporting.
  assert.deepEqual(up.body!.sourceAnnotationIds, []);
});

test('a decision is confirmed or discarded — there is no expression that asks for activation', () => {
  for (const decision of ['confirmed', 'discarded']) {
    const up = ok(resolveTrainingReviewAction('training_decide_proposal', {
      proposalId: PROPOSAL, decision, expectedProposalDigest: DIGEST,
      // The exact forgery: a caller asking for activation.
      activate: true, activation: 'now', promote: true,
    }));
    assert.deepEqual(up.body, { decision, expectedProposalDigest: DIGEST });
    assert.ok(!('activate' in up.body!), `${decision} must never carry an activation field`);
    assert.ok(!('promote' in up.body!));
    assert.ok(!('activation' in up.body!));
  }
  assert.match(resolveTrainingReviewAction('training_decide_proposal', {
    proposalId: PROPOSAL, decision: 'activated', expectedProposalDigest: DIGEST,
  }) as string, /confirmed or discarded/);
  assert.match(resolveTrainingReviewAction('training_decide_proposal', {
    proposalId: PROPOSAL, decision: 'accepted', expectedProposalDigest: DIGEST,
  }) as string, /confirmed or discarded/);
});

test('a decision without the digest of the card shown is refused before it can land on another', () => {
  assert.match(resolveTrainingReviewAction('training_decide_proposal', {
    proposalId: PROPOSAL, decision: 'confirmed',
  }) as string, /its digest is required/);
  assert.match(resolveTrainingReviewAction('training_decide_proposal', {
    proposalId: PROPOSAL, decision: 'confirmed', expectedProposalDigest: 'nope',
  }) as string, /its digest is required/);
});

test('the review read is a GET naming the review session', () => {
  const up = ok(resolveTrainingReviewAction('training_read_review', { reviewSessionId: REVIEW }));
  assert.equal(up.method, 'GET');
  assert.equal(up.path, `${COACH_BASE}/reviews/${REVIEW}`);
  assert.equal(up.body, undefined);
});
