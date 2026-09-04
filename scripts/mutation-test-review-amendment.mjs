import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { materializeTree, runSuites } from './mutation-harness-support.mjs';
const root = new URL('..', import.meta.url).pathname;
const resolver = 'lib/review-amendment-target.ts';
const component = 'app/(dashboard)/_components/run-actions.tsx';
const suites = ['lib/review-amendment-target.test.ts', 'app/(dashboard)/_components/run-actions-review-amendment.test.ts'];
const files = execFileSync('rg', ['--files', 'lib', 'app/(dashboard)/_components', 'app/(dashboard)/runs/[id]/page.tsx', 'tsconfig.json'],
  { cwd: root, encoding: 'utf8' }).trim().split('\n');
const variants = [
  ['generic retry still shown', component, 'if (reviewAmendment) {', 'if (false) {'],
  ['source probe on navigation', component, 'if (!needsInput || reviewAmendment) return;', 'if (!needsInput) return;'],
  ['foreign parent accepted', resolver, 'session.run_id !== parentRunId', 'false'],
  ['foreign owner accepted', resolver, 'session.user_id !== ownerId', 'false'],
  ['wrong run linked', resolver, '`/review/${session.run_id}', '`/review/${runId}'],
];
let killed = 0;
for (const variant of [null, ...variants]) {
  const dir = mkdtempSync(join(tmpdir(), 'review-amendment-mutant-'));
  try {
    materializeTree(root, files, dir);
    if (variant) {
      const [name, file, from, to] = variant;
      const source = readFileSync(join(root, file), 'utf8');
      assert.equal(source.split(from).length - 1, 1, `${name}: unique seam required`);
      writeFileSync(join(dir, file), source.replace(from, () => to));
    }
    const result = runSuites(root, dir, suites);
    assert.ok(!result.error && !result.signal, 'infrastructure failure is not a kill');
    if (!variant) assert.equal(result.status, 0, result.stdout + result.stderr);
    else {
      assert.notEqual(result.status, 0, `${variant[0]} survived`);
      assert.match(result.stdout + result.stderr, /AssertionError|ERR_ASSERTION/);
      console.log(`KILLED ${variant[0]}`); killed++;
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
console.log(`${killed}/${variants.length} killed; no survivors`);
