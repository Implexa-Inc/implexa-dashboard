// node --test lib/training-review-client.test.ts
//
// The ONE module that talks to the Agent Coach API. These tests run entirely against
// the vendored backend fixture with an injected transport — no network, no server.
//
// EVERY IDENTITY AND EVERY PROJECTION BELOW COMES FROM THE BACKEND'S OWN GENERATED
// FIXTURE, not from values invented here. The write RESPONSES are built from those same
// identities, because the backend fixture publishes projections rather than write
// envelopes — so the ids, digests and states a caller parses are still the producer's.
//
// The property this file guards: every request this client can emit is a TRAINING
// request, addressed to the training route, carrying the training identity, and there
// is no expression in it that could ask for an activation.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  TRAINING_REVIEW_ROUTE,
  addTrainingAnnotation, attachTrainingDemonstration, attachTrainingEvidence,
  createTrainingReview, decideTrainingProposal, freezeTrainingSubmission,
  readTrainingReview, recordTrainingProposal, stableIdempotencyKey,
  type TrainingTransport,
} from './training-review-client.ts';
import { writePathFor, type TrainingSourceSubject } from './review-subject.ts';

const fixture = JSON.parse(readFileSync(
  fileURLToPath(new URL('../test-fixtures/training-review-f0.v1.json', import.meta.url)), 'utf8',
));

const SUBJECT = fixture.backend.subjects.trainingSource as TrainingSourceSubject;
const PATH = writePathFor(SUBJECT);
const DECIDED = fixture.backend.reviews.decided;
const REVIEW_SESSION = DECIDED.reviewSessionId as string;
const ANNOTATION = DECIDED.annotations[0].annotationId as string;
const SUCCESSOR = DECIDED.annotations[2].annotationId as string;
const SUBMISSION = DECIDED.submission.submissionId as string;
const PROPOSAL = DECIDED.proposals[0];
const CONSENT = DECIDED.annotations[1].evidence[0].consentReceiptDigest as string;
const DIGEST = DECIDED.source.recordingDigest as string;

type Sent = { route: string; body: Record<string, unknown> };

function recorder(reply: (sent: Sent) => { status: number; body: Record<string, unknown> }) {
  const sent: Sent[] = [];
  const transport: TrainingTransport = async (route, body) => {
    sent.push({ route, body });
    return reply({ route, body });
  };
  return { sent, transport };
}

const okWith = (body: Record<string, unknown>) => () => ({ status: 200, body });

const demonstration = {
  localCapabilityId: DECIDED.source.localCapabilityId as string,
  machineId: DECIDED.source.machineId as string,
  mediaSha256: DIGEST,
  sizeBytes: DECIDED.source.sizeBytes as number,
  durationMs: DECIDED.source.recordingDurationMs as number,
  mediaType: DECIDED.source.mediaType as string,
};

test('every write goes to the training route with the training identity attached', async () => {
  const { sent, transport } = recorder(okWith({
    ok: true, sourceId: SUBJECT.sourceId, reviewSessionId: REVIEW_SESSION,
    annotationId: ANNOTATION, submissionId: SUBMISSION, proposalId: PROPOSAL.proposalId,
    evidenceId: DECIDED.annotations[1].evidence[0].evidenceId,
    canonicalLinkState: 'mint_deferred', influenceState: 'inert',
  }));
  await attachTrainingDemonstration(PATH, demonstration, transport);
  await createTrainingReview(PATH, { idempotencyKey: stableIdempotencyKey(SUBJECT) }, transport);
  await addTrainingAnnotation(PATH, {
    reviewSessionId: REVIEW_SESSION, temporalRange: { startMs: 10000, endMs: 25000 }, coachText: 'why',
  }, transport);
  await attachTrainingEvidence(PATH, {
    annotationId: ANNOTATION, evidenceKind: 'clip',
    temporalRange: { startMs: 31000, endMs: 40000 }, consentReceiptDigest: CONSENT,
  }, transport);
  await freezeTrainingSubmission(PATH, { reviewSessionId: REVIEW_SESSION }, transport);
  await recordTrainingProposal(PATH, {
    submissionId: SUBMISSION, ordinal: 0, kind: 'decision', sourceAnnotationIds: [ANNOTATION],
  }, transport);
  await decideTrainingProposal(PATH, {
    proposalId: PROPOSAL.proposalId, decision: 'confirmed', expectedProposalDigest: PROPOSAL.proposalDigest,
  }, transport);
  await readTrainingReview(PATH, { reviewSessionId: REVIEW_SESSION }, transport);

  assert.equal(sent.length, 8, 'all eight operations must be exercised');
  for (const call of sent) {
    assert.equal(call.route, TRAINING_REVIEW_ROUTE);
    assert.equal(call.body.trainingSessionId, SUBJECT.trainingSessionId);
    assert.equal(call.body.sourceId, SUBJECT.sourceId);
    assert.ok(!('runId' in call.body), 'a run id must never appear on a training request');
    assert.ok(!('artifactId' in call.body));
    assert.match(String(call.body.action), /^training_/);
  }
});

