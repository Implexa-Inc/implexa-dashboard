#!/usr/bin/env node
/**
 * The training-review fixture is the CONTRACT SEAM with the Agent Coach backend.
 *
 * THREE MODES, AND THEY MUST NOT BE CONFUSED — the same split
 * `check-marketplace-evidence-channels-fixture.mjs` established:
 *
 *   --shape       the vendored file is the contract this repo parses against.
 *                 Answerable alone, and never claims more than that.
 *   --provenance  the vendored file is what the backend actually produced.
 *                 REQUIRES the producing repository, and SKIPS HONESTLY without it.
 *   --vendor      re-copy from the backend producer. Requires the same.
 *
 * ── WHY `--provenance` MAY SKIP BUT MUST NEVER PASS VACUOUSLY ────────────────────
 *
 * An earlier generation of this script always FAILED, because the backend producer did
 * not exist and `provenance.producedBy` was null — a claim this repo was not entitled
 * to make. The producer exists now (`scripts/generate-agent-coach-fixture.js` in
 * implexa-backend), so the check is real: it re-runs that generator with `--check` to
 * prove the backend's own copy is not stale, then compares this repo's vendored payload
 * to it byte-for-byte.
 *
 * Without the backend checked out there is nothing to compare against, and the script
 * SKIPS with a message naming exactly what to set. It does not print "verified" and
 * exit zero — an unverified provenance claim is worse than none — and it does not fail
 * either, because "you do not have the other repo here" is not a contract violation.
 *
 * Point it at the backend with IMPLEXA_BACKEND_DIR, or check the backend out beside
 * this repo.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const RELATIVE = 'test-fixtures/training-review-f0.v1.json';
const SCHEMA = 'implexa.agent-training-review.fixture.v1';
const BACKEND_SCHEMA = 'implexa.agent-coach-f0.fixture.v1';
const PROJECTION_VERSION = 'agent-training-review.v1';
const REVIEW_CONTRACT_VERSION = 'agent-training-review-session.v1';
const COACH_BASE = '/api/v2/agent-coach';
const REFUSAL_COUNT = 66;

/** The backend producer and the file it writes. Both are part of the claim. */
const GENERATOR = 'scripts/generate-agent-coach-fixture.js';
const GENERATED = 'test-fixtures/generated/agent-coach-f0.json';

const wantsShape = process.argv.includes('--shape');
const wantsProvenance = process.argv.includes('--provenance');
const wantsVendor = process.argv.includes('--vendor');
if (!wantsShape && !wantsProvenance && !wantsVendor) {
  console.error('Usage: check-training-review-fixture.mjs [--shape] [--provenance] [--vendor]');
  process.exit(2);
}

/**
 * Where the producing repository is.
 *
 * IMPLEXA_BACKEND_DIR wins. The fallbacks are the layouts this repo is actually checked
 * out in; each is accepted only if it CONTAINS THE GENERATOR, so a backend checkout on
 * an unrelated branch is skipped rather than graded against.
 */
function findBackend() {
  const candidates = [
    process.env.IMPLEXA_BACKEND_DIR,
    resolve(root, '../implexa-backend'),
    resolve(root, '../../implexa-backend'),
    resolve(root, '../../../implexa-backend'),
    resolve(root, '../../../../implexa-backend'),
  ].filter(Boolean);
  return candidates.find((dir) => existsSync(resolve(dir, GENERATOR))) ?? null;
}

const target = join(root, RELATIVE);
const problems = [];
const need = (condition, message) => { if (!condition) problems.push(message); };

// ── --vendor ──────────────────────────────────────────────────────────────────────

if (wantsVendor) {
  const backend = findBackend();
  if (!backend) {
    console.error(`✖ cannot vendor: no backend checkout with ${GENERATOR}. Set IMPLEXA_BACKEND_DIR.`);
    process.exit(1);
  }
  const produced = JSON.parse(readFileSync(resolve(backend, GENERATED), 'utf8'));
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: backend, encoding: 'utf8' });
  const commit = head.status === 0 ? head.stdout.trim() : null;
  const existing = existsSync(target) ? JSON.parse(readFileSync(target, 'utf8')) : {};
  const next = {
    $schema: SCHEMA,
    provenance: {
      producedBy: commit ? `implexa-backend@${commit}` : null,
      producer: GENERATOR,
      producedFile: GENERATED,
      backendPullRequest: existing.provenance?.backendPullRequest ?? null,
      verifyWith: 'IMPLEXA_BACKEND_DIR=/path/to/implexa-backend npm run fixtures:training-review:check',
    },
    upstream: existing.upstream ?? null,
    backend: produced,
  };
  writeFileSync(target, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`vendored ${RELATIVE} from ${backend} @ ${commit ?? 'unknown commit'}`);
  process.exit(0);
}

