// node --test lib/outcome-production-detail.test.ts
//
// The Dashboard's read side of the multi-agent Production contract. Same
// fail-closed discipline as outcome-production.ts: a drifted body comes back
// `null` so the page renders "we can't show this", never a confident page with
// an agent, a handoff, or an engine quietly missing.
//
// Plus the load path: ONE bounded server read for the whole page, a graceful
// degrade on a backend that predates the detail route, and a lineage read that
// can never break the run page it enriches.

import test from 'node:test';
import assert from 'node:assert/strict';
import fixture from '../test-fixtures/generated/outcome-orchestration.json' with { type: 'json' };
import { parseProduction } from './outcome-production.ts';
import {
  parseProductionDetail, parseLineage, parseLineageResponse,
  traceLabel, shouldPollDetail, nodeNeedsAttention,
} from './outcome-production-detail.ts';
import { loadOutcomeProductionDetail, loadProductionLineage } from './outcome-production-load.ts';

const RAW = fixture as unknown as Record<string, any>;
const ID = RAW.details.succeeded.id;

function parsed(name: string) {
  const raw = RAW.details[name];
  const production = parseProduction(raw);
  assert.ok(production, `${name} must parse as a production`);
  return { raw, production: production! };
}

function stubFetch(handler: (url: string) => { status: number; body: unknown }) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: unknown) => {
    const { status, body } = handler(String(url));
    return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
  }) as typeof fetch;
  return () => { globalThis.fetch = original; };
}

// ── parsers ───────────────────────────────────────────────────────────

test('the producer\'s detail projection parses, whole', () => {
  for (const name of ['running', 'succeeded', 'partial', 'failed', 'cancelled']) {
    const { raw, production } = parsed(name);
    const detail = parseProductionDetail(raw, production);
    assert.ok(detail, `${name} must parse`);
    assert.equal(detail!.nodes.length, raw.nodes.length);
    assert.equal(detail!.handoffs.length, raw.handoffs.length);
    assert.equal(detail!.trace.length, raw.trace.length);
    // The monitor contract survives intact underneath the detail.
    assert.equal(detail!.id, production.id);
    assert.equal(detail!.settled, production.settled);
    assert.deepEqual(detail!.progress, production.progress);
  }
});

test('a node out of ordinal order is unreadable, not silently re-sorted', () => {
  const { raw, production } = parsed('succeeded');
  const drifted = structuredClone(raw);
  drifted.nodes.reverse();
  assert.equal(parseProductionDetail(drifted, production), null,
    'the page renders "Agent 1"/"Agent 2" from ordinals — a wrong order is a wrong page');
});

test('an unrecognised engine is refused rather than shown as an engine', () => {
  const { raw, production } = parsed('succeeded');
  const drifted = structuredClone(raw);
  drifted.nodes[1].execution.actualEngine = 'gpt-9';
  assert.equal(parseProductionDetail(drifted, production), null);
});

test('a trace entry without a usable source is refused', () => {
  const { raw, production } = parsed('succeeded');
  for (const mutate of [
    (t: any) => { t.source = 'somewhere'; },
    (t: any) => { t.at = ''; },
    (t: any) => { t.detail = null; },
  ]) {
    const drifted = structuredClone(raw);
    mutate(drifted.trace[0]);
    assert.equal(parseProductionDetail(drifted, production), null,
      'an event that cannot say where it came from is not evidence');
  }
});

test('a trace entry attributed to a node this production lacks is refused', () => {
  const { raw, production } = parsed('succeeded');
  const drifted = structuredClone(raw);
  drifted.trace[3].ordinal = 9;
  assert.equal(parseProductionDetail(drifted, production), null);
});

test('a final deliverable missing its producing agent is refused', () => {
  const { raw, production } = parsed('succeeded');
  const drifted = structuredClone(raw);
  delete drifted.finalDeliverable.agentName;
  assert.equal(parseProductionDetail(drifted, production), null,
    'an unattributed deliverable is how a bundle gets credited to the wrong agent');
});

