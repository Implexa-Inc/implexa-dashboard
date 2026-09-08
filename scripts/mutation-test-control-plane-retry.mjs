import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { announceBaseline, materializeTree, runSuites } from './mutation-harness-support.mjs';

// "Retry safely — no work started previously": mutants that would let the UI
// act without server-proven eligibility, drop or forge a pin, claim a queue the
// server did not confirm, merge the action into Run again, or send authority.
const root = fileURLToPath(new URL('..', import.meta.url));
const component = 'app/(dashboard)/_components/control-plane-retry.tsx';
const lib = 'lib/control-plane-retry.ts';
const suites = ['app/(dashboard)/_components/control-plane-retry.test.ts', 'lib/control-plane-retry.test.ts',
  'app/(dashboard)/runs/[id]/control-plane-retry-page.test.ts'];
const files = [component, lib, ...suites, 'app/(dashboard)/runs/[id]/page.tsx',
  'package.json', 'tsconfig.json', 'lib/test/render.ts',
  ...['api.ts', 'supabase.ts', 'next-navigation.ts', 'next-link.tsx'].map(f => `lib/test/stubs/${f}`)];
const mutations = [
  [lib, 'eligible without ok is a grant', "if (e.ok === true && e.eligible === true) {", "if (e.eligible === true) {"],
  [lib, 'missing digest pin still acts', "if (!Number.isSafeInteger(epoch) || epoch < 0 || !/^[0-9a-f]{64}$/.test(digest)) {", "if (!Number.isSafeInteger(epoch) || epoch < 0) {"],
  [lib, 'evidence refusal shown as available', "if (reason && DISABLED_COPY[reason]) return { state: 'disabled', reason, explanation: DISABLED_COPY[reason] };", "if (reason && DISABLED_COPY[reason]) return { state: 'available', pins: { expectedDrainRetryEpoch: 0, expectedWorkflowVersionId: null, expectedInputBindingsDigest: 'a'.repeat(64) }, failureCode: reason };"],
  [lib, 'unconfirmed reply accepted', "return r.ok === true && r.requeued === true;", "return r.ok === true || r.requeued === true;"],
  [lib, 'distinction copy collapsed into Run again', "export const RUN_AGAIN_DISTINCTION = 'Run again: creates a new request';", "export const RUN_AGAIN_DISTINCTION = 'Run again';"],
  [component, 'generation pin dropped from the POST', "expectedDrainRetryEpoch: presentation.pins.expectedDrainRetryEpoch,", ""],
  [component, 'input digest pin dropped from the POST', "expectedInputBindingsDigest: presentation.pins.expectedInputBindingsDigest,", ""],
  [component, 'queue claimed without confirmation', "if (!retryConfirmed(result)) throw new Error('unconfirmed');", "void result;"],
  [component, 'eligibility not re-read after a refusal', "await readEligibility(() => true);", ""],
  [component, 'double activation not serialized', "if (busy || inFlight.current || presentation.state !== 'available') return;", "if (presentation.state !== 'available') return;"],
  [component, 'JWT omitted from the POST', "jwt: session?.access_token, method: 'POST',", "method: 'POST',"],
  [component, 'confirmation step skipped', "onClick={() => setConfirming(true)}", "onClick={() => void retry()}"],
  [component, 'disabled explanation hidden', "{presentation.state === 'disabled' && (", "{false && ("],
];
announceBaseline({ label: 'control-plane-retry', root, files,
  dir: mkdtempSync(join(tmpdir(), 'implexa-cpr-baseline-')), suites });
let killed = 0;
for (const [file, name, from, to] of mutations) {
  const dir = mkdtempSync(join(tmpdir(), 'implexa-cpr-mutant-'));
  try {
    materializeTree(root, files, dir);
    const target = join(dir, file);
    const source = readFileSync(target, 'utf8');
    assert.equal(source.split(from).length - 1, 1, `ambiguous or absent seam: ${name}`);
    writeFileSync(target, source.replace(from, to));
    const result = runSuites(root, dir, suites);
    assert.notEqual(result.status, 0, `SURVIVED: ${name}`);
    assert.equal(result.signal, null, `not a behavioural failure: ${name}`);
    assert.match(result.stdout + result.stderr, /ERR_ASSERTION|AssertionError/, `no assertion failed: ${name}`);
    console.log(`KILLED: ${name}`);
    killed++;
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
console.log(`${killed}/${mutations.length} killed`);