const fixture = JSON.parse(readFileSync(target, 'utf8'));

// ── --shape ───────────────────────────────────────────────────────────────────────

if (wantsShape) {
  need(fixture.$schema === SCHEMA, `$schema must be ${SCHEMA}`);
  need(fixture.provenance?.producer === GENERATOR, `provenance.producer must be ${GENERATOR}`);
  need(typeof fixture.provenance?.producedBy === 'string' && fixture.provenance.producedBy.includes('@'),
    'provenance.producedBy must name the backend commit this was produced from');

  const backend = fixture.backend ?? {};
  need(backend.schema === BACKEND_SCHEMA, `backend.schema must be ${BACKEND_SCHEMA}`);
  need(backend.projectionVersion === PROJECTION_VERSION, `backend.projectionVersion must be ${PROJECTION_VERSION}`);
  need(backend.reviewContractVersion === REVIEW_CONTRACT_VERSION,
    `backend.reviewContractVersion must be ${REVIEW_CONTRACT_VERSION}`);

  // The refusal vocabulary is the backend's, whole. A short list here would mean this
  // repo had started curating it.
  need(Array.isArray(backend.refusalReasons) && backend.refusalReasons.length === REFUSAL_COUNT,
    `backend.refusalReasons must carry all ${REFUSAL_COUNT} entries`);
  for (const required of [
    'invalid_media_duration', 'invalid_capture_mode', 'capture_mode_not_enabled',
    'invalid_media_digest', 'invalid_media_size', 'invalid_media_type',
    'custody_binding_required', 'captured_at_not_observed', 'invalid_idempotency_key',
    'insufficient_evidence_not_confirmable', 'derived_field_supplied',
  ]) {
    need((backend.refusalReasons ?? []).includes(required), `backend.refusalReasons is missing ${required}`);
  }

  // Eight routes, all under the coach base, none addressing run review.
  const routes = backend.routes ?? {};
  const expected = [
    'attachDemonstration', 'createReview', 'readReview', 'addAnnotation',
    'attachEvidence', 'freezeSubmission', 'recordProposal', 'decideProposal',
  ];
  for (const name of expected) {
    const route = routes[name];
    need(typeof route === 'string', `backend.routes.${name} is missing`);
    if (typeof route !== 'string') continue;
    need(route.includes(COACH_BASE), `${name} escapes the coach base: ${route}`);
    // The disjointness the whole design rests on, restated at the fixture layer.
    need(!route.includes('/api/v2/review'), `${name} addresses run review`);
    need(!route.includes('/api/v2/agents/training'), `${name} addresses the WP1A training surface`);
  }
  for (const name of Object.keys(routes)) {
    need(expected.includes(name), `backend.routes.${name} is not a known coach route`);
  }

  // The subject union, byte-identical to what this repo's adapter types.
  need(backend.subjects?.runArtifact?.kind === 'run_artifact', 'the runArtifact subject must be present');
  need(backend.subjects?.trainingSource?.kind === 'training_source', 'the trainingSource subject must be present');
  need(backend.subjects?.trainingSource && !('runId' in backend.subjects.trainingSource),
    'a training_source subject must carry no runId');

  // Every review state the render tests bind against, including the two that must
  // RENDER differently (stale recording, decided) and the mint-deferred one.
  const reviews = backend.reviews ?? {};
  for (const key of ['openEmpty', 'marked', 'superseded', 'frozen', 'decided', 'linkedCandidate', 'staleRecording']) {
    need(reviews[key], `backend.reviews.${key} is missing`);
  }
  const decided = reviews.decided?.proposals ?? [];
  need(decided.some((p) => p.kind === 'insufficient_evidence'),
    'the fixture must carry an insufficient_evidence card');
  need(decided.some((p) => p.kind === 'decision'), 'the fixture must carry a well-evidenced decision card');
  // MINT DEFERRED IS THE POINT, not an incidental value. A confirmed teaching with no
  // canonical candidate is what F0 produces, and a fixture without it would let the
  // surface be written against a state that does not occur.
  need(decided.some((p) => p.canonicalLinkState === 'mint_deferred' && p.status === 'confirmed'),
    'the fixture must carry a CONFIRMED card whose canonical mint is DEFERRED');
  need(reviews.linkedCandidate?.proposals?.some((p) => p.canonicalLinkState === 'linked_existing'),
    'the fixture must carry a card linked to an existing canonical candidate');
  for (const key of Object.keys(reviews)) {
    const learning = reviews[key]?.learning;
    need(learning?.activatedCount === 0 && learning?.versionsCreated === 0,
      `backend.reviews.${key} must report zero activations — F0 activates nothing`);
    for (const proposal of reviews[key]?.proposals ?? []) {
      need(proposal.influenceState === 'inert', `backend.reviews.${key} carries a non-inert card`);
    }
  }
  need(reviews.staleRecording?.source?.integrity === 'stale',
    'the staleRecording variant must report a stale recording');

  // What the fixture deliberately does NOT contain, so this repo does not build a
  // control for a stage that cannot answer.
  for (const excluded of ['native_screen_capture', 'recording_upload', 'learning_activation']) {
    need((backend.outOfScope ?? []).includes(excluded), `backend.outOfScope must name ${excluded}`);
  }

  // No path, anywhere.
  const serialized = JSON.stringify(fixture);
  need(!serialized.includes('/Users/') && !serialized.includes('file://'),
    'no local filesystem path may appear in the fixture');
}

