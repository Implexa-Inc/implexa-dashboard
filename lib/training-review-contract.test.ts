// node --test lib/training-review-contract.test.ts
//
// THE CROSS-REPO SEAM. Everything this repo emits toward the Agent Coach API — route
// strings, version literals, refusal vocabulary, subject shapes — is graded against the
// BACKEND's own generated contract fixture, not against a copy of it this repo wrote.
//
// Two layers, deliberately separate:
//
//   1. VENDORED  compares against `test-fixtures/training-review-f0.v1.json`, which is
//      a byte-for-byte copy of the backend's generated file. Runs everywhere, including
//      CI, with no second checkout.
//   2. LIVE      re-runs the backend's own producer and compares the vendored copy to
//      what it emits. Needs the producing repository, and SKIPS HONESTLY without it —
//      the same `IMPLEXA_BACKEND_DIR` convention as
//      `lib/outcome-orchestration-contract.test.ts`.
//
// Layer 1 alone would pass forever against a stale vendored file; layer 2 alone would
// be unrunnable in CI. Neither is sufficient, which is why both are here.

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import fixture from '../test-fixtures/training-review-f0.v1.json' with { type: 'json' };

import {
  COACH_BASE, IDEMPOTENCY_HEADER, IDEMPOTENCY_KEY_MIN,
  TRAINING_FIXTURE_SCHEMA, TRAINING_PROJECTION_VERSION, TRAINING_REVIEW_CONTRACT_VERSION,
  TRAINING_ROUTE_KEYS, TRAINING_ROUTE_TEMPLATES,
  resolveTrainingReviewAction,
} from './training-review-actions.ts';
import { TRAINING_REVIEW_ACTIONS, writePathFor } from './review-subject.ts';
import { TRAINING_REVIEW_REFUSAL_REASONS } from './training-review-refusals.ts';
import { parseTrainingReview } from './training-review-projection.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GENERATOR = 'scripts/generate-agent-coach-fixture.js';
const GENERATED = 'test-fixtures/generated/agent-coach-f0.json';

const backendFixture = fixture.backend as Record<string, any>;
const routes = backendFixture.routes as Record<string, string>;
const reviews = backendFixture.reviews as Record<string, any>;

const SESSION = '00000001-0000-4000-8000-000000000001';
const SOURCE = '00000003-0000-4000-8000-000000000003';
const REVIEW = '00000002-0000-4000-8000-000000000002';
const ANNOTATION = '00000009-0000-4000-8000-000000000009';
const SUBMISSION = '00000014-0000-4000-8000-000000000014';
const PROPOSAL = '00000015-0000-4000-8000-000000000015';
const DIGEST = 'c'.repeat(64);

const subject = { kind: 'training_source', trainingSessionId: SESSION, sourceId: SOURCE } as const;
const path = writePathFor(subject);

/** The identity fields `sealWrite` puts on every training envelope. */
const sealed = (extra: Record<string, unknown> = {}) =>
  ({ trainingSessionId: SESSION, sourceId: SOURCE, ...extra });

/** Turn one emitted concrete path back into the fixture's template spelling. */
function templateOf(method: string, emitted: string): string {
  const withParams = emitted
    .replace(`/sessions/${SESSION}/`, '/sessions/:trainingSessionId/')
    .replace(`/reviews/${REVIEW}`, '/reviews/:reviewSessionId')
    .replace(`/annotations/${ANNOTATION}`, '/annotations/:annotationId')
    .replace(`/submissions/${SUBMISSION}`, '/submissions/:submissionId')
    .replace(`/proposals/${PROPOSAL}`, '/proposals/:proposalId');
  return `${method} ${withParams}`;
}

// ── Versions ──────────────────────────────────────────────────────────────────────

test('the three version literals are the backend fixture\'s, byte for byte', () => {
  assert.equal(backendFixture.schema, TRAINING_FIXTURE_SCHEMA);
  assert.equal(backendFixture.schema, 'implexa.agent-coach-f0.fixture.v1');
  assert.equal(backendFixture.projectionVersion, TRAINING_PROJECTION_VERSION);
  assert.equal(backendFixture.projectionVersion, 'agent-training-review.v1');
  assert.equal(backendFixture.reviewContractVersion, TRAINING_REVIEW_CONTRACT_VERSION);
  assert.equal(backendFixture.reviewContractVersion, 'agent-training-review-session.v1');
});

test('a projection stamped with those versions reports NO skew', () => {
  const status = parseTrainingReview({ ok: true, review: reviews.decided }, {
    projectionVersion: TRAINING_PROJECTION_VERSION,
    contractVersion: TRAINING_REVIEW_CONTRACT_VERSION,
  });
  assert.equal(status.live, true);
  assert.equal(status.live && status.review.contractSkew, null);
});

