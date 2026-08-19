#!/usr/bin/env node
/**
 * The evidence-channel fixture is PRODUCED by the backend
 * (`scripts/generate-marketplace-evidence-channels-fixture.js`, migration 0205)
 * and vendored here so the Dashboard suites can run without a sibling checkout.
 *
 * TWO DIFFERENT CHECKS, AND THEY MUST NOT BE CONFUSED.
 *
 *   --shape       the vendored file is the contract this repo parses against.
 *                 Answerable alone, and never claims more than that.
 *   --provenance  the vendored file is byte-identical to what the backend
 *                 actually generated, read out of git at an exact ref so a
 *                 dirty backend checkout cannot vouch for it. REQUIRES the
 *                 producing repository and FAILS when it is absent.
 *
 * A provenance check that passes without the producer is not a provenance
 * check. The earlier version of this script printed "NOT VERIFIED" and exited
 * zero, so the canonical command reported a guarantee it had not made.
 *
 *   IMPLEXA_BACKEND_REPO  path to the backend checkout (required for provenance)
 *   IMPLEXA_BACKEND_REF   git ref to read the producer file from
 *                         (default: the merge commit that shipped the contract)
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
// Both generated artifacts: the valid fixture and the shared refusal corpus.
// A corpus that drifted from its producer would let this repository agree with
// a contract the server no longer enforces.
const ARTIFACTS = [
  { relative: 'test-fixtures/generated/marketplace-evidence-channels.json', schema: 'implexa.marketplace-evidence-channels.fixture.v1' },
  { relative: 'test-fixtures/generated/marketplace-evidence-channels-refusals.v1.json', schema: 'implexa.marketplace-evidence-channels-refusals.v1' },
];
// The backend commit that PRODUCED the vendored bytes. Pinning is what makes
// this a provenance check rather than a comparison against whatever happens to
// be checked out — and a stale pin fails loudly ("could not read"), where a
// drifting branch ref would pass quietly.
//
// This commit stays reachable through a true merge. If the producing PR is ever
// SQUASHED, update this to the squash commit; the check will say so by failing.
const DEFAULT_REF = '371f086d3f82133801116a65ffb73040750d51bb';

const wantsShape = process.argv.includes('--shape');
const wantsProvenance = process.argv.includes('--provenance');
if (wantsShape === wantsProvenance) {
  process.stderr.write('Choose exactly one of --shape or --provenance.\n');
  process.exit(2);
}

if (wantsShape) {
  for (const { relative, schema } of ARTIFACTS) {
    const parsed = JSON.parse(readFileSync(join(root, relative), 'utf8'));
    // These two are the contract this repository is written against. A file
    // that drifted off them would make every suite here green about the wrong
    // shape.
    for (const [key, value] of Object.entries({ schema, contractVersion: 'marketplace-evidence-channels.v1' })) {
      if (parsed[key] !== value) {
        process.stderr.write(`${relative}: ${key} is ${JSON.stringify(parsed[key])}, expected ${JSON.stringify(value)}.\n`);
        process.exit(1);
      }
    }
  }
  process.stdout.write(`Vendored evidence-channel artifacts (${ARTIFACTS.length}) match the contract shape this repository parses. Provenance NOT checked — run --provenance for that.\n`);
  process.exit(0);
}

const backend = process.env.IMPLEXA_BACKEND_REPO;
if (!backend || !existsSync(join(backend, '.git'))) {
  process.stderr.write('PROVENANCE UNVERIFIABLE: set IMPLEXA_BACKEND_REPO to the backend checkout that produces these files.\nA provenance check that passes without the producer would be a guarantee nobody made.\n');
  process.exit(1);
}
const ref = process.env.IMPLEXA_BACKEND_REF || DEFAULT_REF;
for (const { relative } of ARTIFACTS) {
  // Read the producer file out of GIT, not the working tree: a dirty or
  // mid-edit backend checkout must not be able to vouch for this copy.
  const shown = spawnSync('git', ['-C', backend, 'show', `${ref}:${relative}`], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (shown.status !== 0) {
    process.stderr.write(`PROVENANCE UNVERIFIABLE: could not read ${relative} at ${ref} from ${backend}.\n${(shown.stderr || '').trim()}\n`);
    process.exit(1);
  }
  if (shown.stdout !== readFileSync(join(root, relative), 'utf8')) {
    process.stderr.write(`${relative} differs from the backend-generated file at ${ref}.\nRegenerate in the backend, then copy it here.\n`);
    process.exit(1);
  }
}
process.stdout.write(`Vendored evidence-channel artifacts (${ARTIFACTS.length}) are byte-identical to the backend-generated files at ${ref}.\n`);
