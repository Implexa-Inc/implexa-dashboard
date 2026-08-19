#!/usr/bin/env node
/**
 * The evidence-channel fixture is PRODUCED by the backend
 * (`scripts/generate-marketplace-evidence-channels-fixture.js`, migration 0205)
 * and vendored here so the Dashboard suites can run without a sibling checkout.
 *
 * A vendored copy silently drifts. This compares it byte-for-byte with the
 * backend's own generated file when that repository is available, so a contract
 * change there cannot be green here against a stale snapshot.
 *
 * Set IMPLEXA_BACKEND_REPO to the backend checkout. Without it the check
 * reports NOT VERIFIED and exits non-zero only under --require-backend, so it
 * is usable both in a full workspace and in a Dashboard-only CI job.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const RELATIVE = 'test-fixtures/generated/marketplace-evidence-channels.json';
const vendored = readFileSync(join(root, RELATIVE), 'utf8');
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

const backend = process.env.IMPLEXA_BACKEND_REPO;
if (!backend) {
  const required = process.argv.includes('--require-backend');
  process.stderr.write(`Vendored fixture shape is current, but provenance is NOT VERIFIED: set IMPLEXA_BACKEND_REPO to compare against the producing repository.\n`);
  process.exit(required ? 1 : 0);
}

const producer = join(backend, RELATIVE);
if (!existsSync(producer)) {
  process.stderr.write(`IMPLEXA_BACKEND_REPO is set but ${producer} does not exist.\n`);
  process.exit(1);
}
if (readFileSync(producer, 'utf8') !== vendored) {
  process.stderr.write('Vendored evidence-channel fixture differs from the backend-generated file.\nRegenerate in the backend, then copy it here.\n');
  process.exit(1);
}
process.stdout.write('Vendored evidence-channel fixture is byte-identical to the backend-generated file.\n');
