/**
 * Shared plumbing for the mutation harnesses.
 *
 * THE BUG THIS EXISTS TO PREVENT (2026-08-08). A harness scores a mutant KILLED when
 * the copied suite exits non-zero. That is only meaningful if the SAME suite exits
 * ZERO when nothing is mutated — and for every rendered (jsdom) test it did not. The
 * throwaway tree has no `node_modules`, so `import { JSDOM } from 'jsdom'` threw
 * ERR_MODULE_NOT_FOUND, the run exited non-zero, and the harness reported a kill it
 * had not earned. Both harnesses were green on an infrastructure crash: 71/71 and
 * 14/14 were counting import errors, not regressions.
 *
 * So a harness now has to prove its own tree works before it may judge anything:
 *   materializeTree()      copy the chosen files, expose node_modules (symlink, never
 *                          a copy — it is ~hundreds of MB and changes nothing).
 *   requireGreenBaseline() run the complete suite UNMUTATED. Non-zero here is
 *                          HARNESS BROKEN and aborts the run. It is never a kill.
 *   runSuites()            run the suite with both roots passed explicitly.
 *
 * The distinction that matters: BROKEN means "this harness cannot tell you anything",
 * SURVIVED means "your test suite cannot tell you anything". Collapsing the first into
 * the second is what produced a perfect score from a tree that never imported React.
 */

import { cpSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

/**
 * Copy `files` into `dir` and expose the repo's node_modules there.
 *
 * The symlink is what lets a rendered test resolve `jsdom`, `react`, `react-dom` and
 * `esbuild` from a tree under $TMPDIR, where Node's upward node_modules walk finds
 * nothing. Copying instead of linking would be correct and unusably slow.
 */
export function materializeTree(root, files, dir) {
  for (const file of files) {
    const target = join(dir, file);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(join(root, file), target);
  }
  symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'), 'junction');
}

/**
 * Run the copied suite. Both roots are handed to the loader EXPLICITLY: the mutant
 * tree (where a copied/mutated file must win) and the real repository (read-only, for
 * dependencies the harness did not copy). Neither is left to cwd inference.
 */
export function runSuites(root, dir, suites) {
  const env = { ...process.env, IMPLEXA_MUTANT_ROOT: dir, IMPLEXA_SOURCE_ROOT: root };
  // node:test sets NODE_TEST_CONTEXT for its children. Inheriting it flips the spawned
  // runner into the internal serialized reporter — no `# tests` summary, and results
  // routed to a parent that isn't listening — so a red suite looks silent and green.
  // The harnesses run outside node:test, but `lib/mutation-harness-contract.test.ts`
  // does not, and it is the one test that must be able to observe a BROKEN baseline.
  delete env.NODE_TEST_CONTEXT;
  // A HANG IS NOT A RESULT. node:test defaults to no per-test timeout, so a mutation
  // that leaves a live timer or an unsettled promise (a rendered component whose poll
  // interval never got cleared) blocks forever, and the harness sits there looking
  // busy rather than reporting anything. Bounded, so a hang becomes a failed test.
  return spawnSync(
    process.execPath,
    ['--test', '--test-timeout=60000', ...suites.map((s) => join(dir, s))],
    { cwd: dir, encoding: 'utf8', env, timeout: 180_000, killSignal: 'SIGKILL' },
  );
}

/**
 * Prove the tree is sound before a single mutant is applied.
 *
 * Throws HARNESS BROKEN on a non-zero unmutated run — a missing package, an uncopied
 * import, a stub that no longer matches its module. Aborting is the point: a harness
 * that cannot run its own suite clean has no standing to call anything killed.
 */
export function requireGreenBaseline({ label, root, files, dir, suites, quiet = false }) {
  materializeTree(root, files, dir);
  const result = runSuites(root, dir, suites);
  if (result.status !== 0) {
    // `quiet` is for the contract test, which BREAKS a baseline on purpose: echoing a
    // deliberate failure into `npm test` output reads like a real one.
    if (!quiet) {
      process.stderr.write(result.stdout.slice(-6000));
      process.stderr.write(result.stderr.slice(-3000));
    }
    throw new Error(
      `HARNESS BROKEN [${label}]: the UNMUTATED suite exits ${result.status}. `
      + 'Nothing below this line would have been a real kill — every mutant would '
      + 'have "died" of the same failure. Fix the tree, then re-run.',
    );
  }
  const tests = result.stdout.match(/^# tests (\d+)$/m) || result.stdout.match(/^ℹ tests (\d+)$/m);
  const pass = result.stdout.match(/^# pass (\d+)$/m) || result.stdout.match(/^ℹ pass (\d+)$/m);
  return { tests: tests ? Number(tests[1]) : null, pass: pass ? Number(pass[1]) : null };
}

/** Baseline in its own throwaway tree, reported, then removed. */
export function announceBaseline({ label, root, files, dir, suites }) {
  try {
    const { tests, pass } = requireGreenBaseline({ label, root, files, dir, suites });
    console.log(`BASELINE [${label}] unmutated suite green — ${pass}/${tests} tests pass.\n`);
    return { tests, pass };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
