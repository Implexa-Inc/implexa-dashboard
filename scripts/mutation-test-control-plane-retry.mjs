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
  [lib, 'missing grant still acts', "if (typeof e.grantId !== 'string' || !UUID.test(e.grantId)) return { state: 'hidden' };", ""],
  [lib, 'missing frozen version still acts', "if (typeof e.workflowVersionId !== 'string' || !UUID.test(e.workflowVersionId)) return { state: 'hidden' };", ""],
  [lib, 'work-may-have-occurred refusal shown as available', "if (reason && WORK_MAY_HAVE_OCCURRED[reason]) return { state: 'disabled', reason, explanation: WORK_MAY_HAVE_OCCURRED[reason], workMayHaveOccurred: true };", "if (reason && WORK_MAY_HAVE_OCCURRED[reason]) return { state: 'available', grantId: '5b1f6c2e-2c1b-4b1e-9a3e-1f1f1f1f1f1f', workflowVersionId: 'c3350000-0000-4000-8000-000000000010', failureCode: reason };"],
  [lib, 'work-may-have-occurred refusal not flagged', "return { state: 'disabled', reason, explanation: WORK_MAY_HAVE_OCCURRED[reason], workMayHaveOccurred: true };", "return { state: 'disabled', reason, explanation: WORK_MAY_HAVE_OCCURRED[reason], workMayHaveOccurred: false };"],
  [lib, 'claim allowed on disabled states', "return p.state === 'available' || p.state === 'queued';", "return p.state !== 'hidden';"],
  [lib, 'unknown reason shown as disabled instead of hidden', "return { state: 'hidden' };\n}\n\n// Whether", "return { state: 'disabled', reason: reason || 'unknown', explanation: 'Unavailable.', workMayHaveOccurred: false };\n}\n\n// Whether"],
  [lib, 'unconfirmed reply accepted', "return r.ok === true && r.requeued === true;", "return r.ok === true || r.requeued === true;"],
  [lib, 'distinction copy collapsed into Run again', "export const RUN_AGAIN_DISTINCTION = 'Run again: creates a new request';", "export const RUN_AGAIN_DISTINCTION = 'Run again';"],
  [component, 'grant dropped from the POST', "body: { grantId: presentation.grantId },", "body: {},"],
  [component, 'claim rendered unconditionally', "{mayClaimNoWork(presentation) && (", "{true && ("],
  [component, 'queue claimed without confirmation', "if (!retryConfirmed(result)) throw new Error('unconfirmed');", "void result;"],
  [component, 'eligibility not re-read after a refusal', "await readEligibility(() => true);", ""],
  [component, 'double activation not serialized', "if (busy || inFlight.current || presentation.state !== 'available') return;", "if (presentation.state !== 'available') return;"],
  [component, 'JWT omitted from the POST', "jwt: session?.access_token, method: 'POST',", "method: 'POST',"],
  [component, 'confirmation step skipped', "onClick={() => setConfirming(true)}", "onClick={() => void retry()}"],
  [component, 'disabled explanation hidden', "{presentation.state === 'disabled' && (", "{false && ("],
  [component, 'work-may-have-occurred wording dropped', "{presentation.workMayHaveOccurred ? 'Retry safely is unavailable because work or an external action may have occurred: ' : 'Retry safely is unavailable: '}", "{'Retry safely is unavailable: '}"],
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
