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
  'lib/outcome-production-detail.test.ts',
  'app/(dashboard)/_components/outcome-production-detail.render.test.ts',
  // NOT app/(dashboard)/runs/[id]/superseded-shell.test.ts. `node --test`
  // treats positional arguments as GLOB patterns and `[id]` is a valid
  // character class, so that path matches nothing and the suite is silently
  // skipped — the harness would report a confident kill count over a file it
  // never ran (the same trap scripts/run-tests.mjs exists to prevent). The
  // superseded-shell guards it carries are graded here by
  // outcome-production-detail.render.test.ts, which lives in a bracket-free
  // directory; the page-wiring assertions run under `npm test`.
];

const CONTRACT = 'lib/outcome-production.ts';
const ACTIONS = 'lib/outcome-production-actions.ts';
const LOAD = 'lib/outcome-production-load.ts';
const ENTRY = 'app/(dashboard)/_components/outcome-entry.tsx';
const INPUT_PROGRESS = 'app/(dashboard)/_components/run-input-verification-progress.tsx';
const MONITOR = 'app/(dashboard)/_components/outcome-production-monitor.tsx';
const WORK_ITEM = 'app/(dashboard)/_components/outcome-work-item.tsx';
const LIST = 'app/(dashboard)/work/_components/outcome-productions-list.tsx';
const DETAIL = 'lib/outcome-production-detail.ts';
const NODE = 'app/(dashboard)/_components/outcome-node-section.tsx';
const HANDOFF = 'app/(dashboard)/_components/outcome-handoff-row.tsx';
const TRACE = 'app/(dashboard)/_components/outcome-production-trace.tsx';
const ENGINE = 'app/(dashboard)/_components/engine-truth-badge.tsx';
const NARRATIVE = 'app/(dashboard)/_components/production-lineage-narrative.ts';
const LINEAGE_BANNER = 'app/(dashboard)/_components/production-lineage-banner.tsx';

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
  ['lifecycle', 'a terminal system failure asks the user to repair it', MONITOR,
    "  const blockerHeading = production.settled ? 'Production error' : 'Waiting on you';",
    "  const blockerHeading = 'Waiting on you';"],
  ['lifecycle', 'failed terminal nodes are described as complete', MONITOR,
    "{progress.completedNodes} of {progress.totalNodes} steps {terminalWithIncompleteOutcome ? 'settled' : 'complete'}",
    "{progress.completedNodes} of {progress.totalNodes} steps complete"],

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
  ['local-input', 'a non-verification Desktop phase becomes cancel authority', ENTRY,
    "progress.phase !== 'verifying_local'", 'false'],
  ['local-input', 'another input field can seize the pending picker', ENTRY,
    'progress.inputKey !== pendingInputKey.current', 'false'],
  ['local-input', 'another same-key operation can replace the correlated operation', ENTRY,
    'if (active && active !== progress.operationId) return;', 'if (false) return;'],
  ['local-input', 'byte progress is presented as a fixed zero percent', INPUT_PROGRESS,
    '? (progress.bytesRead / totalBytes) * 100', '? 0'],

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


  // ── Canonical multi-agent Production detail ─────────────────────────
  // Every one of these is a way the page could go back to being unreadable
  // about a two-agent job.
  ['engine-truth', 'a node is labelled by its pin when nothing actually ran', ENGINE,
    'if (!actualEngine) {', 'if (false) {'],
  ['engine-truth', 'the requested engine is presented as the one that ran', ENGINE,
    'Ran on {ENGINE_LABELS[actualEngine]}', 'Ran on {ENGINE_LABELS[requestedEngine ?? actualEngine]}'],
  ['engine-truth', 'a failover hides the engine that was actually asked for', ENGINE,
    '{failover && requestedEngine && requestedEngine !== actualEngine && (',
    '{false && requestedEngine && requestedEngine !== actualEngine && ('],
  ['engine-truth', 'an unrecognised engine string is rendered as an engine', DETAIL,
    "  return ENGINES.includes(v as ExecutionEngine) ? (v as ExecutionEngine) : undefined;",
    '  return v as ExecutionEngine;'],

  // Node evidence stays attached to the node that produced it.
  ['node-scope', 'nodes are re-sorted into a plausible order instead of failing closed', DETAIL,
    '  for (let i = 0; i < nodes.length; i += 1) if (nodes[i].ordinal !== i) return null;',
    '  nodes.sort((a, b) => a.ordinal - b.ordinal);'],
  // Re-anchored: the producer/consumer existence check merged into the single
  // lookup the provenance guards below need anyway.
  ['node-scope', 'a handoff naming an absent node is rendered anyway', DETAIL,
    '    if (!producer || !consumer) return null;',
    '    if (false) return null;'],
  // Re-anchored: the ordinal-existence check became the `owner` lookup the
  // trace provenance guards need.
  ['node-scope', 'a trace entry attributed to an absent node is rendered anyway', DETAIL,
    '    const owner = nodes.find((n) => n.ordinal === entry.ordinal);\n    if (!owner) return null;',
    '    const owner = nodes.find((n) => n.ordinal === entry.ordinal) ?? nodes[0];\n    if (!owner) return null;'],
  ['node-scope', 'a node section shows the neighbouring agent as its own', NODE,
    '          Agent {node.ordinal + 1}{node.role ? ` · ${node.role.replace(/_/g, \' \')}` : \'\'}',
    '          Agent {node.ordinal + 2}{node.role ? ` · ${node.role.replace(/_/g, \' \')}` : \'\'}'],
  ['node-scope', 'a node loses its own step summary', NODE,
    '            Steps — {execution.stepSummary.done}/{execution.stepSummary.total}',
    '            Steps'],
  ['node-scope', 'the run permalink stops being labelled a diagnostic', NODE,
    "          Open this agent&apos;s run for diagnostics <span aria-hidden=\"true\">→</span>",
    "          Open this agent&apos;s run <span aria-hidden=\"true\">→</span>"],

  // Handoff identity belongs to the producer.
  ['handoff', 'the handoff row swaps producer and consumer', HANDOFF,
    "  const producer = `Agent ${handoff.producerOrdinal + 1}`;\n  const consumer = `Agent ${handoff.consumerOrdinal + 1}`;",
    "  const producer = `Agent ${handoff.consumerOrdinal + 1}`;\n  const consumer = `Agent ${handoff.producerOrdinal + 1}`;"],
  ['handoff', 'an unvalidated handoff claims its digest was verified', HANDOFF,
    "  const validated = handoff.validationStatus === 'validated';",
    '  const validated = true;'],
  ['handoff', 'the handed artifact loses its digest', HANDOFF,
    '          {handoff.digestPrefix && (',
    '          {false && ('],
  ['handoff', 'a typed handoff failure is swallowed', HANDOFF,
    '      {handoff.failureReason && (', '      {false && ('],
  ['handoff', 'an unknown handoff state renders instead of failing closed', DETAIL,
    '  if (!HANDOFF_STATES.includes(v.state as HandoffState)) return null;',
    '  if (false) return null;'],

  // The combined trace is evidence, so it must be complete and attributed.
  ['trace', 'an unknown event type is dropped from the trace', TRACE,
    '                <span className="text-ink-100">{traceLabel(entry)}</span>',
    '                <span className="text-ink-100">{TRACE_LABELS[entry.type] ? traceLabel(entry) : null}</span>'],
  ['trace', 'trace entries lose the agent they belong to', TRACE,
    "                {entry.ordinal === null ? 'Production' : `Agent ${entry.ordinal + 1}`}",
    "                {'Production'}"],
  ['trace', 'a failover in the timeline reads as an ordinary pickup', TRACE,
    '    if (d.failover === true && requested && requested !== actual) {',
    '    if (false) {'],
  ['trace', 'a sourceless event is accepted as evidence', DETAIL,
    '  if (!TRACE_SOURCES.includes(v.source as TraceSource)) return null;',
    '  if (false) return null;'],

  // The finished thing, and what counts as one.
  // (The old 'an unattributed final deliverable is rendered' mutant lived here.
  // It became EQUIVALENT once provenance landed: a non-integer ordinal or a
  // wrong agentName is now rejected downstream by the producer lookup, so the
  // shape check can no longer be the thing that catches it. The shape check
  // stays — it is what narrows the types — but mutating it proves nothing, and
  // an equivalent mutant is a permanently red run that teaches nothing. The
  // provenance boundary below grades this behaviour directly.)
  ['deliverable', 'the final deliverable region disappears', MONITOR,
    '      {finalDeliverable && finalDeliverable.relativePath && finalDeliverable.validatedPath && (',
    '      {false && ('],

  // The superseded shell — the incident this work exists for.
  ['superseded', 'a superseded shell stops being treated as superseded', NARRATIVE,
    '  return Boolean(lineage && lineage.superseded);', '  return false;'],
  ['superseded', 'the superseded banner disappears', LINEAGE_BANNER,
    '      {lineage.superseded && (', '      {false && ('],
  ['superseded', 'the superseded shell stops linking to the authoritative run', LINEAGE_BANNER,
    '          {lineage.authoritativeRunId && (', '          {false && ('],
  ['superseded', 'a run inside a production stops pointing at its parent', LINEAGE_BANNER,
    '  if (!lineage) return null;', '  return null;\n  if (!lineage) return null;'],
  ['superseded', 'a failed authoritative run is announced as completed', LINEAGE_BANNER,
    "  if (lineage.authoritativeRunState === 'failed' || lineage.authoritativeRunStatus === 'failed') return 'failed';",
    "  if (lineage.authoritativeRunState === 'failed') return 'failed';"],
  ['superseded', 'a missing superseded verdict silently defaults to false', DETAIL,
    '  if (!bool(v.isAuthoritative) || !bool(v.superseded) || !bool(v.suppressRunAgain)) return null;',
    '  if (!bool(v.isAuthoritative)) return null;'],

  // The detail read model itself.
  ['detail-loader', 'a drifted detail body renders as a page missing an agent', LOAD,
    "  if (!detail) return { status: 'unavailable', reason: 'The production detail did not match the contract.' };",
    "  if (!detail) return { status: 'absent', production, receipt: null, receiptStatus: 'none' } as OutcomeProductionDetailLoad;"],
  ['detail-loader', 'a backend without the detail route reports the production missing', LOAD,
    "      if (fallback.status === 'ok') {",
    '      if (false) {'],
  ['detail-loader', 'settled detail keeps polling forever', DETAIL,
    'export function shouldPollDetail(detail: ProductionDetail): boolean {\n  return !detail.settled;',
    'export function shouldPollDetail(detail: ProductionDetail): boolean {\n  return true;'],
  ['detail-loader', 'a live node no longer opens by default', DETAIL,
    "  return ['running', 'stalled', 'dispatched', 'failed', 'partial'].includes(node.execution.state);",
    '  return false;'],

  // Provenance: shape-valid evidence attributed to the wrong agent.
  ['provenance', 'the final deliverable is credited to an agent that did not make it', DETAIL,
    "    if (!producer || producer.agentName !== raw.agentName) return null;",
    '    if (!producer) return null;'],
  ['provenance', 'the final deliverable names a run its agent never had', DETAIL,
    '    if (artifact.runId !== producer.execution.runId) return null;',
    '    if (false) return null;'],
  ['provenance', 'the final deliverable digest is absent from its agent\'s outputs', DETAIL,
    "    if (!producer.execution.artifacts.some((candidate) =>\n      candidate.id === artifact.id && candidate.digest === artifact.digest\n      && candidate.relativePath === artifact.relativePath)) return null;",
    '    if (false) return null;'],
  ['provenance', 'a handoff carries the consumer\'s artifact instead of the producer\'s', DETAIL,
    "      if (!producer.execution.truncated.includes('artifacts')\n        && !producer.execution.artifacts.some((candidate) =>\n          candidate.id === handoff.artifactId && candidate.digest === handoff.digest)) return null;",
    '      if (false) return null;'],
  ['provenance', 'a handoff row names agents its ordinals do not point at', DETAIL,
    '    if (handoff.producerAgentName !== null && handoff.producerAgentName !== producer.agentName) return null;',
    '    if (false) return null;'],
  ['provenance', 'a displayed digest prefix need not belong to its digest', DETAIL,
    '    if (handoff.digest !== null && handoff.digestPrefix !== null\n      && !handoff.digest.startsWith(handoff.digestPrefix)) return null;',
    '    if (false) return null;'],
  ['provenance', 'a node hands off to itself', DETAIL,
    '    if (handoff.producerOrdinal === handoff.consumerOrdinal) return null;',
    '    if (false) return null;'],
  ['provenance', 'a trace row carries another agent\'s run', DETAIL,
    "    if (str(detail.runId) && owner.execution.runId !== null\n      && detail.runId !== owner.execution.runId) return null;",
    '    if (false) return null;'],
  ['provenance', 'a trace row carries another agent\'s digest', DETAIL,
    "    if (str(detail.digestPrefix) && !owner.execution.truncated.includes('artifacts')\n      && owner.execution.artifacts.length > 0\n      && !owner.execution.artifacts.some((candidate) =>\n        candidate.digest !== null && candidate.digest.startsWith(detail.digestPrefix as string))) return null;",
    '    if (false) return null;'],

  // Lineage coherence: the fields the run page turns into navigation.
  ['superseded', 'a superseded lineage may point at the run you are already on', DETAIL,
    '  if (v.superseded && (authoritativeRunId === null || authoritativeRunId === viewedRunId)) return null;',
    '  if (false) return null;'],
  // (The 'both the authority and superseded by one' mutant lived here. The
  // guard it targeted was provably redundant — see the comment on the two
  // coherence checks in parseLineage — so both the guard and the mutant are
  // gone rather than left as decoration.)
  ['superseded', 'a run may claim authority while naming a different run', DETAIL,
    '  if (v.isAuthoritative && (authoritativeRunId === null || authoritativeRunId !== viewedRunId)) return null;',
    '  if (false) return null;'],

  // Edits invalidate displayed and in-flight plans.
  ['stale-response', 'an edit no longer invalidates an in-flight plan', ENTRY,
    '      reqId.current += 1;\n      prepareInFlight.current = null;',
    '      prepareInFlight.current = null;'],
  // Re-anchored 2026-08-17: the line AFTER the guard was rewritten
  // (`res.status === 400 || res.status === 401` became a 4xx range), which
  // silently broke this mutant at origin/main — the harness aborted before
  // reporting. The guard itself is unchanged; only the anchor moved.
  ['stale-response', 'a superseded plan answer is applied anyway', ENTRY,
    '      const body = await res.json().catch(() => null);\n      if (!current()) return;\n      if (!res.ok && res.status >= 400 && res.status < 500) {',
    '      const body = await res.json().catch(() => null);\n      if (!res.ok && res.status >= 400 && res.status < 500) {'],
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

// PRE-FLIGHT: validate every anchor before running anything.
//
// A stale anchor throws mid-run, after minutes of work, and reports only the
// FIRST one — so a refactor that moved three guards costs three full harness
// runs to discover. Worse, a mutant whose anchor silently drifted is a mutant
// that stopped grading anything, and the run before the throw looked green.
// Checking up front costs a second and names all of them at once.
const stale = [];
for (const [boundary, name, file, from] of mutants) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  const matches = text.split(from).length - 1;
  if (matches !== 1) stale.push(`  ${matches} matches — [${boundary}] ${name}  (${file})`);
}
if (stale.length > 0) {
  process.stderr.write(
    `HARNESS BROKEN: ${stale.length} mutant anchor(s) no longer match their source exactly once.\n`
    + 'Each of these grades NOTHING until re-anchored:\n'
    + `${stale.join('\n')}\n`);
  process.exit(1);
}
process.stdout.write(`pre-flight: all ${mutants.length} mutant anchors are unique\n`);

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
