import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'app/(dashboard)/_components/agent-learnings-card.tsx');
const original = fs.readFileSync(source);
const digest = crypto.createHash('sha256').update(original).digest('hex');
function run(module = source) {
  return spawnSync(process.execPath, ['--test', 'test/learning-influence.render.test.mjs'], {
    cwd: root, encoding: 'utf8', env: { ...process.env, LEARNING_CARD_MODULE: module },
  });
}
const baseline = run();
assert.equal(baseline.status, 0, `baseline failed\n${baseline.stdout}\n${baseline.stderr}`);
const text = original.toString('utf8');
const mutants = [
  ['last supplied mislabeled', '· last supplied {rule.lastSuppliedRun', '· last applied {rule.lastSuppliedRun'],
  ['causation disclaimer removed', 'It does not prove this rule caused the outcome.', 'The agent learned this successfully.'],
  ['unsupported handling hidden', "run.handling.replaceAll('_', ' ')", "run.handling === 'unsupported_scope' ? 'applied' : run.handling.replaceAll('_', ' ')"],
  ['empty history fabricated', 'No frozen learning context has been recorded yet.', 'Suggested → approved → supplied to run unknown'],
];
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'implexa-trainer-card-mutants-'));
try {
  for (const [name, needle, replacement] of mutants) {
    assert.equal(text.split(needle).length - 1, 1, `${name}: anchor must be unique`);
    const copy = path.join(temp, `${name.replace(/[^a-z0-9]+/gi, '-')}.tsx`);
    fs.writeFileSync(copy, text.replace(needle, replacement));
    const result = run(copy);
    assert.notEqual(result.status, 0, `${name} SURVIVED\n${result.stdout}\n${result.stderr}`);
    console.log(`KILLED: ${name}`);
  }
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
assert.equal(crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex'), digest);
console.log(`Trainer compounding rendered mutations: PASS (${mutants.length}/${mutants.length} killed; source untouched)`);
