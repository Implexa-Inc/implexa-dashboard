// node --test lib/mutation-harness-contract.test.ts
//
// THE HARNESS ITSELF, UNDER TEST.
//
// On 2026-08-08 both mutation harnesses reported a perfect score from a tree that
// could not import React. They copied files into $TMPDIR, where there is no
// `node_modules`, so every rendered test threw ERR_MODULE_NOT_FOUND on import; the run
// exited non-zero; and non-zero was the harness's definition of KILLED. 71/71 and 14/14
// were counting crashes. No rendered assertion had ever executed.
//
// Two mechanisms fix that, and both are load-bearing enough to test directly:
//   · two-rooted resolution — the mutant tree wins, the real repository backfills
//     anything the harness did not copy, and a genuine typo still explodes;
//   · a mandatory green baseline — the unmutated suite must pass BEFORE any mutant is
//     judged, and a broken tree must abort as HARNESS BROKEN rather than score kills.
//
// The last one is the whole point. A harness that cannot run its own suite has no
// standing to call anything killed, and the failure mode it produces is not a red
// test — it is a perfect green score that means nothing.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { materializeTree, requireGreenBaseline } from '../scripts/mutation-harness-support.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROBE = '@/scripts/stubs/loader-probe-fixture';

/** A mutant tree with the loader in it, node_modules exposed, and a driver that
 *  imports `specifier` through the loader with both roots passed EXPLICITLY. */
function resolveThroughLoader(specifier: string, mutantFile?: { path: string; body: string }) {
  const dir = mkdtempSync(join(tmpdir(), 'loader-contract-'));
  try {
    materializeTree(ROOT, ['scripts/dom-test-loader.mjs'], dir);
    if (mutantFile) {
      const target = join(dir, mutantFile.path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, mutantFile.body);
    }
    writeFileSync(join(dir, 'driver.mjs'), `
import { register } from 'node:module';
register(new URL('./scripts/dom-test-loader.mjs', import.meta.url), {
  data: { mutantRoot: ${JSON.stringify(dir)}, sourceRoot: ${JSON.stringify(ROOT)} },
});
const mod = await import(${JSON.stringify(specifier)});
console.log('ORIGIN=' + mod.ORIGIN);
`);
    // cwd is deliberately NOT the mutant tree: the roots must come from the explicit
    // `data` above, never from where the process happened to be started.
    return spawnSync(process.execPath, [join(dir, 'driver.mjs')], {
      cwd: tmpdir(), encoding: 'utf8', env: process.env,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('a copied (mutated) file beats the real repository copy', () => {
  const r = resolveThroughLoader(PROBE, {
    path: 'scripts/stubs/loader-probe-fixture.ts',
    body: "export const ORIGIN = 'MUTANT';\n",
  });
  assert.equal(r.status, 0, `driver failed: ${r.stderr}`);
  assert.match(r.stdout, /ORIGIN=MUTANT/,
    'the pristine repository file shadowed the mutant — every mutation would be a no-op');
});

test('an uncopied @/ dependency is backfilled from the real repository', () => {
  const r = resolveThroughLoader(PROBE);
  assert.equal(r.status, 0, `driver failed: ${r.stderr}`);
  assert.match(r.stdout, /ORIGIN=SOURCE/,
    'an uncopied dependency did not resolve — this is the ERR_MODULE_NOT_FOUND that scored fake kills');
});

test('a dependency that exists in NEITHER root still fails loudly', () => {
  const r = resolveThroughLoader('@/lib/there-is-no-such-module-9f3a2c');
  assert.notEqual(r.status, 0, 'a missing module resolved to something');
  assert.match(r.stderr, /ERR_MODULE_NOT_FOUND|Cannot find/,
    'a missing module failed for some reason other than being missing');
});

/** A throwaway "repository" holding one suite, with node_modules exposed like a real one. */
function fakeRepo(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'loader-contract-repo-'));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(root, name), body);
  symlinkSync(join(ROOT, 'node_modules'), join(root, 'node_modules'), 'junction');
  return root;
}

test('an unmutated suite that cannot even IMPORT is HARNESS BROKEN, never a kill', () => {
  // The exact 2026-08-08 shape: the failure is a missing package at import time, which
  // is indistinguishable from a killed mutant if you only look at the exit code.
  const root = fakeRepo({
    'broken.test.mjs': "import 'no-such-package-here-4b7d';\nimport test from 'node:test';\ntest('never runs', () => {});\n",
  });
  const dir = mkdtempSync(join(tmpdir(), 'loader-contract-broken-'));
  try {
    assert.throws(
      () => requireGreenBaseline({
        label: 'probe', quiet: true, root, files: ['broken.test.mjs'], dir, suites: ['broken.test.mjs'],
      }),
      /HARNESS BROKEN/,
      'a suite that cannot import was accepted as a valid baseline',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test('a failing (but importable) unmutated suite is also HARNESS BROKEN', () => {
  const root = fakeRepo({
    'red.test.mjs': "import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('red', () => assert.equal(1, 2));\n",
  });
  const dir = mkdtempSync(join(tmpdir(), 'loader-contract-red-'));
  try {
    assert.throws(
      () => requireGreenBaseline({
        label: 'probe', quiet: true, root, files: ['red.test.mjs'], dir, suites: ['red.test.mjs'],
      }),
      /HARNESS BROKEN/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test('a green unmutated suite passes the baseline and reports its counts', () => {
  const root = fakeRepo({
    'green.test.mjs': "import test from 'node:test';\ntest('a', () => {});\ntest('b', () => {});\n",
  });
  const dir = mkdtempSync(join(tmpdir(), 'loader-contract-green-'));
  try {
    const counts = requireGreenBaseline({
      label: 'probe', quiet: true, root, files: ['green.test.mjs'], dir, suites: ['green.test.mjs'],
    });
    assert.equal(counts.tests, 2);
    assert.equal(counts.pass, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});