test('a handoff with an unknown state is refused', () => {
  const { raw, production } = parsed('succeeded');
  const drifted = structuredClone(raw);
  drifted.handoffs[0].state = 'probably_fine';
  assert.equal(parseProductionDetail(drifted, production), null);
});

// ── provenance, not just shape ────────────────────────────────────────
// Everything above proves a body is well-formed. None of it proves the
// evidence belongs to the agent it names — and a wrong-agent attribution here
// renders as a confident, checkable-looking claim: "digest verified",
// "produced by Visual Evidence & Remotion Compositor".

test('a final deliverable credited to the wrong agent is refused', () => {
  const { raw, production } = parsed('succeeded');
  const other = raw.nodes[0];

  // Agent 1's name over agent 2's file.
  const misnamed = structuredClone(raw);
  misnamed.finalDeliverable.agentName = other.agentName;
  assert.equal(parseProductionDetail(misnamed, production), null);

  // Agent 1's ordinal over agent 2's file.
  const misordinal = structuredClone(raw);
  misordinal.finalDeliverable.ordinal = 0;
  assert.equal(parseProductionDetail(misordinal, production), null);

  // The right agent, but a file that agent never produced.
  const misrun = structuredClone(raw);
  misrun.finalDeliverable.runId = other.execution.runId;
  assert.equal(parseProductionDetail(misrun, production), null);

  // The right agent and run, but a digest absent from its validated outputs.
  const misdigest = structuredClone(raw);
  misdigest.finalDeliverable.digest = 'f'.repeat(64);
  assert.equal(parseProductionDetail(misdigest, production), null);
});

test('a handoff carrying the CONSUMER\'s artifact is refused', () => {
  const { raw, production } = parsed('succeeded');
  const consumerArtifact = raw.nodes[1].execution.artifacts[0];

  // The finished video presented as what agent 1 handed over.
  const swapped = structuredClone(raw);
  swapped.handoffs[0].artifactId = consumerArtifact.id;
  swapped.handoffs[0].digest = consumerArtifact.digest;
  swapped.handoffs[0].digestPrefix = consumerArtifact.digest.slice(0, 12);
  swapped.handoffs[0].artifactName = consumerArtifact.name;
  assert.equal(parseProductionDetail(swapped, production), null,
    'the row would have rendered "digest verified" over a file agent 1 never made');

  // A digest whose displayed prefix does not belong to it.
  const lyingPrefix = structuredClone(raw);
  lyingPrefix.handoffs[0].digestPrefix = 'abcabcabcabc';
  assert.equal(parseProductionDetail(lyingPrefix, production), null);

  // Agent names that contradict the ordinals they sit on.
  const misnamed = structuredClone(raw);
  misnamed.handoffs[0].producerAgentName = raw.nodes[1].agentName;
  assert.equal(parseProductionDetail(misnamed, production), null);

  // A node handing off to itself is not a seam. The consumer NAME is fixed up
  // too, or the name check above rejects it first and this asserts nothing —
  // a mutation run caught exactly that: the guard was untested while the test
  // passed.
  const selfHandoff = structuredClone(raw);
  selfHandoff.handoffs[0].consumerOrdinal = 0;
  selfHandoff.handoffs[0].consumerAgentName = raw.nodes[0].agentName;
  assert.equal(parseProductionDetail(selfHandoff, production), null);
});

test('a trace row naming one agent while carrying another\'s evidence is refused', () => {
  const { raw, production } = parsed('succeeded');
  const agentOneRun = raw.nodes[0].execution.runId;

  const wrongRun = structuredClone(raw);
  const settled = wrongRun.trace.find((e: any) => e.ordinal === 1 && e.detail?.runId);
  assert.ok(settled, 'the fixture has a node-scoped row carrying a run id');
  settled.detail.runId = agentOneRun;
  assert.equal(parseProductionDetail(wrongRun, production), null);

  const wrongDigest = structuredClone(raw);
  const validated = wrongDigest.trace.find((e: any) => e.type === 'child_artifact_validated' && e.ordinal === 1);
  assert.ok(validated);
  validated.detail.digestPrefix = raw.nodes[0].execution.artifacts[0].digest.slice(0, 12);
  assert.equal(parseProductionDetail(wrongDigest, production), null);
});