test('the idempotency key is STABLE for one recording, so a retry is not a second review', () => {
  const key = stableIdempotencyKey(SUBJECT);
  assert.equal(key, stableIdempotencyKey({ ...SUBJECT }));
  assert.ok(key.length >= 8);
  assert.notEqual(key, stableIdempotencyKey({ ...SUBJECT, sourceId: SUCCESSOR }));
});

test('opening a review returns the session the server named, and refuses a nameless success', async () => {
  const good = await createTrainingReview(PATH, { idempotencyKey: 'coach-abc-123' },
    recorder(okWith({ ok: true, created: true, reviewSessionId: REVIEW_SESSION, status: 'open' })).transport);
  assert.equal(good.ok, true);
  assert.equal(good.ok && good.value.reviewSessionId, REVIEW_SESSION);
  assert.equal(good.ok && good.value.created, true);

  const nameless = await createTrainingReview(PATH, { idempotencyKey: 'coach-abc-123' },
    recorder(okWith({ ok: true })).transport);
  assert.equal(nameless.ok, false);
  assert.match(!nameless.ok ? nameless.error : '', /did not name a review session/);
});

test('a correction reports the SUCCESSOR id the server minted, not the id we sent', async () => {
  const result = await addTrainingAnnotation(PATH, {
    reviewSessionId: REVIEW_SESSION, temporalRange: { startMs: 10000, endMs: 25000 },
    coachText: 'Chamfer the edge to 0.5mm before the pocket cut.', supersedesAnnotationId: ANNOTATION,
  }, recorder(okWith({
    ok: true, created: true, annotationId: SUCCESSOR, ordinal: 2,
    anchorDigest: DECIDED.annotations[2].anchorDigest, supersededAnnotationId: ANNOTATION,
  })).transport);
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.value.annotationId, SUCCESSOR);
  assert.notEqual(result.ok && result.value.annotationId, ANNOTATION);
  // The anchor digest is the server's; the client never invents one.
  assert.equal(result.ok && result.value.anchorDigest, DECIDED.annotations[2].anchorDigest);
});

test('a refusal keeps its typed reason, and unreachable is separated from refused', async () => {
  const frozen = await freezeTrainingSubmission(PATH, { reviewSessionId: REVIEW_SESSION },
    recorder(() => ({ status: 409, body: { ok: false, reason: 'submission_frozen', error: 'already frozen' } })).transport);
  assert.equal(frozen.ok, false);
  assert.equal(!frozen.ok && frozen.reason, 'submission_frozen');
  assert.equal(!frozen.ok && frozen.unavailable, false);
  assert.match(!frozen.ok ? frozen.error : '', /frozen/i);

  // A typed unavailable reason is unavailable EVEN AT a 4xx-shaped status: the backend
  // answers `coaching_disabled` with 503, and a client that keyed only off the status
  // code would render "you have coached nothing" the day that changes.
  const disabled = await freezeTrainingSubmission(PATH, { reviewSessionId: REVIEW_SESSION },
    recorder(() => ({ status: 400, body: { ok: false, reason: 'coaching_disabled', error: 'off' } })).transport);
  assert.equal(!disabled.ok && disabled.unavailable, true);
  assert.equal(!disabled.ok && disabled.reason, 'coaching_disabled');

  const threw = await freezeTrainingSubmission(PATH, { reviewSessionId: REVIEW_SESSION },
    async () => { throw new Error('offline'); });
  assert.equal(threw.ok, false);
  assert.equal(!threw.ok && threw.unavailable, true);
  assert.match(!threw.ok ? threw.error : '', /Nothing was changed/);
});

test('a reason this repo does not know still reaches the Coach as the server\'s words', async () => {
  const result = await freezeTrainingSubmission(PATH, { reviewSessionId: REVIEW_SESSION },
    recorder(() => ({ status: 400, body: { ok: false, reason: 'invented_future_reason', error: 'a very specific thing' } })).transport);
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.reason, null);
  assert.equal(!result.ok ? result.error : '', 'a very specific thing');
});

