#!/usr/bin/env node
/**
 * The training-review fixture is the CONTRACT SEAM with the parallel backend F0.
 *
 * TWO DIFFERENT CHECKS, AND THEY MUST NOT BE CONFUSED — the same split
 * `check-marketplace-evidence-channels-fixture.mjs` established:
 *
 *   --shape       the vendored file is the contract this repo parses against.
 *                 Answerable alone, and never claims more than that.
 *   --provenance  the vendored file is what the backend actually produced.
 *                 REQUIRES the producing repository.
 *
 * TODAY --provenance ALWAYS FAILS, and that is the correct result. The backend F0 is
 * being built in parallel and no producer exists yet, so `provenance.producedBy` in the
 * fixture is null. A provenance check that passed without a producer would be a claim
 * this repository is not entitled to make; the earlier generation of this script
 * elsewhere printed "NOT VERIFIED" and exited zero, and the canonical command therefore
 * reported a guarantee it had not made.
 *
 * When the backend lands: regenerate the fixture from its emitters, set
 * `provenance.producedBy` to the exact commit, and this check starts meaning something.
 */

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const RELATIVE = 'test-fixtures/training-review-f0.v1.json';
const SCHEMA = 'implexa.agent-training-review.fixture.v1';
const CONTRACT_VERSION = 'agent-training-review.v1';
const TRAINING_BASE = '/api/v2/agents/training';

const wantsShape = process.argv.includes('--shape');
const wantsProvenance = process.argv.includes('--provenance');
if (!wantsShape && !wantsProvenance) {
  console.error('Usage: check-training-review-fixture.mjs [--shape] [--provenance]');
  process.exit(2);
}

const fixture = JSON.parse(readFileSync(join(root, RELATIVE), 'utf8'));
const problems = [];
const need = (condition, message) => { if (!condition) problems.push(message); };

if (wantsShape) {
  need(fixture.$schema === SCHEMA, `$schema must be ${SCHEMA}`);
  need(fixture.contractVersion === CONTRACT_VERSION, `contractVersion must be ${CONTRACT_VERSION}`);
  need(fixture.upstream?.base === TRAINING_BASE, `upstream.base must be ${TRAINING_BASE}`);

  const actions = fixture.upstream?.actions ?? {};
  const expected = [
    'ensure_training_session', 'create_training_annotation', 'amend_training_annotation',
    'discard_training_annotation', 'attach_training_evidence', 'submit_training_annotations',
    'confirm_training_decision', 'read_training_projection',
  ];
  for (const action of expected) {
    const entry = actions[action];
    need(entry, `upstream.actions.${action} is missing`);
    if (!entry) continue;
    need(typeof entry.path === 'string' && entry.path.startsWith(TRAINING_BASE),
      `${action} path escapes the training base: ${entry.path}`);
    // The disjointness the whole design rests on, restated at the fixture layer.
    need(!String(entry.path).includes('/api/v2/review'), `${action} addresses run review`);
  }
  for (const action of Object.keys(actions)) {
    need(expected.includes(action), `upstream.actions.${action} is not a known training action`);
  }
  need(actions.confirm_training_decision?.body?.activate === false,
    'confirm_training_decision must pin activate:false — F0 activates nothing');

  // Every projection variant the tests bind against must exist, including the two
  // that are not reachable in F0 but must still RENDER differently (activated) and
  // the adversarial one (a leaked path).
  for (const key of ['projection', 'projectionAllUnknown', 'projectionActivated',
    'projectionUnreadableState', 'projectionRefused', 'projectionPathLeak']) {
    need(fixture[key], `fixture.${key} is missing`);
  }
  need(fixture.projection?.projection?.authorityState?.activated?.status === 'no',
    'the canonical F0 projection must show activated:no');
  need(fixture.projectionActivated?.projection?.authorityState?.activated?.status === 'yes',
    'the activated variant must show activated:yes');
  need((fixture.projection?.projection?.decisions ?? []).some((d) => d.insufficientEvidence === true),
    'the fixture must carry an insufficient_evidence proposal');
  need((fixture.projection?.projection?.decisions ?? []).some((d) => d.insufficientEvidence === false),
    'the fixture must carry a well-evidenced proposal');

  // No path, anywhere, EXCEPT the deliberate adversarial leak the parser must drop.
  const withoutLeak = { ...fixture, projectionPathLeak: null };
  const serialized = JSON.stringify(withoutLeak);
  need(!serialized.includes('/Users/') && !serialized.includes('file://'),
    'no local filesystem path may appear outside the adversarial projectionPathLeak case');
}

if (wantsProvenance) {
  const producedBy = fixture.provenance?.producedBy ?? null;
  if (!producedBy) {
    problems.push(
      'NOT PRODUCED: provenance.producedBy is null. The backend F0 producer does not exist yet, '
      + 'so this fixture is an ASSUMPTION and provenance cannot be verified. This failure is '
      + 'correct until the backend lands and the fixture is regenerated from its emitters.',
    );
  } else {
    problems.push(
      `provenance.producedBy is set to ${producedBy} but this script has no regeneration path yet. `
      + 'Add the producer invocation before claiming provenance.',
    );
  }
}

if (problems.length) {
  console.error(`✖ ${RELATIVE}`);
  for (const problem of problems) console.error(`   ${problem}`);
  process.exit(1);
}
console.log(`✓ ${RELATIVE} — shape checked against ${CONTRACT_VERSION} (provenance NOT claimed)`);
