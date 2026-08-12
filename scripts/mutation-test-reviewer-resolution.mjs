#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const tests = ['lib/review-room-reviewer-resolution.test.ts', 'lib/reviewer-resolution-contract.test.ts'];
const mutants = [
  ['resolved-stays-active', 'app/(dashboard)/_components/review-room.tsx',
    "() => issues.filter((i) => i.status !== 'dismissed' && !i.reviewerResolution),",
    "() => issues.filter((i) => i.status !== 'dismissed'),"],
  ['draft-becomes-resolvable', 'app/(dashboard)/_components/review-room.tsx',
    "                  {i.status !== 'draft' && (",
    '                  {true && ('],
  ['resolution-outage-fails-open', 'app/(dashboard)/_components/review-room.tsx',
    "  const resolutionsUnavailable = sources.reviewer_resolutions === 'unavailable';",
    '  const resolutionsUnavailable = false;'],
  ['composition-counts-swapped', 'lib/review-room-state.ts',
    'return `Send ${unresolvedCount} unresolved + ${newCount} new ${noun(newCount, \'change\', \'changes\')}`;',
    'return `Send ${newCount} unresolved + ${unresolvedCount} new ${noun(unresolvedCount, \'change\', \'changes\')}`;'],
  ['add-more-disabled', 'app/(dashboard)/_components/review-room.tsx',
    'disabled={busy}\n            onClick={() => void addMoreFeedback()}',
    'disabled={true}\n            onClick={() => void addMoreFeedback()}'],
  ['double-click-latch-removed', 'app/(dashboard)/_components/review-room.tsx',
    'if (!session?.id || !issueIds.length || resolutionFlightRef.current) return;',
    'if (!session?.id || !issueIds.length) return;'],
  ['retry-label-regressed', 'app/(dashboard)/_components/review-continuation-recovery.tsx',
    "{busy ? 'Checking…' : 'Retry revision'}",
    "{busy ? 'Checking…' : 'Retry this revision'}"],
];
const files = [...new Set(mutants.map((m) => m[1]))];
const originals = new Map(files.map((f) => [f, readFileSync(f)]));
const hash = (b) => createHash('sha256').update(b).digest('hex');
const run = () => spawnSync(process.execPath, ['--test', ...tests], { encoding: 'utf8' });

const baseline = run();
assert.equal(baseline.status, 0, `unmutated baseline is not green:\n${baseline.stdout}\n${baseline.stderr}`);
let killed = 0;
try {
  for (const [name, file, anchor, replacement] of mutants) {
    const original = originals.get(file).toString('utf8');
    assert.equal(original.split(anchor).length - 1, 1, `${name}: anchor must occur exactly once`);
    writeFileSync(file, original.replace(anchor, replacement));
    const result = run();
    assert.notEqual(result.status, 0, `${name}: mutant survived (vacuous harness)`);
    killed += 1;
    writeFileSync(file, originals.get(file));
  }
} finally {
  for (const file of files) writeFileSync(file, originals.get(file));
}
for (const file of files) assert.equal(hash(readFileSync(file)), hash(originals.get(file)), `${file} was not restored byte-for-byte`);
console.log(`reviewer-resolution Dashboard mutation harness: ${killed}/${mutants.length} mutants killed; baseline green; tree restored`);
