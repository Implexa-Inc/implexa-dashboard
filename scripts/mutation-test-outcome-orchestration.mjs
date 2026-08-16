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
  'app/(dashboard)/work/_components/outcome-productions-list.render.test.ts',
];

const CONTRACT = 'lib/outcome-production.ts';
const ACTIONS = 'lib/outcome-production-actions.ts';
const LOAD = 'lib/outcome-production-load.ts';
const ENTRY = 'app/(dashboard)/_components/outcome-entry.tsx';
const CARD = 'app/(dashboard)/_components/outcome-plan-card.tsx';
const MONITOR = 'app/(dashboard)/_components/outcome-production-monitor.tsx';
const WORK_ITEM = 'app/(dashboard)/_components/outcome-work-item.tsx';
const LIST = 'app/(dashboard)/work/_components/outcome-productions-list.tsx';

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

  // ── the review fixes (2026-08-15) ────────────────────────────────────
  // Each of these restores a bug an independent review found in the first
  // draft, so the mutant is the exact defect that shipped, not an invented one.
  ['stale-response', 'RESTORES: an edit no longer invalidates an in-flight plan', ENTRY,
    '      reqId.current += 1;\n      set(value);',
    '      set(value);'],
  ['stale-response', 'RESTORES: a superseded plan answer is applied anyway', ENTRY,
    '      if (!current()) return;\n      if (res.status === 400 || res.status === 401) {',
    '      if (res.status === 400 || res.status === 401) {'],
  ['currency', 'RESTORES: any string passes as a currency and render throws', CONTRACT,
    "const currency = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z]{3}$/.test(v);",
    "const currency = (v: unknown): v is string => typeof v === 'string' && v.length > 0;"],
  ['settlement', 'RESTORES: settlement inferred from the state string', LOAD,
    '  if (!production.settled) return { status: \'ok\', production, receipt: null, receiptStatus: \'none\' };',
    "  if (production.state !== 'completed') return { status: 'ok', production, receipt: null, receiptStatus: 'none' };"],
  ['settlement', 'settlement flag is optional on the wire', CONTRACT,
    "  if (typeof v.settled !== 'boolean') return null;",
    "  if (false) return null;"],
  ['receipt-scope', 'RESTORES: a drifted receipt blanks the whole production', LOAD,
    "    if (!receipt) return { status: 'ok', production, receipt: null, receiptStatus: 'unavailable' };",
    "    if (!receipt) return { status: 'unavailable', reason: 'The production receipt did not match the contract.' };"],
  ['list-honesty', 'a drifted member is dropped and the list still claims to be complete', CONTRACT,
    '    const production = parseProduction(raw);\n    if (!production) return null;\n    out.push(production);',
    '    const production = parseProduction(raw);\n    if (production) out.push(production);'],
  ['list-honesty', 'an unreadable list renders as an empty one', LIST,
    "  if (load.status === 'unavailable') {",
    '  if (false) {'],
  ['polling', 'settled work keeps polling / unsettled work stops', CONTRACT,
    'export function shouldPollProduction(production: Production): boolean {\n  return !production.settled;',
    'export function shouldPollProduction(production: Production): boolean {\n  return production.settled;'],
  ['start-retry', 'RESTORES: an unconfirmed start sends the user to re-plan', ENTRY,
    "const UNCONFIRMED_START_COPY = 'We couldn’t confirm the start. Press Start production again — it reuses this plan’s approval, so it cannot reserve your budget twice.';",
    "const UNCONFIRMED_START_COPY = 'We couldn’t confirm the start. Nothing shows as running — plan again rather than assuming it began.';"],
  ['attachment-cap', 'RESTORES: files past the cap are dropped silently', ENTRY,
    '      if (next.length >= MAX_ATTACHMENTS) { dropped += 1; continue; }',
    '      if (next.length >= MAX_ATTACHMENTS) { continue; }'],

  // ── review round 2 (2026-08-15) ──────────────────────────────────────
  // Round 1's own fixes introduced these. Same rule: the mutant restores the
  // exact defect that shipped.
  ['start-lifecycle', 'RESTORES: an edit mid-start wedges Start forever', ENTRY,
    '      setStarting(false);\n    }\n  }',
    '      if (current()) setStarting(false);\n    }\n  }'],
  ['absent-route', 'RESTORES: a missing list route warns every /work user', LOAD,
    "    if (error instanceof BackendError && error.status === 404) return { status: 'absent' };",
    '    if (false) return { status: \'absent\' };'],
  ['absent-route', 'an absent route renders the unavailable banner anyway', LIST,
    "  if (load.status === 'absent') return null;",
    "  if (false) return null;"],
  ['receipt-copy', 'RESTORES: an unread receipt is promised as on its way', LOAD,
    "    return { status: 'ok', production, receipt: null, receiptStatus: 'unavailable' };\n  }\n}",
    "    return { status: 'ok', production, receipt: null, receiptStatus: error instanceof BackendError && error.status === 404 ? 'ready' : 'unavailable' };\n  }\n}"],
  ['count-honesty', 'a blocked production is counted as running', LIST,
    "  const running = unsettled.filter((p) => p.state === 'running').length;",
    '  const running = unsettled.length;'],
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

process.stdout.write(`Mutation result: ${killed}/${mutants.length} killed across 19 boundaries.\n`);
