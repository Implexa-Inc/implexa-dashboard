// node --test lib/review-subject.test.ts
//
// THE ONE PROPERTY THIS FILE EXISTS FOR: a `training_source` subject cannot produce a
// run-review write. Not "is not currently wired to" — cannot. Every test below attacks
// that claim from a different side: the type level, the value level, the action
// namespace, the route, and the server allowlists in both directions.
//
// The exhaustiveness test compiles a probe with a THIRD subject kind and requires the
// compiler to reject it. Without that, "the switch is exhaustive" is a comment.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  RUN_REVIEW_ACTIONS, TRAINING_REVIEW_ACTIONS,
  isRunReviewAction, isTrainingReviewAction,
  parseReviewSubject, reviewSubjectLabel, sealWrite, writePathFor,
  type RunArtifactSubject, type TrainingSourceSubject,
} from './review-subject.ts';
import { resolveReviewAction } from './review-actions.ts';
import { resolveTrainingReviewAction, TRAINING_BASE } from './training-review-actions.ts';

const RUN_SUBJECT: RunArtifactSubject = {
  kind: 'run_artifact',
  runId: '11111111-1111-4111-8111-111111111111',
  artifactId: '22222222-2222-4222-8222-222222222222',
};
const TRAINING_SUBJECT: TrainingSourceSubject = {
  kind: 'training_source',
  trainingSessionId: '33333333-3333-4333-8333-333333333333',
  sourceId: '44444444-4444-4444-8444-444444444444',
};

test('the discriminant selects disjoint write paths', () => {
  const run = writePathFor(RUN_SUBJECT);
  const training = writePathFor(TRAINING_SUBJECT);
  assert.equal(run.authority, 'run_review');
  assert.equal(run.route, '/api/review');
  assert.equal(training.authority, 'training_review');
  assert.equal(training.route, '/api/training-review');
  assert.notEqual(run.authority, training.authority);
  assert.notEqual(run.route, training.route);
});

test('a training write path carries no run identity at all', () => {
  const training = writePathFor(TRAINING_SUBJECT);
  const keys = Object.keys(training.subject).sort();
  assert.deepEqual(keys, ['kind', 'sourceId', 'trainingSessionId']);
  // Not "undefined" — absent. A `runId` that existed as undefined is a field a future
  // bug can fill in.
  assert.ok(!('runId' in training.subject));
  assert.ok(!('artifactId' in training.subject));
  assert.equal(JSON.stringify(training).includes(RUN_SUBJECT.runId), false);
});

test('a training path refuses every run-review action name at seal time', () => {
  const training = writePathFor(TRAINING_SUBJECT);
  for (const action of RUN_REVIEW_ACTIONS) {
    assert.throws(
      // The cast is the exact move a future bug makes. The runtime guard is what
      // stops it from mattering.
      () => sealWrite(training, action as unknown as (typeof TRAINING_REVIEW_ACTIONS)[number], {}),
      /is not a training-review action/,
      `sealWrite must refuse the run action ${action}`,
    );
  }
});

test('a run path refuses every training action name at seal time', () => {
  const run = writePathFor(RUN_SUBJECT);
  for (const action of TRAINING_REVIEW_ACTIONS) {
    assert.throws(
      () => sealWrite(run, action as unknown as (typeof RUN_REVIEW_ACTIONS)[number], {}),
      /is not a run-review action/,
    );
  }
});

test('the two action namespaces share no name', () => {
  const overlap = TRAINING_REVIEW_ACTIONS.filter((action) => (RUN_REVIEW_ACTIONS as readonly string[]).includes(action));
  assert.deepEqual(overlap, []);
  for (const action of TRAINING_REVIEW_ACTIONS) {
    assert.equal(isTrainingReviewAction(action), true);
    assert.equal(isRunReviewAction(action), false);
  }
  for (const action of RUN_REVIEW_ACTIONS) {
    assert.equal(isRunReviewAction(action), true);
    assert.equal(isTrainingReviewAction(action), false);
  }
});

test('the RUN allowlist refuses every training action, so a forged POST cannot cross over', () => {
  for (const action of TRAINING_REVIEW_ACTIONS) {
    const resolved = resolveReviewAction(action, {
      trainingSessionId: TRAINING_SUBJECT.trainingSessionId,
      sourceId: TRAINING_SUBJECT.sourceId,
      runId: RUN_SUBJECT.runId,
      artifactId: RUN_SUBJECT.artifactId,
    });
    assert.equal(typeof resolved, 'string', `run allowlist must refuse ${action}`);
  }
});