test('the honest fixture still parses — these checks reject drift, not real data', () => {
  for (const name of ['running', 'succeeded', 'partial', 'failed', 'cancelled', 'blocked']) {
    const { raw, production } = parsed(name);
    assert.ok(parseProductionDetail(raw, production), `${name} must still parse`);
  }
});

test('an incoherent lineage cannot become a self-redirect', () => {
  const base = RAW.lineages.supersededShell;

  // "Superseded" pointing at the run you are already on: the run page would
  // redirect to itself, forever.
  const selfSuperseded = { ...base, authoritativeRunId: base.viewedRunId };
  assert.equal(parseLineage(selfSuperseded), null);

  // Superseded with nothing better to point at.
  assert.equal(parseLineage({ ...base, authoritativeRunId: null }), null);

  // "Both the authority and superseded by one" needs no guard of its own: it
  // requires authoritativeRunId to simultaneously differ from and equal
  // viewedRunId, so the two checks below already make it unrepresentable.
  assert.equal(parseLineage({ ...base, isAuthoritative: true }), null);
  assert.equal(parseLineage({ ...RAW.lineages.authoritative, superseded: true }), null);

  // Claiming to be the authority while naming a different run.
  const authoritative = RAW.lineages.authoritative;
  assert.equal(parseLineage({ ...authoritative, authoritativeRunId: base.viewedRunId }), null);
  assert.ok(parseLineage(authoritative), 'the honest authoritative lineage still parses');
});

test('lineage parses, and null lineage is an ANSWER rather than a parse failure', () => {
  assert.ok(parseLineage(RAW.lineages.supersededShell));
  assert.equal(parseLineageResponse({ ok: true, lineage: null }), null);
  assert.equal(parseLineageResponse({ ok: true }), null);
  // Drift and a non-ok envelope are both "unreadable", which is `undefined`.
  assert.equal(parseLineageResponse({ ok: true, lineage: { productionId: 'x' } }), undefined);
  assert.equal(parseLineageResponse({ ok: false }), undefined);
  assert.equal(parseLineageResponse(null), undefined);
});

test('a lineage missing its superseded verdict is unreadable — never defaulted to false', () => {
  const drifted = structuredClone(RAW.lineages.supersededShell);
  delete (drifted as Record<string, unknown>).superseded;
  assert.equal(parseLineage(drifted), null,
    'defaulting it would silently restore "this run stalled" over a completed sibling');
});

test('display helpers name known events and pass unknown ones through', () => {
  assert.equal(traceLabel({ at: '', type: 'child_engine_selected', source: 'run_execution_contexts', ordinal: 0, detail: {} }), 'Picked up');
  assert.equal(traceLabel({ at: '', type: 'a_new_event', source: 'outcome_production_events', ordinal: null, detail: {} }), 'a new event');
});

// ── load path ─────────────────────────────────────────────────────────

test('the whole page is ONE bounded read for an unsettled production', async () => {
  const seen: string[] = [];
  const restore = stubFetch((url) => {
    seen.push(url);
    return { status: 200, body: RAW.responses.detailRunning };
  });
  try {
    const load = await loadOutcomeProductionDetail(RAW.details.running.id, 'jwt');
    assert.equal(load.status, 'ok');
    assert.equal(seen.length, 1, 'no second read of the same production, no client waterfall');
    assert.match(seen[0], /\/detail$/);
    assert.ok(load.status === 'ok' && load.detail.nodes.length === 2);
    assert.equal(load.status === 'ok' && load.receiptStatus, 'none');
  } finally { restore(); }
});

test('a settled production reads its receipt exactly once more', async () => {
  const seen: string[] = [];
  const restore = stubFetch((url) => {
    seen.push(url);
    return url.endsWith('/receipt')
      ? { status: 200, body: RAW.responses.receiptSuccess }
      : { status: 200, body: RAW.responses.detailSucceeded };
  });
  try {
    const load = await loadOutcomeProductionDetail(ID, 'jwt');
    assert.equal(load.status, 'ok');
    assert.equal(load.status === 'ok' && load.receiptStatus, 'ready');
    assert.equal(seen.length, 2);
  } finally { restore(); }
});

