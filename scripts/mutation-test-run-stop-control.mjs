import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { announceBaseline, materializeTree, runSuites } from './mutation-harness-support.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const component = 'app/(dashboard)/_components/run-stop-control.tsx';
const suite = 'app/(dashboard)/_components/run-stop-control.test.ts';
const files = [component, suite, 'app/(dashboard)/runs/[id]/page.tsx',
  'package.json', 'tsconfig.json', 'lib/test/render.ts',
  ...['api.ts', 'supabase.ts', 'next-navigation.ts', 'next-link.tsx'].map(f => `lib/test/stubs/${f}`)];
const mutations = [
  ['stalled action omitted', "runState === 'running' || runState === 'stalled'", "runState === 'running'"],
  ['terminal action exposed', "runState === 'running' || runState === 'stalled'", 'true'],
  ['persisted request ignored', '!!cancelRequestedAt || requested', 'requested'],
  ['JWT omitted', 'jwt: session.access_token,', ''],
  ['wrong run targeted', 'encodeURIComponent(runId)', "encodeURIComponent('00000000-0000-4000-8000-000000000001')"],
  ['unconfirmed reply accepted', "result?.ok !== true || (result.requested !== true && result.alreadyTerminal !== true)", 'false'],
  ['terminal race called pending', 'if (result.alreadyTerminal === true) setEnded(true);', 'if (result.alreadyTerminal === true) setRequested(true);'],
  ['double activation not serialized', '|| inFlight.current) return;', ') return;'],
];
announceBaseline({ label: 'run-stop-control', root, files,
  dir: mkdtempSync(join(tmpdir(), 'implexa-stop-baseline-')), suites: [suite] });
let killed = 0;
for (const [name, from, to] of mutations) {
  const dir = mkdtempSync(join(tmpdir(), 'implexa-stop-mutant-'));
  try {
    materializeTree(root, files, dir);
    const target = join(dir, component);
    const source = readFileSync(target, 'utf8');
    assert.equal(source.split(from).length - 1, 1, `ambiguous or absent seam: ${name}`);
    writeFileSync(target, source.replace(from, to));
    const result = runSuites(root, dir, [suite]);
    assert.notEqual(result.status, 0, `SURVIVED: ${name}`);
    assert.equal(result.signal, null, `not a behavioural failure: ${name}`);
    assert.match(result.stdout + result.stderr, /ERR_ASSERTION|AssertionError/, `no assertion failed: ${name}`);
    console.log(`KILLED: ${name}`);
    killed++;
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
console.log(`${killed}/${mutations.length} killed`);