test('the TRAINING allowlist refuses every run action, and says why', () => {
  for (const action of RUN_REVIEW_ACTIONS) {
    const resolved = resolveTrainingReviewAction(action, {
      runId: RUN_SUBJECT.runId, artifactId: RUN_SUBJECT.artifactId,
      sessionId: RUN_SUBJECT.runId,
      trainingSessionId: TRAINING_SUBJECT.trainingSessionId, sourceId: TRAINING_SUBJECT.sourceId,
    });
    assert.equal(typeof resolved, 'string');
    assert.match(resolved as string, /run-review action/);
  }
});

test('no training upstream path can address a run-review row', () => {
  const bodies: Record<string, Record<string, unknown>> = {
    ensure_training_session: { trainingSessionId: TRAINING_SUBJECT.trainingSessionId, sourceId: TRAINING_SUBJECT.sourceId },
    create_training_annotation: {
      reviewSessionId: '55555555-5555-4555-8555-555555555555', sourceId: TRAINING_SUBJECT.sourceId,
      temporalRange: { startMs: 10, endMs: 20 }, coachText: 'why',
      anchorDigest: 'a'.repeat(64),
    },
    amend_training_annotation: { annotationId: '66666666-6666-4666-8666-666666666666', coachText: 'why' },
    discard_training_annotation: { annotationId: '66666666-6666-4666-8666-666666666666' },
    attach_training_evidence: {
      annotationId: '66666666-6666-4666-8666-666666666666', kind: 'clip',
      mediaSha256: 'b'.repeat(64), temporalRange: { startMs: 0, endMs: 5 },
    },
    submit_training_annotations: {
      reviewSessionId: '55555555-5555-4555-8555-555555555555',
      annotationIds: ['66666666-6666-4666-8666-666666666666'], recordingDigest: 'c'.repeat(64),
    },
    confirm_training_decision: {
      submissionId: '77777777-7777-4777-8777-777777777777',
      decisionId: '88888888-8888-4888-8888-888888888888', disposition: 'accepted',
    },
    read_training_projection: {
      trainingSessionId: TRAINING_SUBJECT.trainingSessionId, sourceId: TRAINING_SUBJECT.sourceId,
    },
  };
  for (const action of TRAINING_REVIEW_ACTIONS) {
    const resolved = resolveTrainingReviewAction(action, bodies[action]);
    assert.notEqual(typeof resolved, 'string', `${action} should resolve: ${resolved}`);
    const { path } = resolved as { path: string };
    assert.ok(path.startsWith(TRAINING_BASE), `${action} escaped the training base: ${path}`);
    assert.ok(!path.includes('/review/runs/'), `${action} addressed a run: ${path}`);
    assert.ok(!path.includes('/review/sessions/'), `${action} addressed a run-review session: ${path}`);
    assert.ok(!path.includes('/api/v2/review'), `${action} reached run review: ${path}`);
  }
});

test('a sealed training write carries the training identity and no run id', () => {
  const training = writePathFor(TRAINING_SUBJECT);
  const envelope = sealWrite(training, 'create_training_annotation', { coachText: 'because' });
  assert.equal(envelope.authority, 'training_review');
  assert.equal(envelope.route, '/api/training-review');
  assert.equal(envelope.payload.trainingSessionId, TRAINING_SUBJECT.trainingSessionId);
  assert.equal(envelope.payload.sourceId, TRAINING_SUBJECT.sourceId);
  assert.ok(!('runId' in envelope.payload));
  assert.ok(!('artifactId' in envelope.payload));
});

test('a sealed write is frozen, so a later mutation cannot re-address it', () => {
  const envelope = sealWrite(writePathFor(TRAINING_SUBJECT), 'discard_training_annotation', {});
  assert.throws(() => {
    (envelope.payload as Record<string, unknown>).runId = RUN_SUBJECT.runId;
  });
  assert.ok(!('runId' in envelope.payload));
});