test('a projection stamped with a LATER version reports skew rather than rendering blank', () => {
  const later = { ...reviews.decided, projectionVersion: 'agent-training-review.v2' };
  const status = parseTrainingReview({ ok: true, review: later }, {
    projectionVersion: TRAINING_PROJECTION_VERSION,
    contractVersion: TRAINING_REVIEW_CONTRACT_VERSION,
  });
  assert.equal(status.live, true);
  assert.equal(status.live && status.review.contractSkew, 'agent-training-review.v2');
});

// ── Routes ────────────────────────────────────────────────────────────────────────

test('this repo names exactly the backend\'s eight routes, and no others', () => {
  assert.deepEqual(
    Object.values(TRAINING_ROUTE_KEYS).sort(),
    Object.keys(routes).sort(),
  );
  assert.equal(TRAINING_REVIEW_ACTIONS.length, Object.keys(routes).length);
});

test('every declared route template is the backend fixture\'s string, byte for byte', () => {
  for (const action of TRAINING_REVIEW_ACTIONS) {
    assert.equal(
      TRAINING_ROUTE_TEMPLATES[action], routes[TRAINING_ROUTE_KEYS[action]],
      `${action} template diverged from the backend fixture`,
    );
  }
});

test('every EMITTED path matches the template it claims — the resolver cannot drift from its own docs', () => {
  const emissions: Array<[typeof TRAINING_REVIEW_ACTIONS[number], Record<string, unknown>]> = [
    ['training_attach_demonstration', sealed({
      localCapabilityId: '00000007-0000-4000-8000-000000000007',
      machineId: '00000006-0000-4000-8000-000000000006',
      mediaSha256: 'a'.repeat(64), sizeBytes: 41943040, durationMs: 600000, mediaType: 'video/mp4',
    })],
    ['training_create_review', sealed({ idempotencyKey: 'coach-fixture-key' })],
    ['training_read_review', sealed({ reviewSessionId: REVIEW })],
    ['training_add_annotation', sealed({
      reviewSessionId: REVIEW, temporalRange: { startMs: 10000, endMs: 25000 },
      coachText: 'Chamfer the edge before the pocket cut.',
    })],
    ['training_attach_evidence', sealed({
      annotationId: ANNOTATION, evidenceKind: 'clip',
      temporalRange: { startMs: 31000, endMs: 40000 }, consentReceiptDigest: '2'.repeat(64),
    })],
    ['training_freeze_submission', sealed({ reviewSessionId: REVIEW })],
    ['training_record_proposal', sealed({
      submissionId: SUBMISSION, ordinal: 0, kind: 'decision',
      sourceAnnotationIds: [ANNOTATION], triggerText: 't', selectedTreatment: 's', rationale: 'r',
      proposedScope: 'both', confidence: 'high',
    })],
    ['training_decide_proposal', sealed({
      proposalId: PROPOSAL, decision: 'confirmed', expectedProposalDigest: DIGEST,
    })],
  ];
  assert.equal(emissions.length, TRAINING_REVIEW_ACTIONS.length, 'every action must be exercised here');

  for (const [action, body] of emissions) {
    const target = resolveTrainingReviewAction(action, body);
    assert.equal(typeof target, 'object', `${action} was refused: ${String(target)}`);
    if (typeof target === 'string') continue;
    assert.ok(target.path.startsWith(COACH_BASE), `${action} escaped ${COACH_BASE}`);
    assert.equal(
      templateOf(target.method, target.path), routes[TRAINING_ROUTE_KEYS[action]],
      `${action} emitted a path that is not its backend route`,
    );
  }
});

// ── The Idempotency-Key header ────────────────────────────────────────────────────

test('creating a review carries the Idempotency-Key header, and nothing else does', () => {
  const created = resolveTrainingReviewAction('training_create_review', sealed({ idempotencyKey: 'coach-fixture-key' }));
  assert.equal(typeof created, 'object');
  if (typeof created === 'string') return;
  assert.deepEqual(created.headers, { 'Idempotency-Key': 'coach-fixture-key' });
  assert.equal(IDEMPOTENCY_HEADER, 'Idempotency-Key');

  const read = resolveTrainingReviewAction('training_read_review', sealed({ reviewSessionId: REVIEW }));
  assert.equal(typeof read, 'object');
  if (typeof read === 'string') return;
  assert.equal(read.headers, undefined);
});

