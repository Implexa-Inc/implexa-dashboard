import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const temp = mkdtempSync(resolve(tmpdir(), 'implexa-dashboard-marketplace-audition-mutants-'));
for (const name of ['app', 'lib', 'test-fixtures', 'package.json', 'tsconfig.json']) cpSync(resolve(root, name), resolve(temp, name), { recursive: true });
symlinkSync(resolve(root, 'node_modules'), resolve(temp, 'node_modules'), 'dir');

const target = resolve(temp, 'app/(dashboard)/_components/agent-resume.tsx');
const original = readFileSync(target, 'utf8');
const mutations = [
  ['acknowledgment-not-required', '!agent.audition.eligible || !providerCostAcknowledged', '!agent.audition.eligible', 'free audition'],
  ['provider-disclosure-hidden', '<p className="mt-2 text-xs text-amber-200">{agent.audition.disclosure}</p>', '<p />', 'free audition'],
  ['false-ack-sent', '{ providerCostAcknowledged: true }', '{ providerCostAcknowledged: false }', 'free audition'],
  ['audition-does-not-open-work', "router.push('/work');", 'router.refresh();', 'free audition'],
  ['owner-controls-shown-to-buyers', "agent.ownership === 'Owned' ? ownerAuditionConfiguration", "agent.ownership !== 'Owned' ? ownerAuditionConfiguration", 'owner'],
  ['missing-owner-authority-guessed-disabled', "? projectedAuditionConfiguration : null;", "? projectedAuditionConfiguration : { allowance: 0, enabled: false, maxAllowance: 5, providerCostMode: 'buyer_owned', disclosure: 'Buyer cost.' };", 'owner'],
  ['unbounded-owner-allowance-projected', "projectedAuditionConfiguration.maxAllowance === 5", 'true', 'owner'],
  ['owner-disable-coerced-to-one', '{ allowance: auditionAllowance }', '{ allowance: auditionAllowance || 1 }', 'owner'],
  ['owner-policy-write-targets-buyer-run', "/audition-policy`, { allowance", "/audition`, { allowance", 'owner'],
];
const run = (pattern = null) => spawnSync(process.execPath, [...(pattern ? [`--test-name-pattern=${pattern}`] : []), '--test', 'app/(dashboard)/_components/agent-resume-render.test.ts'], { cwd: temp, encoding: 'utf8', timeout: 30_000 });
const baseline = run();
if (baseline.status !== 0) throw new Error(`HARNESS BROKEN: unmutated rendered test failed\n${baseline.stdout}\n${baseline.stderr}`);

let killed = 0;
try {
  for (const [name, from, to, pattern] of mutations) {
    const first = original.indexOf(from);
    if (first < 0 || original.indexOf(from, first + 1) >= 0) throw new Error(`${name}: target must occur exactly once`);
    writeFileSync(target, original.replace(from, to));
    const result = run(pattern);
    if (result.error?.code === 'ETIMEDOUT') throw new Error(`HARNESS BROKEN: ${name} timed out`);
    if (result.status === 0) { console.error(`SURVIVED: ${name}`); process.exitCode = 1; }
    else { killed += 1; console.log(`KILLED: ${name}`); }
    writeFileSync(target, original);
  }
} finally { rmSync(temp, { recursive: true, force: true }); }
if (process.exitCode) process.exit(process.exitCode);
console.log(`All ${killed}/${mutations.length} rendered Marketplace audition mutants killed in an isolated copy`);
