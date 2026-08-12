import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const target = resolve(root, 'app/(dashboard)/_components/agent-resume.tsx');
const original = readFileSync(target);
const source = original.toString('utf8');
const tests = ['app/(dashboard)/_components/agent-marketplace-boundaries.test.ts'];
const mutations = [
  ['available-always-usable', "agent.readiness.state === 'Available'", 'true'],
  ['blocked-skips-setup', " || agent.readiness.state === 'Blocked'", ''],
  ['broadening-needs-no-acceptance', 'busy || (agent.update.authorityDiff.broadensAuthority && !acceptedUpdate)', 'busy'],
  ['blocked-reason-not-announced', 'role="status"', 'role="note"'],
  ['training-controls-for-non-owner', "agent.ownership === 'Owned'", 'true'],
  ['history-preservation-copy-removed', 'Prior runs, receipts, reviews, learning evidence, and version provenance stay intact.', 'History may be removed.'],
];

let killed = 0;
try {
  for (const [name, from, to] of mutations) {
    const first = source.indexOf(from);
    if (first < 0 || source.indexOf(from, first + 1) >= 0) throw new Error(`${name}: target must occur exactly once`);
    writeFileSync(target, source.replace(from, to));
    const result = spawnSync(process.execPath, ['--test', ...tests], { cwd: root, encoding: 'utf8' });
    if (result.status === 0) { console.error(`SURVIVED: ${name}`); process.exitCode = 1; }
    else { killed += 1; console.log(`KILLED: ${name}`); }
    writeFileSync(target, original);
  }
} finally {
  writeFileSync(target, original);
  if (!readFileSync(target).equals(original)) throw new Error('byte restoration failed');
}
if (process.exitCode) process.exit(process.exitCode);
console.log(`All ${killed}/${mutations.length} Dashboard agent Marketplace mutations killed; source restored byte-for-byte`);