test('parseReviewSubject refuses a half-run/half-demonstration subject', () => {
  assert.deepEqual(parseReviewSubject(RUN_SUBJECT), RUN_SUBJECT);
  assert.deepEqual(parseReviewSubject(TRAINING_SUBJECT), TRAINING_SUBJECT);
  // The exact shape a conflation bug produces: refused, never resolved by precedence.
  assert.equal(parseReviewSubject({ ...TRAINING_SUBJECT, runId: RUN_SUBJECT.runId }), null);
  assert.equal(parseReviewSubject({ ...RUN_SUBJECT, trainingSessionId: TRAINING_SUBJECT.trainingSessionId }), null);
  assert.equal(parseReviewSubject({ kind: 'training_source', trainingSessionId: 'nope', sourceId: 'nope' }), null);
  assert.equal(parseReviewSubject({ kind: 'owner_demonstration' }), null);
  assert.equal(parseReviewSubject(null), null);
  assert.equal(parseReviewSubject([RUN_SUBJECT]), null);
});

test('the two subjects are described to the customer in different words', () => {
  assert.notEqual(reviewSubjectLabel(RUN_SUBJECT), reviewSubjectLabel(TRAINING_SUBJECT));
  assert.match(reviewSubjectLabel(TRAINING_SUBJECT), /demonstrated/i);
  assert.doesNotMatch(reviewSubjectLabel(TRAINING_SUBJECT), /run/i);
});

// ── Exhaustiveness, proven by the compiler ────────────────────────────────────────

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
// The compiler binary DIRECTLY, never `npx tsc`, and RESOLVED rather than assembled
// from ROOT. Two trees break the naive path: a git worktree has no node_modules of its
// own, and a mutation harness runs from a throwaway copy under $TMPDIR. In both, `npx`
// prints "This is not the tsc command you are looking for" and a hand-built path does
// not exist — and every "must not compile" probe would have scored that as a refusal
// it never earned.
const TSC = createRequire(import.meta.url).resolve('typescript/bin/tsc');

function tscProbe(source: string): { ok: boolean; output: string } {
  const dir = mkdtempSync(join(tmpdir(), 'review-subject-probe-'));
  try {
    const file = join(dir, 'probe.ts');
    writeFileSync(file, source, 'utf8');
    try {
      execFileSync(process.execPath, [TSC, '--noEmit', '--strict', '--skipLibCheck', '--target', 'ES2022',
        '--moduleResolution', 'bundler', '--module', 'esnext', '--allowImportingTsExtensions', file], {
        cwd: ROOT, encoding: 'utf8', stdio: 'pipe',
      });
      return { ok: true, output: '' };
    } catch (error) {
      const e = error as { stdout?: string; stderr?: string };
      return { ok: false, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const SUBJECT_MODULE = JSON.stringify(join(ROOT, 'lib/review-subject.ts'));

test('a switch over ReviewSubject that handles both kinds compiles', { timeout: 120000 }, () => {
  const probe = `
    import { assertNever, type ReviewSubject } from ${SUBJECT_MODULE};
    export function f(subject: ReviewSubject): string {
      switch (subject.kind) {
        case 'run_artifact': return subject.runId;
        case 'training_source': return subject.trainingSessionId;
        default: return assertNever(subject, 'probe');
      }
    }
  `;
  const result = tscProbe(probe);
  assert.equal(result.ok, true, result.output);
});

test('a switch that OMITS training_source fails to compile — it may not fall through to run review', { timeout: 120000 }, () => {
  const probe = `
    import { assertNever, type ReviewSubject } from ${SUBJECT_MODULE};
    export function f(subject: ReviewSubject): string {
      switch (subject.kind) {
        case 'run_artifact': return subject.runId;
        default: return assertNever(subject, 'probe');
      }
    }
  `;
  const result = tscProbe(probe);
  assert.equal(result.ok, false, 'omitting an arm must be a COMPILE error, not a runtime fall-through');
  assert.match(result.output, /not assignable to parameter of type 'never'/);
});

test('a training subject cannot be handed to a run-review-shaped consumer', { timeout: 120000 }, () => {
  const probe = `
    import { writePathFor, type RunReviewWritePath, type TrainingSourceSubject } from ${SUBJECT_MODULE};
    const subject: TrainingSourceSubject = {
      kind: 'training_source',
      trainingSessionId: '33333333-3333-4333-8333-333333333333',
      sourceId: '44444444-4444-4444-8444-444444444444',
    };
    export const path: RunReviewWritePath = writePathFor(subject);
  `;
  const result = tscProbe(probe);
  assert.equal(result.ok, false, 'a training subject must not type as a run-review write path');
  // A refusal for the WRONG reason (an unresolved module, a bad flag) would make this
  // test pass while proving nothing.
  assert.doesNotMatch(result.output, /TS2307|TS6064|Cannot find module/, result.output);
  assert.match(result.output, /not assignable to type 'RunReviewWritePath'/, result.output);
});
