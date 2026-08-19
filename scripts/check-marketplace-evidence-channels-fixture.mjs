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
const RELATIVE = 'test-fixtures/generated/marketplace-evidence-channels.json';
// The backend commit that merged Work Package 1. Pinning the ref is what makes
// this a provenance check rather than a comparison against whatever happens to
// be checked out.
const DEFAULT_REF = 'd6ec6ace3ab1abb0086c9442535af4cd702eb1b2';

const wantsShape = process.argv.includes('--shape');
const wantsProvenance = process.argv.includes('--provenance');
if (wantsShape === wantsProvenance) {
  process.stderr.write('Choose exactly one of --shape or --provenance.\n');
  process.exit(2);
}

const vendored = readFileSync(join(root, RELATIVE), 'utf8');

if (wantsShape) {
  const parsed = JSON.parse(vendored);
  // These two are the contract the parser is written against. A fixture that
  // drifted off them would make every suite here green about the wrong shape.
  const expected = { schema: 'implexa.marketplace-evidence-channels.fixture.v1', contractVersion: 'marketplace-evidence-channels.v1' };
  for (const [key, value] of Object.entries(expected)) {
    if (parsed[key] !== value) {
      process.stderr.write(`Vendored fixture ${key} is ${JSON.stringify(parsed[key])}, expected ${JSON.stringify(value)}.\n`);
      process.exit(1);
    }
  }
  process.stdout.write('Vendored evidence-channel fixture matches the contract shape this repository parses. Provenance NOT checked — run --provenance for that.\n');
  process.exit(0);
}

const backend = process.env.IMPLEXA_BACKEND_REPO;
if (!backend || !existsSync(join(backend, '.git'))) {
  process.stderr.write(`PROVENANCE UNVERIFIABLE: set IMPLEXA_BACKEND_REPO to the backend checkout that produces ${RELATIVE}.\nA provenance check that passes without the producer would be a guarantee nobody made.\n`);
  process.exit(1);
}
const ref = process.env.IMPLEXA_BACKEND_REF || DEFAULT_REF;
// Read the producer file out of GIT, not the working tree: a dirty or
// mid-edit backend checkout must not be able to vouch for this copy.
const shown = spawnSync('git', ['-C', backend, 'show', `${ref}:${RELATIVE}`], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
if (shown.status !== 0) {
  process.stderr.write(`PROVENANCE UNVERIFIABLE: could not read ${RELATIVE} at ${ref} from ${backend}.\n${(shown.stderr || '').trim()}\n`);
  process.exit(1);
}
if (shown.stdout !== vendored) {
  process.stderr.write(`Vendored evidence-channel fixture differs from the backend-generated file at ${ref}.\nRegenerate in the backend, then copy it here.\n`);
  process.exit(1);
}
process.stdout.write(`Vendored evidence-channel fixture is byte-identical to the backend-generated file at ${ref}.\n`);
