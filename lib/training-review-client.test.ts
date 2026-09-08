// node --test lib/training-review-client.test.ts
//
// The ONE module that talks to the training-review API. These tests run entirely
// against the local fixture with an injected transport — no network, no server — which
// is the whole point of the seam: the backend F0 can change its routes and only
// `training-review-actions.ts` moves.
//
// The property this file guards: every request this client can emit is a TRAINING
// request, addressed to the training route, carrying the training identity, and never
// asking for activation.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  TRAINING_REVIEW_ROUTE,
  amendTrainingAnnotation, attachTrainingEvidence, confirmTrainingDecision,
  createTrainingAnnotation, discardTrainingAnnotation, ensureTrainingReviewSession,
  readTrainingProjection, submitTrainingAnnotations,
  type TrainingTransport,
} from './training-review-client.ts';
import { writePathFor, type TrainingSourceSubject } from './review-subject.ts';

const fixture = JSON.parse(readFileSync(
  fileURLToPath(new URL('../test-fixtures/training-review-f0.v1.json', import.meta.url)), 'utf8',
));

const SUBJECT = fixture.subject as TrainingSourceSubject;
const PATH = writePathFor(SUBJECT);
const REVIEW_SESSION = fixture.responses.ensureTrainingSession.reviewSessionId as string;
const ANNOTATION = fixture.responses.createAnnotation.annotationId as string;
const DIGEST = 'a'.repeat(64);

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

test('every write goes to the training route with the training identity attached', async () => {
  const { sent, transport } = recorder(okWith({ ok: true, reviewSessionId: REVIEW_SESSION }));
  await ensureTrainingReviewSession(PATH, transport);
  await createTrainingAnnotation(PATH, {
    reviewSessionId: REVIEW_SESSION, temporalRange: { startMs: 1, endMs: 2 },
    coachText: 'why', anchorDigest: DIGEST,
  }, transport);
  await discardTrainingAnnotation(PATH, ANNOTATION, transport);
  await readTrainingProjection(PATH, transport);

  assert.equal(sent.length, 4);
  for (const call of sent) {
    assert.equal(call.route, TRAINING_REVIEW_ROUTE);
    assert.equal(call.body.trainingSessionId, SUBJECT.trainingSessionId);
    assert.equal(call.body.sourceId, SUBJECT.sourceId);
    assert.ok(!('runId' in call.body), 'a run id must never appear on a training request');
    assert.ok(!('artifactId' in call.body));
    assert.match(String(call.body.action), /_training_/);
  }
});

test('ensure returns the review session the server named, and refuses a nameless success', async () => {
  const good = await ensureTrainingReviewSession(PATH, recorder(okWith(fixture.responses.ensureTrainingSession)).transport);
  assert.equal(good.ok, true);
  assert.equal((good as { value: { reviewSessionId: string } }).value.reviewSessionId, REVIEW_SESSION);

  const nameless = await ensureTrainingReviewSession(PATH, recorder(okWith({ ok: true })).transport);
  assert.equal(nameless.ok, false);
  assert.match((nameless as { error: string }).error, /did not name a review session/);
});

test('an amend reports the SUCCESSOR id the server minted, not the id we sent', async () => {
  const result = await amendTrainingAnnotation(
    PATH, { annotationId: ANNOTATION, coachText: 'clearer' },
    recorder(okWith(fixture.responses.amendAnnotation)).transport,
  );
  assert.equal(result.ok, true);
  assert.equal((result as { value: { annotationId: string } }).value.annotationId, fixture.responses.amendAnnotation.annotationId);
  assert.notEqual((result as { value: { annotationId: string } }).value.annotationId, ANNOTATION);
});

test('a refusal is carried as words, and separated from unreachable', async () => {
  const refused = await submitTrainingAnnotations(
    PATH, { reviewSessionId: REVIEW_SESSION, annotationIds: [ANNOTATION], recordingDigest: DIGEST },
    recorder(() => ({ status: 409, body: fixture.responses.refusedAppendOnly })).transport,
  );
  assert.equal(refused.ok, false);
  assert.equal((refused as { error: string }).error, fixture.responses.refusedAppendOnly.error);
  assert.equal((refused as { unavailable: boolean }).unavailable, false);

  const down = await submitTrainingAnnotations(
    PATH, { reviewSessionId: REVIEW_SESSION, annotationIds: [ANNOTATION], recordingDigest: DIGEST },
    recorder(() => ({ status: 503, body: fixture.responses.unavailable })).transport,
  );
  assert.equal((down as { unavailable: boolean }).unavailable, true);

  const threw = await submitTrainingAnnotations(
    PATH, { reviewSessionId: REVIEW_SESSION, annotationIds: [ANNOTATION], recordingDigest: DIGEST },
    async () => { throw new Error('offline'); },
  );
  assert.equal(threw.ok, false);
  assert.equal((threw as { unavailable: boolean }).unavailable, true);
  assert.match((threw as { error: string }).error, /Nothing was changed/);
});

test('a 200 whose body says ok:false is a refusal, not a success', async () => {
  const result = await attachTrainingEvidence(
    PATH, { annotationId: ANNOTATION, kind: 'clip', mediaSha256: DIGEST, temporalRange: { startMs: 0, endMs: 5 } },
    recorder(okWith({ ok: false, error: 'That clip is not inside its moment.' })).transport,
  );
  assert.equal(result.ok, false);
  assert.match((result as { error: string }).error, /not inside its moment/);
});

test('an idempotent re-submit is reported as idempotent, not as a second submission', async () => {
  const result = await submitTrainingAnnotations(
    PATH, { reviewSessionId: REVIEW_SESSION, annotationIds: [ANNOTATION], recordingDigest: DIGEST },
    recorder(okWith(fixture.responses.submitAnnotationsIdempotent)).transport,
  );
  assert.equal(result.ok, true);
  assert.equal((result as { value: { idempotent: boolean } }).value.idempotent, true);
});

test('confirming a decision returns an INERT candidate link and never requests activation', async () => {
  const { sent, transport } = recorder(okWith(fixture.responses.confirmDecision));
  const result = await confirmTrainingDecision(PATH, {
    submissionId: fixture.responses.submitAnnotations.submissionId,
    decisionId: fixture.projection.projection.decisions[0].id,
    disposition: 'accepted',
  }, transport);
  assert.equal(result.ok, true);
  assert.equal((result as { value: { candidateId: string | null } }).value.candidateId, fixture.responses.confirmDecision.candidateId);
  // The client has no parameter that could ask for it, and none appears on the wire.
  const wire = JSON.stringify(sent[0].body);
  assert.ok(!/"activate"\s*:\s*true/.test(wire));
  assert.ok(!/promote/.test(wire));
});

test('the projection read returns a STATUS, and an unreachable service is not an empty record', async () => {
  const live = await readTrainingProjection(PATH, recorder(okWith(fixture.projection)).transport);
  assert.equal(live.live, true);

  const down = await readTrainingProjection(PATH, async () => { throw new Error('offline'); });
  assert.deepEqual(down, { live: false, reason: 'unreachable' });

  const refused = await readTrainingProjection(PATH, recorder(() => ({ status: 403, body: fixture.projectionRefused })).transport);
  assert.equal(refused.live, false);
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
