#!/usr/bin/env node
/**
 * Mutation harness for the outcome-orchestration surface.
 *
 * Shape follows scripts/mutation-test-executor-fallback.mjs: a full-tree copy
 * per mutant with node_modules symlinked (rendered suites need jsdom/esbuild),
 * a GREEN UNMUTATED BASELINE before anything is judged, and anchors that must
 * occur exactly once. A survived mutant is a suite that cannot tell you
 * anything and exits non-zero.
 *
 * Boundaries covered: contract parsing (fail-closed), plan identity
 * (verbatim digest), stale-plan invalidation, approval gating, the single
 * confirm-gated stop, the loader's unavailable-vs-not-found distinction, the
 * write-path allowlist, and Work-item outcome honesty.
 *
 * NOT mutated, deliberately: canStartPlan's `state === 'prepared'` half. The
 * producer only emits missingSetup alongside state 'blocked_on_setup', so
 * each half of that conjunction is EQUIVALENT under the contract; the
 * blocked-plan behavior is enforced through the card's `startable` gate
 * mutants below instead.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');

const suites = [
  'lib/outcome-production.test.ts',
  'lib/outcome-production-actions.test.ts',
  'lib/outcome-production-load.test.ts',
  'app/(dashboard)/_components/outcome-entry.render.test.ts',
  'app/(dashboard)/_components/outcome-production-monitor.render.test.ts',
  'app/(dashboard)/_components/outcome-work-item.render.test.ts',
];

const CONTRACT = 'lib/outcome-production.ts';
const ACTIONS = 'lib/outcome-production-actions.ts';
const LOAD = 'lib/outcome-production-load.ts';
const ENTRY = 'app/(dashboard)/_components/outcome-entry.tsx';
const CARD = 'app/(dashboard)/_components/outcome-plan-card.tsx';
const MONITOR = 'app/(dashboard)/_components/outcome-production-monitor.tsx';
const WORK_ITEM = 'app/(dashboard)/_components/outcome-work-item.tsx';

const mutants = [
  ['fail-closed', 'drifted plan body renders instead of failing closed', CONTRACT,
    'if (!intent || !plan) return null;',
    'if (!intent) return null;'],
  ['fail-closed', 'a selection with no reasons renders', CONTRACT,
    "if (!Array.isArray(v.reasons) || !v.reasons.every(str) || v.reasons.length === 0) return null;",
    "if (!Array.isArray(v.reasons) || !v.reasons.every(str)) return null;"],
  ['fail-closed', 'a three-node plan is accepted past the two-node contract', CONTRACT,
    'if (!Array.isArray(v.nodes) || v.nodes.length < 1 || v.nodes.length > 2) return null;',
    'if (!Array.isArray(v.nodes) || v.nodes.length < 1 || v.nodes.length > 3) return null;'],
  ['fail-closed', 'an approval without its ceiling is acknowledged anyway', CONTRACT,
    'if (!isObj(raw) || !str(raw.kind) || !str(raw.description) || !num(raw.ceilingCents)) return null;',
    'if (!isObj(raw) || !str(raw.kind) || !str(raw.description)) return null;'],
  ['fail-closed', 'an unreadable answer becomes the no-eligible claim', ENTRY,
    "const UNAVAILABLE_COPY = 'We can’t plan this outcome right now. Nothing was selected and nothing will run — this is not the same as having no eligible agent.';",
    "const UNAVAILABLE_COPY = 'No installed agent matches this outcome.';"],
  ['plan-identity', 'start recomputes the digest instead of echoing it verbatim', ENTRY,
    'planDigest: plan.outcome.plan.digest,',
    'planDigest: plan.outcome.plan.digest.toUpperCase(),'],
  ['plan-identity', 'editing an input keeps the stale plan startable', ENTRY,
    "setPlan((current) => (current.phase === 'idle' ? current : { phase: 'idle' }));",
    'setPlan((current) => current);'],
  ['approval-gate', 'Start ignores the unacknowledged approvals', CARD,
    'disabled={!allApproved || starting}',
    'disabled={starting}'],
  ['approval-gate', 'a blocked-on-setup plan grows a Start button', CARD,
    '{startable && (\n        <div className="mt-4">',
    '{true && (\n        <div className="mt-4">'],
  ['single-stop', 'a settled production keeps its stop control', MONITOR,
    '{production.canCancel && (',
    '{true && ('],
  ['single-stop', 'stop fires without the confirm', MONITOR,
    'onClick={() => setConfirmStop(true)}',
    'onClick={stopProduction}'],
  ['loader', 'a drifted production body reads as not_found instead of unavailable', LOAD,
    "if (!production) return { status: 'unavailable', reason: 'The production response did not match the contract.' };",
    "if (!production) return { status: 'not_found' };"],
  ['allowlist', 'the budget ceiling is unbounded', ACTIONS,
    '|| (b.maxBudgetCents as number) > 500000',
    '|| false'],
  ['allowlist', 'a malformed plan digest passes to the backend', ACTIONS,
    "if (typeof b.planDigest !== 'string' || !SHA256.test(b.planDigest)) return 'A valid planDigest is required.';",
    "if (typeof b.planDigest !== 'string') return 'A valid planDigest is required.';"],
  ['work-item-honesty', 'a partial outcome wears the success badge', WORK_ITEM,
    "partial: { label: 'Partially delivered',",
    "partial: { label: 'Delivered',"],
];

function run(cwd) {
  const env = { ...process.env, IMPLEXA_MUTANT_ROOT: cwd, IMPLEXA_SOURCE_ROOT: root, NODE_PATH: path.join(root, 'node_modules') };
  // node:test sets NODE_TEST_CONTEXT for its children; inheriting it silences
  // the spawned runner's summary and a red suite looks green.
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, ['--test', '--test-timeout=60000', ...suites], {
    cwd, encoding: 'utf8', timeout: 300_000, killSignal: 'SIGKILL', env,
  });
}

const baseline = run(root);
if (baseline.status !== 0) {
  process.stderr.write(`HARNESS BROKEN: the UNMUTATED suite fails — nothing below could be a real kill.\n${baseline.stdout.slice(-4000)}\n${baseline.stderr.slice(-2000)}`);
  process.exit(1);
}
process.stdout.write('baseline green: outcome-orchestration suites pass unmutated\n');

let killed = 0;
for (const [boundary, name, file, from, to] of mutants) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'implexa-outcome-orchestration-mutant-'));
  try {
    fs.cpSync(root, dir, {
      recursive: true,
      filter: (src) => !['node_modules', '.git', '.next', 'dist', '.vercel'].includes(path.basename(src)),
    });
    fs.symlinkSync(path.join(root, 'node_modules'), path.join(dir, 'node_modules'));
    const target = path.join(dir, file);
    const source = fs.readFileSync(target, 'utf8');
    const first = source.indexOf(from);
    if (first < 0 || source.indexOf(from, first + 1) >= 0) throw new Error(`${name}: anchor must exist exactly once in ${file}`);
    fs.writeFileSync(target, source.replace(from, to));
    const result = run(dir);
    if (result.status === 0) {
      process.stderr.write(`SURVIVED [${boundary}] ${name}\n`);
      process.exitCode = 1;
    } else {
      killed += 1;
      process.stdout.write(`killed [${boundary}] ${name}\n`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

process.stdout.write(`Mutation result: ${killed}/${mutants.length} killed across 7 boundaries.\n`);
