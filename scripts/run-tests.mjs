#!/usr/bin/env node
/**
 * Dashboard test runner.
 *
 * WHY THIS EXISTS (2026-07-18): `node --test <paths>` treats its positional
 * arguments as GLOB PATTERNS. Next.js route directories are named `[id]` and
 * `[slug]`, and `[id]` is a valid glob character class — so those paths matched
 * NOTHING and their test files were silently skipped. The runner reported a
 * confident green ("26 pass, 0 fail") while never executing two entire files,
 * including the Continue-box affordance guard.
 *
 * Silent skipping is worse than a failure: a red test gets fixed, a skipped one
 * gets trusted. So this runner discovers files itself and hands node:test an
 * explicit list — no globbing anywhere — and then FAILS LOUDLY if the number of
 * files that actually reported differs from the number discovered.
 */

import { run } from 'node:test';
import { spec } from 'node:test/reporters';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
// `.claude` holds harness state, including stale git WORKTREES with full
// duplicate copies of this repo — discovering those runs every test twice (or
// worse, an OLD copy's tests against the old code, reported as failures of the
// current tree).
const SKIP = new Set(['node_modules', '.next', '.git', 'dist', '.vercel', '.claude']);

function findTests(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) findTests(full, acc);
    else if (/\.test\.(ts|js|mjs)$/.test(name)) acc.push(full);
  }
  return acc;
}

const files = findTests(ROOT).sort();
if (!files.length) {
  console.error('No test files found — that is itself a failure.');
  process.exit(1);
}

console.log(`Running ${files.length} test files:`);
for (const f of files) console.log(`  · ${relative(ROOT, f)}`);
console.log('');

const reported = new Set();
let failures = 0;

// A file with ZERO tests still emits one synthetic event whose `name` IS the file
// path (nesting 0) — so counting raw events would call an empty file "reported"
// and the skip guard would be vacuous. It was, on first write. Count only events
// that represent an actual test: name distinct from the file path.
const isRealTest = (e) => e.file && e.name && !files.some((f) => f.endsWith(e.name)) && e.name !== e.file;

const stream = run({ files, concurrency: true });
stream.on('test:fail', (e) => { if (isRealTest(e)) { failures++; reported.add(e.file); } });
stream.on('test:pass', (e) => { if (isRealTest(e)) reported.add(e.file); });
stream.compose(spec).pipe(process.stdout);

stream.on('end', () => {
  // The guard that would have caught the original bug: every discovered file
  // must have actually produced at least one result.
  const silent = files.filter((f) => !reported.has(f));
  if (silent.length) {
    console.error(`\n✖ ${silent.length} test file(s) produced NO results — silently skipped, not passing:`);
    for (const f of silent) console.error(`   ${relative(ROOT, f)}`);
    process.exit(1);
  }
  console.log(`\n${failures ? '✖' : '✓'} ${files.length} files reported, ${failures} failing`);
  process.exit(failures ? 1 : 0);
});
