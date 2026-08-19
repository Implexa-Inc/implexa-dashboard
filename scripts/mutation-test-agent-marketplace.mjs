import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const target = resolve(root, 'app/(dashboard)/_components/agent-resume.tsx');
const original = readFileSync(target);
const source = original.toString('utf8');
const mutations = [
  ['available-always-usable', "agent.readiness.state === 'Available'", 'true'],
  ['blocked-becomes-setup-actionable', ": agent.readiness.state === 'Needs setup'", ": agent.readiness.state === 'Needs setup' || agent.readiness.state === 'Blocked'"],
  ['authority-change-needs-no-acceptance', 'busy || (update.authorityDiff.changesAuthority && !acceptedUpdate)', 'busy'],
  ['owned-looks-runnable', "agent.ownership === 'Owned' ? 'Finish setup' : 'Use agent'", "'Use agent'"],
  // `role="status"` alone has matched more than one element since the audition
  // fallback landed, so this anchor graded nothing and threw at HEAD. Anchored
  // to the readiness-reason paragraph it is actually about.
  ['blocked-reason-not-announced', 'role="status" className="mt-4', 'role="note" className="mt-4'],
  ['training-controls-for-non-owner', "{agent.ownership === 'Owned' &&", '{true &&'],
  ['history-preservation-copy-removed', 'Prior runs, receipts, reviews, learning evidence, and version provenance stay intact.', 'History may be removed.'],
  ['retry-key-not-reused', 'let idempotencyKey = operationKeys.current.get(fingerprint);', 'let idempotencyKey = undefined;'],
  ['double-click-not-suppressed', 'if (inFlight.current) return;', 'if (false) return;'],
  // Re-anchored when the flat trust list became four provenance cards: the
  // guard is the same one, in the renderer that now carries it.
  ['hollow-evidence-positive', 'Number(entry.count) > 0', 'Number(entry.count) >= 0'],
  ['uninstalled-controls-visible', "agent.acquisition.lifecycle !== 'uninstalled'", 'true'],
];

// PRE-FLIGHT. Validate every anchor before mutating anything: a drifted anchor
// used to surface only when its turn came, mid-run, one at a time — which is
// how `blocked-reason-not-announced` sat broken on main.
const stale = mutations.filter(([, from]) => {
  const first = source.indexOf(from);
  return first < 0 || source.indexOf(from, first + 1) >= 0;
});
if (stale.length) {
  console.error(`${stale.length} anchor(s) do not occur exactly once:\n${stale.map(([name]) => `  ${name}`).join('\n')}`);
  process.exit(1);
}

let killed = 0;
try {
  for (const [name, from, to] of mutations) {
    const first = source.indexOf(from);
    if (first < 0 || source.indexOf(from, first + 1) >= 0) throw new Error(`${name}: target must occur exactly once`);
    writeFileSync(target, source.replace(from, to));
    // Use the repository runner: it owns node:test lifecycle and exits after
    // every discovered file reports. Direct `node --test` leaves jsdom's React
    // scheduler process alive for some failing render mutants.
    const result = spawnSync(process.execPath, ['scripts/run-tests.mjs'], { cwd: root, encoding: 'utf8' });
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