// ── --provenance ──────────────────────────────────────────────────────────────────

if (wantsProvenance) {
  const backend = findBackend();
  if (!backend) {
    // SKIP, LOUDLY AND HONESTLY. Not a pass: nothing was verified, and the message says
    // so and says what to set.
    console.log(
      `↷ SKIPPED ${RELATIVE} provenance — no backend checkout containing ${GENERATOR}.\n`
      + '   Nothing was verified. Re-run with IMPLEXA_BACKEND_DIR=/path/to/implexa-backend,\n'
      + '   or check implexa-backend out beside this repository.',
    );
    process.exit(0);
  }

  // 1. The BACKEND's own copy must be current with its producer. Comparing against a
  //    stale generated file would verify this repo against yesterday's contract.
  const check = spawnSync(process.execPath, [GENERATOR, '--check'], {
    cwd: backend, encoding: 'utf8',
  });
  if (check.status !== 0) {
    problems.push(
      `the backend's own ${GENERATED} is stale against ${GENERATOR} `
      + `(run \`npm run fixtures:agent-coach\` there). ${(check.stderr || check.stdout || '').trim()}`,
    );
  }

  // 2. This repo's vendored payload must be that file, byte-for-byte.
  const producedRaw = readFileSync(resolve(backend, GENERATED), 'utf8');
  const vendoredRaw = `${JSON.stringify(fixture.backend, null, 2)}\n`;
  if (vendoredRaw !== producedRaw) {
    problems.push(
      `${RELATIVE} → backend differs from ${backend}/${GENERATED}. `
      + 'Re-vendor with: npm run fixtures:training-review:vendor',
    );
  }

  // 3. The commit the fixture CLAIMS, reported when it has drifted.
  //
    // A WARNING, NOT A FAILURE — and the distinction is the whole point of step 2. The
  // CONTRACT CLAIM IS THE BYTES, and step 2 verified them against this checkout's
  // producer. A commit note that is behind while the payload is byte-identical is stale
  // METADATA, not a contract break: the backend branch advances for reasons that do not
  // touch this contract, and failing on every one of those would train a reader to
  // ignore a check that also reports real breaks. A payload that actually differs still
  // fails, above.
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: backend, encoding: 'utf8' });
  if (head.status === 0) {
    const claimed = String(fixture.provenance?.producedBy ?? '');
    const actual = `implexa-backend@${head.stdout.trim()}`;
    if (claimed !== actual) {
      console.warn(
        `⚠ provenance.producedBy names ${claimed || 'nothing'} but the checkout at ${backend} is now ${actual}.\n`
        + '   The payload is byte-identical, so the contract is verified; only the commit note is behind.\n'
        + '   Refresh it with: npm run fixtures:training-review:vendor',
      );
    }
  }
}

if (problems.length) {
  console.error(`✖ ${RELATIVE}`);
  for (const problem of problems) console.error(`   ${problem}`);
  process.exit(1);
}
console.log(
  wantsProvenance
    ? `✓ ${RELATIVE} — VERIFIED byte-for-byte against the backend producer`
    : `✓ ${RELATIVE} — shape checked against ${PROJECTION_VERSION} (provenance NOT claimed)`,
);
