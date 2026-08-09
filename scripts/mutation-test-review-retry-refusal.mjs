import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const helper = 'lib/run-request-refusal.ts';
const actions = 'app/(dashboard)/_components/run-actions.tsx';
const continueBox = 'app/(dashboard)/_components/run-continue-box.tsx';
const testFile = 'lib/run-request-refusal.test.ts';
const api = 'lib/api.ts';
const mutants = [
  ['still-running-collapsed-to-generic', helper, "  review_continuation_still_running:\n    'The previous revision is still running or shutting down. Wait a moment, then try again.',", "  review_continuation_still_running: 'fallback',"],
  ['unknown-live-state-collapsed-to-generic', helper, "  review_continuation_live_state_unknown:\n    'Implexa cannot safely verify that the previous revision process ended. This revision was not queued.',", "  review_continuation_live_state_unknown: 'fallback',"],
  ['reason-read-from-untrusted-message-instead-of-body', helper, "  const reason = typeof (body as { reason?: unknown }).reason === 'string'", "  const reason = false"],
  ['held-run-surface-restores-generic-catch', actions, "setErr(runRequestRefusalCopy(error, 'Could not queue the changes. Try again.'))", "setErr('Could not queue the changes. Try again.')"],
  ['universal-continue-surface-restores-raw-error', continueBox, "setMsg(runRequestRefusalCopy(e, 'Could not queue the continue. Try again.'))", "setMsg(e instanceof Error ? e.message : 'Could not queue the continue. Try again.')"],
];

function run(cwd) {
  return spawnSync(process.execPath, ['--test', testFile], { cwd, encoding: 'utf8' });
}

const baseline = run(root);
if (baseline.status !== 0) {
  process.stderr.write(`HARNESS BROKEN: unmutated baseline failed\n${baseline.stdout}\n${baseline.stderr}`);
  process.exit(1);
}
process.stdout.write('baseline green: review retry refusal\n');

let killed = 0;
for (const [name, file, from, to] of mutants) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `implexa-review-retry-copy-${name}-`));
  try {
    for (const item of [helper, actions, continueBox, testFile, api]) {
      const dest = path.join(dir, item);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(path.join(root, item), dest);
    }
    const target = path.join(dir, file);
    const source = fs.readFileSync(target, 'utf8');
    const first = source.indexOf(from);
    if (first < 0 || source.indexOf(from, first + 1) >= 0) throw new Error(`${name}: anchor must exist exactly once`);
    fs.writeFileSync(target, source.replace(from, to));
    const result = run(dir);
    if (result.status === 0) {
      process.stderr.write(`SURVIVED: ${name}\n`);
      process.exitCode = 1;
    } else {
      killed += 1;
      process.stdout.write(`killed: ${name}\n`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
process.stdout.write(`\n${killed}/${mutants.length} mutants killed\n`);