test('a short or missing idempotency key is refused before the round trip', () => {
  assert.equal(IDEMPOTENCY_KEY_MIN, 8);
  for (const key of [undefined, '', 'short', '1234567']) {
    const target = resolveTrainingReviewAction('training_create_review', sealed({ idempotencyKey: key }));
    assert.equal(typeof target, 'string', `key ${JSON.stringify(key)} should have been refused`);
  }
  // `invalid_idempotency_key` is the backend's reason for exactly this, and it must be
  // in the vocabulary this repo carries.
  assert.ok((backendFixture.refusalReasons as string[]).includes('invalid_idempotency_key'));
});

test('createReview sends the server\'s own body key, `sessionId`', () => {
  const target = resolveTrainingReviewAction('training_create_review', sealed({ idempotencyKey: 'coach-fixture-key' }));
  assert.equal(typeof target, 'object');
  if (typeof target === 'string') return;
  assert.deepEqual(target.body, { sessionId: SESSION, sourceId: SOURCE });
});

// ── Refusal vocabulary ────────────────────────────────────────────────────────────

test('the refusal vocabulary is the backend\'s 66, exactly — same members, same order', () => {
  const backendReasons = backendFixture.refusalReasons as string[];
  assert.equal(backendReasons.length, 66);
  assert.deepEqual([...TRAINING_REVIEW_REFUSAL_REASONS], backendReasons);
});

test('the reasons this reconciliation was called out for are all present', () => {
  for (const reason of [
    'invalid_media_duration', 'invalid_capture_mode', 'capture_mode_not_enabled',
    'invalid_media_digest', 'invalid_media_size', 'invalid_media_type',
    'custody_binding_required', 'captured_at_not_observed',
  ]) {
    assert.ok(
      (TRAINING_REVIEW_REFUSAL_REASONS as readonly string[]).includes(reason),
      `${reason} missing from the adopted vocabulary`,
    );
  }
});

// ── Subjects ──────────────────────────────────────────────────────────────────────

test('the subject union is byte-identical to the backend fixture\'s', () => {
  assert.deepEqual(backendFixture.subjects.runArtifact, {
    kind: 'run_artifact',
    runId: '00000021-0000-4000-8000-000000000021',
    artifactId: '00000022-0000-4000-8000-000000000022',
  });
  assert.deepEqual(backendFixture.subjects.trainingSource, {
    kind: 'training_source',
    trainingSessionId: SESSION,
    sourceId: SOURCE,
  });
  // Structural disjointness, at the data layer: a training subject has no run identity
  // to forge with.
  assert.ok(!('runId' in backendFixture.subjects.trainingSource));
  assert.ok(!('artifactId' in backendFixture.subjects.trainingSource));
  assert.ok(!('trainingSessionId' in backendFixture.subjects.runArtifact));
});

test('the projection\'s own subject round-trips through the parser unchanged', () => {
  const status = parseTrainingReview({ ok: true, review: reviews.marked }, {
    projectionVersion: TRAINING_PROJECTION_VERSION,
    contractVersion: TRAINING_REVIEW_CONTRACT_VERSION,
  });
  assert.equal(status.live, true);
  if (!status.live) return;
  assert.deepEqual(status.review.subject, backendFixture.subjects.trainingSource);
});

// ── Live producer ─────────────────────────────────────────────────────────────────

test('the vendored fixture is what the backend producer emits', (t) => {
  const candidates = [
    process.env.IMPLEXA_BACKEND_DIR,
    resolve(root, '../implexa-backend'),
    resolve(root, '../../implexa-backend'),
    resolve(root, '../../../implexa-backend'),
    resolve(root, '../../../../implexa-backend'),
  ].filter(Boolean) as string[];
  const backend = candidates.find((dir) => existsSync(resolve(dir, GENERATOR)));
  if (!backend) {
    // SKIP, NOT PASS. Nothing was verified and the message says what to set — the
    // failure mode this whole file exists to avoid is a green tick over an unmade
    // comparison.
    t.skip(
      `no backend checkout containing ${GENERATOR}; nothing verified. `
      + 'Set IMPLEXA_BACKEND_DIR=/path/to/implexa-backend to run this.',
    );
    return;
  }

  // The backend's OWN generated file must be current with its producer, or we would be
  // grading this repo against yesterday's contract.
  const check = spawnSync(process.execPath, [GENERATOR, '--check'], { cwd: backend, encoding: 'utf8' });
  assert.equal(check.status, 0, `backend ${GENERATED} is stale: ${check.stderr || check.stdout}`);

  const produced = readFileSync(resolve(backend, GENERATED), 'utf8');
  assert.equal(
    `${JSON.stringify(backendFixture, null, 2)}\n`, produced,
    'the vendored backend payload is not byte-identical to the producer output',
  );
});
