#!/usr/bin/env node
/**
 * Mutation harness for the Backend-owned, credit-native Outcome Orchestration
 * Dashboard contract.
 *
 * Each mutant runs in a full-tree copy with node_modules symlinked. The
 * unmodified focused suites MUST be green first, every source anchor MUST be
 * unique, and every mutant MUST make at least one suite red.
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
const MONITOR = 'app/(dashboard)/_components/outcome-production-monitor.tsx';
const WORK_ITEM = 'app/(dashboard)/_components/outcome-work-item.tsx';
const LIST = 'app/(dashboard)/work/_components/outcome-productions-list.tsx';

const mutants = [
  // Backend identity is echoed, never invented or recomputed in the browser.
  ['identity', 'drifted nested plan renders instead of failing closed', CONTRACT,
    'if (!intent || !plan) return null;', 'if (!intent) return null;'],
  ['identity', 'a browser-invented production id is accepted from prepare', CONTRACT,
    'if (!str(v.productionId) || !UUID.test(v.productionId)) return null;',
    'if (!str(v.productionId)) return null;'],
  ['identity', 'a non-digest plan identity is accepted from prepare', CONTRACT,
    'if (!str(rawDigest) || !SHA256.test(rawDigest)) return null;',
    'if (!str(rawDigest)) return null;'],
  ['identity', 'a child without spent-credit evidence is rendered', CONTRACT,
    'if (!str(v.state) || !num(v.budgetAllocationCredits) || !num(v.spentCredits)) return null;',
    'if (!str(v.state) || !num(v.budgetAllocationCredits)) return null;'],
  ['identity', 'a malformed verified-artifact digest crosses prepare', ACTIONS,
    "if (typeof a.digest !== 'string' || !SHA256.test(a.digest)) return 'Each input needs a valid SHA-256 digest.';",
    "if (typeof a.digest !== 'string') return 'Each input needs a valid SHA-256 digest.';"],
  ['identity', 'start recomputes the Backend plan digest', ENTRY,
    "body: JSON.stringify({ action: 'start', productionId: selected.productionId, expected_plan_digest: selected.plan.digest }),",
    "body: JSON.stringify({ action: 'start', productionId: selected.productionId, expected_plan_digest: selected.plan.digest.toUpperCase() }),"],
  ['identity', 'start forwards an extra browser identity in its body', ACTIONS,
    'body: { expected_plan_digest: b.expected_plan_digest },',
    'body: { expected_plan_digest: b.expected_plan_digest, productionId },'],

  // Credits are positive integers and are forwarded verbatim.
  ['credits', 'zero credits become a valid production budget', ACTIONS,
    '(b.max_budget_credits as number) < 1', '(b.max_budget_credits as number) < 0'],
  ['credits', 'fractional credits become a valid production budget', ACTIONS,
    '!Number.isInteger(b.max_budget_credits) || ', ''],
  ['credits', 'the Dashboard alters the Backend credit ceiling in transit', ACTIONS,
    'max_budget_credits: b.max_budget_credits,',
    'max_budget_credits: (b.max_budget_credits as number) + 1,'],

  // V1 is a hard maximum of two sequential nodes.
  ['two-node', 'the two-node contract is reinterpreted as one node', CONTRACT,
    'if (!isObj(stop) || stop.max_nodes !== 2 || stop.sequential_only !== true) return null;',
    'if (!isObj(stop) || stop.max_nodes !== 1 || stop.sequential_only !== true) return null;'],
  ['two-node', 'a sequential plan is rejected in favor of parallel execution', CONTRACT,
    'if (!isObj(stop) || stop.max_nodes !== 2 || stop.sequential_only !== true) return null;',
    'if (!isObj(stop) || stop.max_nodes !== 2 || stop.sequential_only !== false) return null;'],
  ['two-node', 'a plan with unresolved inputs grows a Start button', CONTRACT,
    'return plan.unresolved_missing_assets.length === 0;', 'return true;'],

  // Lifecycle truth comes from the Backend settled flag and typed states.
  ['lifecycle', 'settled work polls forever and live work stops updating', CONTRACT,
    'export function shouldPollProduction(production: Production): boolean {\n  return !production.settled;',
    'export function shouldPollProduction(production: Production): boolean {\n  return production.settled;'],
  ['lifecycle', 'the authoritative settled flag is inverted by the loader', LOAD,
    "if (!production.settled) return { status: 'ok', production, receipt: null, receiptStatus: 'none' };",
    "if (production.settled) return { status: 'ok', production, receipt: null, receiptStatus: 'none' };"],
  ['lifecycle', 'ready and blocked productions are counted as running', LIST,
    "  const running = unsettled.filter((p) => p.state === 'running').length;",
    '  const running = unsettled.length;'],

  // Receipt facts remain typed and independently readable.
  ['receipt', 'the typed success receipt is rejected for an invented label', CONTRACT,
    "if (!isObj(o) || (o.type !== 'success' && o.type !== 'partial' && o.type !== 'failure')) return null;",
    "if (!isObj(o) || (o.type !== 'succeeded' && o.type !== 'partial' && o.type !== 'failure')) return null;"],
  ['receipt', 'a drifted receipt hides the production that read cleanly', LOAD,
    "if (!receipt) return { status: 'ok', production, receipt: null, receiptStatus: 'unavailable' };",
    "if (!receipt) return { status: 'unavailable', reason: 'The production receipt did not match the contract.' };"],
  ['receipt', 'a failed receipt read is promised as ready', LOAD,
    "return { status: 'ok', production, receipt: null, receiptStatus: 'unavailable' };\n  }\n}",
    "return { status: 'ok', production, receipt: null, receiptStatus: 'ready' };\n  }\n}"],
  ['receipt', 'the receipt digest is displayed as the selected plan identity', WORK_ITEM,
    'plan {receipt.planDigest.slice(0, 12)}',
    'plan {receipt.receiptDigest.slice(0, 12)}'],

  // Cancellation is one parent-scoped, confirm-gated operation.
  ['cancel', 'a settled production keeps its stop control', MONITOR,
    '{production.canCancel && (', '{true && ('],
  ['cancel', 'stop fires without confirmation', MONITOR,
    'onClick={() => setConfirmStop(true)}', 'onClick={stopProduction}'],
  ['cancel', 'cancel is routed to start instead of the parent cancel endpoint', ACTIONS,
    "return { path: `/api/v2/outcome-productions/${productionId}/cancel`, method: 'POST', body: {} };",
    "return { path: `/api/v2/outcome-productions/${productionId}/start`, method: 'POST', body: {} };"],

  // Reads are three-valued. Unknown/unreadable is never silently empty.
  ['loader', 'a drifted production body reads as not_found', LOAD,
    "if (!production) return { status: 'unavailable', reason: 'The production response did not match the contract.' };",
    "if (!production) return { status: 'not_found' };"],
  ['loader', 'a deployment without the list route is reported as a fault', LOAD,
    "if (error instanceof BackendError && error.status === 404) return { status: 'absent' };",
    "if (false) return { status: 'absent' };"],
  ['loader', 'one drifted production is dropped from a supposedly complete list', CONTRACT,
    '    const production = parseProduction(raw);\n    if (!production) return null;\n    out.push(production);',
    '    const production = parseProduction(raw);\n    if (production) out.push(production);'],
  ['loader', 'an unreadable production list renders as an empty one', LIST,
    "  if (load.status === 'unavailable') {", '  if (false) {'],
  ['loader', 'an absent route renders the unavailable banner', LIST,
    "  if (load.status === 'absent') return null;", "  if (false) return null;"],

  // Work-item outcome, credits, artifacts and provenance stay honest.
  ['work-item', 'a partial outcome wears the success badge', WORK_ITEM,
    "partial: { label: 'Partially delivered',", "partial: { label: 'Delivered',"],
  ['work-item', 'actual cost is replaced with the maximum budget', WORK_ITEM,
    '{budget.spentCredits.toLocaleString()} credits',
    '{budget.maxBudgetCredits.toLocaleString()} credits'],
  ['work-item', 'validated artifact names disappear', WORK_ITEM,
    '{artifact.name}</span>', '{artifact.kind}</span>'],
  ['work-item', 'artifact provenance shows filename bytes instead of its digest', WORK_ITEM,
    '{artifact.kind} · digest {artifact.digest.slice(0, 16)}',
    '{artifact.kind} · digest {artifact.name.slice(0, 16)}'],
  ['work-item', 'the selected path loses one-based human ordering', WORK_ITEM,
    '{step.order + 1}. {step.agentName}', '{step.order}. {step.agentName}'],

  // Edits invalidate displayed and in-flight plans.
  ['stale-response', 'an edit no longer invalidates an in-flight plan', ENTRY,
    '      reqId.current += 1;\n      prepareInFlight.current = null;',
    '      prepareInFlight.current = null;'],
  ['stale-response', 'a superseded plan answer is applied anyway', ENTRY,
    '      if (!current()) return;\n      if (res.status === 400 || res.status === 401) {',
    '      if (res.status === 400 || res.status === 401) {'],
];

function run(cwd) {
  const env = {
    ...process.env,
    IMPLEXA_MUTANT_ROOT: cwd,
    IMPLEXA_SOURCE_ROOT: root,
    NODE_PATH: path.join(root, 'node_modules'),
  };
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, ['--test', '--test-timeout=60000', ...suites], {
    cwd, encoding: 'utf8', timeout: 30_000, killSignal: 'SIGKILL', env,
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
    if (first < 0 || source.indexOf(from, first + 1) >= 0) {
      throw new Error(`${name}: anchor must exist exactly once in ${file}`);
    }
    fs.writeFileSync(target, source.replace(from, to));
    const result = run(dir);
    if (result.status === 0) {
      process.stderr.write(`SURVIVED [${boundary}] ${name}\n`);
      process.exitCode = 1;
    } else {
      killed += 1;
      const suffix = result.error?.code === 'ETIMEDOUT' ? ' (timeout)' : '';
      process.stdout.write(`killed${suffix} [${boundary}] ${name}\n`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const boundaries = new Set(mutants.map(([boundary]) => boundary)).size;
process.stdout.write(`Mutation result: ${killed}/${mutants.length} killed across ${boundaries} boundaries.\n`);
