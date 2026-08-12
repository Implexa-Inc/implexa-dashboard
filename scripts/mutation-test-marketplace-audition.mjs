import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const temp = mkdtempSync(resolve(root, '.marketplace-audition-mutants-'));
for (const name of ['app', 'lib', 'test-fixtures', 'package.json', 'tsconfig.json']) cpSync(resolve(root, name), resolve(temp, name), { recursive: true });
symlinkSync(resolve(root, 'node_modules'), resolve(temp, 'node_modules'), 'dir');

const target = resolve(temp, 'app/(dashboard)/_components/agent-resume.tsx');
const original = readFileSync(target, 'utf8');
const mutations = [
  ['acknowledgment-not-required', '!agent.audition.eligible || !providerCostAcknowledged', '!agent.audition.eligible'],
  ['provider-disclosure-hidden', '<p className="mt-2 text-xs text-amber-200">{agent.audition.disclosure}</p>', '<p />'],
  ['false-ack-sent', '{ providerCostAcknowledged: true }', '{ providerCostAcknowledged: false }'],
  ['audition-does-not-open-work', "router.push('/work');", 'router.refresh();'],
];
const run = () => spawnSync(process.execPath, ['--test', 'app/(dashboard)/_components/agent-resume-render.test.ts'], { cwd: temp, encoding: 'utf8', timeout: 120_000 });
const baseline = run();
if (baseline.status !== 0) throw new Error(`HARNESS BROKEN: unmutated rendered test failed\n${baseline.stdout}\n${baseline.stderr}`);

let killed = 0;
try {
  for (const [name, from, to] of mutations) {
    const first = original.indexOf(from);
    if (first < 0 || original.indexOf(from, first + 1) >= 0) throw new Error(`${name}: target must occur exactly once`);
    writeFileSync(target, original.replace(from, to));
    const result = run();
    if (result.status === 0) { console.error(`SURVIVED: ${name}`); process.exitCode = 1; }
    else { killed += 1; console.log(`KILLED: ${name}`); }
    writeFileSync(target, original);
  }
} finally { rmSync(temp, { recursive: true, force: true }); }
if (process.exitCode) process.exit(process.exitCode);
console.log(`All ${killed}/${mutations.length} rendered Marketplace audition mutants killed in an isolated copy`);
