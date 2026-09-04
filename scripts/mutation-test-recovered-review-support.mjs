import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { materializeTree, runSuites } from './mutation-harness-support.mjs';

const root = new URL('..', import.meta.url).pathname;
const files = ['lib/review.ts', 'lib/review.test.ts', 'lib/run-competence-proof.ts'];
const source = readFileSync(join(root, 'lib/review.ts'), 'utf8');
const variants = [
  ['source role rejected', "artifact?.role === 'source'", "artifact?.role === 'obsolete_source'"],
  ['validation ignored', "artifact.status === 'validated'", 'true'],
  ['validated hash ignored', 'if (!isDigest(v.sha256)) return false;', 'if (false) return false;'],
  ['target relabel accepted', "? artifact?.role === 'review_input'", "? ['review_input', 'source'].includes(String(artifact?.role))"],
  ['same-run identity ignored', "if (v.runId !== runId) return false;\n  if (typeof v.relativePath", "if (false) return false;\n  if (typeof v.relativePath"],
];
const survivors = [];
for (const variant of [null, ...variants]) {
  const dir = mkdtempSync(join(tmpdir(), 'review-support-mutant-'));
  try {
    materializeTree(root, files, dir);
    if (variant) {
      const [name, from, to] = variant;
      assert.equal(source.split(from).length - 1, 1, `${name}: unique seam required`);
      writeFileSync(join(dir, 'lib/review.ts'), source.replace(from, () => to));
    }
    const result = runSuites(root, dir, ['lib/review.test.ts']);
    assert.ok(!result.error && !result.signal, 'infrastructure failure is not a kill');
    if (!variant) assert.equal(result.status, 0, result.stdout + result.stderr);
    else if (result.status === 0 || !/AssertionError/.test(result.stdout + result.stderr)) survivors.push(variant[0]);
    else console.log(`KILLED ${variant[0]}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
console.log(`${variants.length-survivors.length}/${variants.length} killed; survivors: ${survivors.join(', ') || 'none'}`);
if (survivors.length) process.exitCode = 1;
