#!/usr/bin/env node
// Run an EXPLICIT list of test files through node:test's programmatic runner.
//
// `node --test <path>` treats `[id]` and `(dashboard)` segments as glob syntax
// and silently discovers ZERO tests for them — a green exit over nothing. This
// runner hands the files over verbatim (the same way scripts/run-tests.mjs
// does for the whole tree) and fails when any listed file produced no result.
import { run } from 'node:test';
import { spec } from 'node:test/reporters';
import { resolve } from 'node:path';
import { realpathSync } from 'node:fs';

// realpath on both sides: macOS reports /var/folders paths as /private/var.
const canon = (f) => { try { return realpathSync(resolve(f)); } catch { return resolve(f); } };
const files = process.argv.slice(2).map(canon);
if (!files.length) { console.error('usage: run-listed-tests.mjs <test files…>'); process.exit(2); }
const seen = new Set();
let failed = 0;
const stream = run({ files, concurrency: true, timeout: 60_000 });
stream.on('test:fail', () => { failed += 1; });
stream.on('test:pass', (event) => { if (event.file) seen.add(canon(event.file)); });
stream.on('test:fail', (event) => { if (event.file) seen.add(canon(event.file)); });
stream.compose(spec).pipe(process.stdout);
stream.once('end', () => {
  const silent = files.filter((f) => !seen.has(f));
  if (silent.length) { console.error(`no test results from: ${silent.join(', ')}`); process.exitCode = 1; }
  if (failed) process.exitCode = 1;
});
