import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const component = 'app/(dashboard)/_components/running-agents.tsx';
const suite = 'app/(dashboard)/_components/running-agents-failure-cause.test.ts';
const mutants = [
  ['selecting collapses to queued', "case 'selecting_executor': return 'selecting';", "case 'selecting_executor': return 'queued';"],
  ['switching collapses to running', "case 'switching_executor': return 'switching';", "case 'switching_executor': return 'running';"],
  ['resuming collapses to running', "case 'resuming': return 'resuming';", "case 'resuming': return 'running';"],
  ['fallback blocked collapses to running', "case 'fallback_blocked': return 'fallback_blocked';", "case 'fallback_blocked': return 'running';"],
  ['selecting loses its pre-live Cancel action', "['queued', 'selecting', 'picked_up', 'starting', 'switching', 'resuming']", "['queued', 'picked_up', 'starting', 'switching', 'resuming']"],
  ['running loses its Stop action', "{c.status === 'running' && (c.runId || c.requestId)", "{false && c.status === 'running' && (c.runId || c.requestId)"],
];

function run(cwd) {
  return spawnSync(process.execPath, ['--test', '--test-timeout=60000', suite], {
    cwd,
    encoding: 'utf8',
    timeout: 180_000,
    killSignal: 'SIGKILL',
    env: {
      ...process.env,
      IMPLEXA_MUTANT_ROOT: cwd,
      IMPLEXA_SOURCE_ROOT: root,
      NODE_PATH: path.join(root, 'node_modules'),
    },
  });
}

const baseline = run(root);
if (baseline.status !== 0) {
  process.stderr.write(`HARNESS BROKEN: unmutated fallback renderer failed\n${baseline.stdout}\n${baseline.stderr}`);
  process.exit(1);
}
process.stdout.write('baseline green: rendered executor fallback lifecycle\n');

let killed = 0;
for (const [name, from, to] of mutants) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'implexa-executor-fallback-ui-'));
  try {
    fs.cpSync(root, dir, {
      recursive: true,
      filter: (src) => !['node_modules', '.git', '.next', 'dist', '.vercel'].includes(path.basename(src)),
    });
    fs.symlinkSync(path.join(root, 'node_modules'), path.join(dir, 'node_modules'));
    const target = path.join(dir, component);
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
  } catch (error) {
    process.stderr.write(`HARNESS ERROR: ${name}: ${error.message}\n`);
    process.exitCode = 1;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

process.stdout.write(`${killed}/${mutants.length} mutants killed\n`);
