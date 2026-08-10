#!/usr/bin/env node
/**
 * Run an explicit test-file set and make the runner—not jsdom, React timers, or
 * esbuild helpers—the authority on process completion.
 *
 * The explicit runner makes file accounting part of the contract: every
 * requested file must report a result. That prevents an import error or silently
 * omitted rendered suite from being mistaken for a green mutation baseline.
 */
import { run } from 'node:test';
import { spec } from 'node:test/reporters';
import { resolve } from 'node:path';

const files = process.argv.slice(2).map((file) => resolve(file));
if (!files.length) {
  console.error('No explicit test files supplied.');
  process.exit(1);
}

const reported = new Set();
let failures = 0;
const stream = run({ files, concurrency: false, isolation: 'none' });
stream.on('test:pass', (event) => { if (event.file) reported.add(resolve(event.file)); });
stream.on('test:fail', (event) => {
  if (event.file) reported.add(resolve(event.file));
  failures += 1;
});
stream.compose(spec).pipe(process.stdout);
stream.on('end', () => {
  const silent = files.filter((file) => !reported.has(file));
  if (silent.length) {
    console.error(`HARNESS BROKEN: ${silent.length} selected test file(s) produced no result`);
    for (const file of silent) console.error(file);
  }
  process.exit(failures || silent.length ? 1 : 0);
});