test('a backend without the detail route degrades to the monitor, and says which part is missing', async () => {
  const seen: string[] = [];
  const restore = stubFetch((url) => {
    seen.push(url);
    if (url.endsWith('/detail')) return { status: 404, body: { error: 'not found' } };
    if (url.endsWith('/receipt')) return { status: 200, body: RAW.responses.receiptSuccess };
    return { status: 200, body: RAW.responses.statusCompleted };
  });
  try {
    const load = await loadOutcomeProductionDetail(ID, 'jwt');
    assert.equal(load.status, 'absent', 'the parent still renders; only the breakdown is missing');
    assert.ok(load.status === 'absent' && load.production.children.length === 2);
    assert.ok(seen.some((url) => url.endsWith('/detail')));
  } finally { restore(); }
});

test('a 404 for a production that truly does not exist stays not_found', async () => {
  const restore = stubFetch(() => ({ status: 404, body: { error: 'not found' } }));
  try {
    assert.equal((await loadOutcomeProductionDetail(ID, 'jwt')).status, 'not_found');
  } finally { restore(); }
});

test('a 200 whose detail drifted is unavailable, never a page missing an agent', async () => {
  const drifted = structuredClone(RAW.responses.detailSucceeded);
  drifted.production.nodes[1].execution.actualEngine = 'not-an-engine';
  const restore = stubFetch(() => ({ status: 200, body: drifted }));
  try {
    const load = await loadOutcomeProductionDetail(ID, 'jwt');
    assert.equal(load.status, 'unavailable');
    assert.match(load.status === 'unavailable' ? load.reason : '', /detail did not match/);
  } finally { restore(); }
});

test('an unreadable receipt does not blank a production that read perfectly', async () => {
  const restore = stubFetch((url) => (url.endsWith('/receipt')
    ? { status: 500, body: { error: 'boom' } }
    : { status: 200, body: RAW.responses.detailSucceeded }));
  try {
    const load = await loadOutcomeProductionDetail(ID, 'jwt');
    assert.equal(load.status, 'ok');
    assert.equal(load.status === 'ok' && load.receiptStatus, 'unavailable');
  } finally { restore(); }
});

test('the lineage read can never break the run page it enriches', async () => {
  for (const reply of [
    { status: 404, body: { error: 'no route' } },
    { status: 500, body: { error: 'boom' } },
    { status: 200, body: { ok: true, lineage: { productionId: 'drifted' } } },
    { status: 200, body: 'not json at all' },
  ]) {
    const restore = stubFetch(() => reply);
    try {
      assert.equal(await loadProductionLineage('run-1', 'jwt'), null,
        'every failure mode leaves the run page exactly as it was');
    } finally { restore(); }
  }
});

test('a real superseded lineage comes back typed', async () => {
  const restore = stubFetch(() => ({ status: 200, body: RAW.responses.lineageSupersededShell }));
  try {
    const lineage = await loadProductionLineage('run-1', 'jwt');
    assert.ok(lineage);
    assert.equal(lineage!.superseded, true);
    assert.equal(lineage!.suppressRunAgain, true);
    assert.equal(lineage!.authoritativeRunId, RAW.lineages.supersededShell.authoritativeRunId);
  } finally { restore(); }
});

// ── polling + attention ───────────────────────────────────────────────

test('polling follows settlement, and attention follows liveness', () => {
  const running = parseProductionDetail(RAW.details.running, parseProduction(RAW.details.running)!)!;
  const succeeded = parseProductionDetail(RAW.details.succeeded, parseProduction(RAW.details.succeeded)!)!;
  assert.equal(shouldPollDetail(running), true);
  assert.equal(shouldPollDetail(succeeded), false);
  assert.equal(nodeNeedsAttention(succeeded.nodes[0]), false);
  assert.equal(nodeNeedsAttention(running.nodes[1]), true);
});