test('a 200 whose body says ok:false is a refusal, not a success', async () => {
  const result = await attachTrainingEvidence(PATH, {
    annotationId: ANNOTATION, evidenceKind: 'clip',
    temporalRange: { startMs: 0, endMs: 5000 }, consentReceiptDigest: CONSENT,
  }, recorder(okWith({ ok: false, reason: 'evidence_not_contained', error: 'That clip is not inside its moment.' })).transport);
  assert.equal(result.ok, false);
  assert.match(!result.ok ? result.error : '', /not inside its moment/);
});

test('deciding a card echoes the digest shown, reports mint_deferred, and never asks for activation', async () => {
  const { sent, transport } = recorder(okWith({
    ok: true, proposalId: PROPOSAL.proposalId, status: 'confirmed',
    canonicalLinkState: 'mint_deferred', canonicalCandidateId: null, influenceState: 'inert',
  }));
  const result = await decideTrainingProposal(PATH, {
    proposalId: PROPOSAL.proposalId, decision: 'confirmed', expectedProposalDigest: PROPOSAL.proposalDigest,
  }, transport);
  assert.equal(result.ok, true);
  // MINT DEFERRED IS REPORTED, NOT REPAIRED. There is no candidate id, and the client
  // does not invent one to make the state look complete.
  assert.equal(result.ok && result.value.canonicalLinkState, 'mint_deferred');
  assert.equal(result.ok && result.value.canonicalCandidateId, null);
  assert.equal(result.ok && result.value.influenceState, 'inert');

  const wire = JSON.stringify(sent[0].body);
  assert.ok(wire.includes(PROPOSAL.proposalDigest), 'the digest of the card shown must travel');
  assert.ok(!/activate/.test(wire));
  assert.ok(!/promote/.test(wire));
});

test('a stale confirmation is refused by reason, not by a generic bad request', async () => {
  const result = await decideTrainingProposal(PATH, {
    proposalId: PROPOSAL.proposalId, decision: 'confirmed', expectedProposalDigest: PROPOSAL.proposalDigest,
  }, recorder(() => ({
    status: 412, body: { ok: false, reason: 'stale_proposal_confirmation', error: 'confirm the card you were shown' },
  })).transport);
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.reason, 'stale_proposal_confirmation');
  assert.match(!result.ok ? result.error : '', /changed since you were shown it/);
});

test('the review read returns a STATUS, and an unreachable service is not an empty record', async () => {
  const live = await readTrainingReview(PATH, { reviewSessionId: REVIEW_SESSION },
    recorder(okWith({ ok: true, review: DECIDED })).transport);
  assert.equal(live.live, true);
  assert.equal(live.live && live.review.decisions.length, DECIDED.proposals.length);

  const down = await readTrainingReview(PATH, { reviewSessionId: REVIEW_SESSION },
    async () => { throw new Error('offline'); });
  assert.deepEqual(down, { live: false, reason: 'unreachable', unavailable: true });

  const refused = await readTrainingReview(PATH, { reviewSessionId: REVIEW_SESSION },
    recorder(() => ({ status: 404, body: { ok: false, reason: 'review_not_found', error: 'not found' } })).transport);
  assert.equal(refused.live, false);
  assert.equal(!refused.live && refused.reason, 'review_not_found');
  assert.equal(!refused.live && refused.unavailable, false);

  // A projection the SERVER refused to build is unavailable, which is not the same as
  // a review that does not exist, and must not render the same way.
  const unbuildable = await readTrainingReview(PATH, { reviewSessionId: REVIEW_SESSION },
    recorder(() => ({
      status: 503, body: { ok: false, unavailable: true, reason: 'training_review_source_missing', error: 'no source' },
    })).transport);
  assert.equal(!unbuildable.live && unbuildable.unavailable, true);
});

test('no other module in the repo fetches the training route', () => {
  // The seam is only a seam while it is the only door. This is a source assertion on
  // purpose: it is a statement about the whole tree, which no behavioural test can make.
  const client = readFileSync(fileURLToPath(new URL('./training-review-client.ts', import.meta.url)), 'utf8');
  assert.match(client, /fetch\(/);
  for (const relative of [
    '../app/(dashboard)/_components/training-review-room.tsx',
    '../app/(dashboard)/_components/coach-decision-cards.tsx',
    '../app/(dashboard)/_components/training-authority-projection.tsx',
    '../app/(dashboard)/_components/review-subject-room.tsx',
  ]) {
    // Comments are stripped first: these files EXPLAIN the seam, and an explanation
    // of a backend path is not a call to one.
    const source = readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(source, /\bfetch\(/, `${relative} must not fetch; use the client module`);
    assert.doesNotMatch(source, /\/api\/v2\//, `${relative} must not spell a backend path`);
    assert.doesNotMatch(source, /'\/api\//, `${relative} must not spell a dashboard route`);
  }
});
