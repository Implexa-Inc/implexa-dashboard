import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const temp = mkdtempSync(resolve(tmpdir(), 'implexa-dashboard-marketplace-handoff-mutants-'));
for (const name of ['app', 'lib', 'test-fixtures', 'package.json', 'tsconfig.json']) cpSync(resolve(root, name), resolve(temp, name), { recursive: true });
symlinkSync(resolve(root, 'node_modules'), resolve(temp, 'node_modules'), 'dir');

const target = resolve(temp, 'app/(dashboard)/_components/agent-discovery-catalog.tsx');
const original = readFileSync(target, 'utf8');
const mutations = [
  ['legacy-detail-route-restored', 'href={`/workflows/${encodeURIComponent(agent.slug)}`}', 'href={`/workflows/${encodeURIComponent(agent.slug)}?legacy=1`}', 'admitted discovery card'],
  ['exact-version-hidden', ' · exact version {agent.version.number}', '', 'admitted discovery card'],
  ['unavailable-fails-open', 'if (unavailable) {', 'if (false && unavailable) {', 'unavailable discovery'],
  ['provider-cost-disclosure-hidden', '<p className="text-xs text-emerald-400">Free audition offered · buyer-owned provider usage</p>', '<p />', 'admitted discovery card'],
];
const run = (pattern = null) => spawnSync(process.execPath, [...(pattern ? [`--test-name-pattern=${pattern}`] : []), '--test', 'app/(dashboard)/_components/agent-discovery-catalog.test.ts'], { cwd: temp, encoding: 'utf8', timeout: 30_000 });
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
} finally {
  writeFileSync(target, original);
  rmSync(temp, { recursive: true, force: true });
}
if (process.exitCode) process.exit(process.exitCode);
console.log(`All ${killed}/${mutations.length} rendered Marketplace handoff mutants killed in an isolated copy`);
