// node --test "app/(dashboard)/_components/outcome-production-detail.render.test.ts"
//
// The canonical multi-agent Production surface, rendered against the
// producer-owned fixture. These are the acceptance claims of the work:
//
//   1. A successful two-agent production shows BOTH agents, in ordinal order,
//      each with its own steps and its own trace, and the final validated
//      deliverable is visible.
//   2. The handoff row between them carries the PRODUCER's artifact identity —
//      the consumer's own output can never be attributed to what it received.
//   3. Engine truth: a node pinned to Codex that executed on Claude says so,
//      with the router's reason, and nothing is ever labelled by its pin.
//   4. A superseded execution shell never reads as the node's final result and
//      never offers to duplicate work the production already paid for.
//   5. A genuine failure shows the typed reason on the agent that failed, and
//      shows the next agent as RELEASED rather than independently failed.

import test from 'node:test';
import assert from 'node:assert/strict';
import { render, type Rendered } from '../../../lib/test/render.ts';
import fixture from '../../../test-fixtures/generated/outcome-orchestration.json' with { type: 'json' };
import {
  parseProductionDetail, parseLineageResponse, nodeNeedsAttention,
  shouldPollDetail, type ProductionDetail,
} from '../../../lib/outcome-production-detail.ts';
import { parseProduction } from '../../../lib/outcome-production.ts';

/** The fixture, through the real parsers — never a hand-shaped object. */
function detail(name: 'running' | 'succeeded' | 'partial' | 'failed' | 'cancelled' | 'blocked'): ProductionDetail {
  const raw = (fixture as Record<string, any>).details[name];
  const production = parseProduction(raw);
  assert.ok(production, `${name} must parse as a production`);
  const parsed = parseProductionDetail(raw, production!);
  assert.ok(parsed, `${name} detail must parse`);
  return parsed!;
}

async function renderNode(name: Parameters<typeof detail>[0], ordinal: number): Promise<Rendered> {
  return render('outcome-node-section.tsx', { node: detail(name).nodes[ordinal] });
}

// ── 1. successful two-agent production ────────────────────────────────

test('both agents render in ordinal order, each with its own steps and trace', async () => {
  const succeeded = detail('succeeded');
  assert.deepEqual(succeeded.nodes.map((n) => n.ordinal), [0, 1]);

  for (const [ordinal, node] of succeeded.nodes.entries()) {
    const rendered = await renderNode('succeeded', ordinal);
    try {
      const text = rendered.text();
      assert.ok(text.includes(node.agentName), 'the agent names itself');
      assert.ok(text.includes(`Agent ${ordinal + 1}`), 'the section is labelled by ordinal');
      assert.ok(text.includes(`version ${node.versionNumber}`), 'the version is shown');

      // Its OWN steps and its OWN trace, both expandable, never flattened.
      assert.ok(rendered.queryByText(/Steps — 11\/11/), 'its own step summary');
      assert.ok(rendered.queryByText(/Step trace —/), 'its own step trace');
      const details = rendered.document.querySelectorAll('details');
      assert.ok(details.length >= 2, 'steps and trace are separately expandable');

      // The run permalink is offered as a DIAGNOSTIC, not as the answer.
      const link = rendered.document.querySelector(`a[href="/runs/${node.execution.runId}"]`);
      assert.ok(link, 'links to its run');
      assert.match(link!.textContent || '', /diagnostic/i);
    } finally { rendered.cleanup(); }
  }
});

test('a node renders only its own evidence — no other agent\'s steps leak in', async () => {
  const succeeded = detail('succeeded');
  const first = await renderNode('succeeded', 0);
  try {
    assert.ok(!first.text().includes(succeeded.nodes[1].agentName),
      'agent 1 must not name agent 2 anywhere in its section');
    for (const artifact of succeeded.nodes[1].execution.artifacts) {
      assert.ok(!first.text().includes(artifact.digest!.slice(0, 12)),
        'agent 2\'s digest cannot appear inside agent 1');
    }
  } finally { first.cleanup(); }
});

test('the completed production shows its final validated deliverable, and stops polling', async () => {
  const succeeded = detail('succeeded');
  assert.equal(succeeded.finalDeliverable?.name, 'video_master.mp4');
  assert.equal(succeeded.finalDeliverable?.ordinal, 1, 'produced by the LAST agent');
  assert.equal(shouldPollDetail(succeeded), false, 'settled work never changes again');
  assert.equal(succeeded.progress.completedNodes, 2);
  assert.equal(succeeded.progress.totalNodes, 2);
  assert.equal(succeeded.state, 'succeeded');

  const rendered = await render('outcome-production-monitor.tsx', {
    production: succeeded,
    finalDeliverable: succeeded.finalDeliverable,
    showChildActivity: false,
  });
  try {
    const region = rendered.document.querySelector('[aria-label="Final deliverable"]');
    assert.ok(region, 'the finished thing is its own prominent region');
    assert.ok((region!.textContent || '').includes('video_master.mp4'));
    assert.ok(rendered.queryByText(/2 of 2 steps complete/));
    // The Open/Reveal affordance is the existing verified-artifact control,
    // acting on the desktop-validated path — not a path pasted from prose.
    assert.ok(region!.textContent!.includes('Open') || region!.querySelector('button'),
      'the deliverable carries an Open/Finder action');
    // Review is opened on the run that PRODUCED the file, focused on the exact
    // artifact — so a human verdict lands on the validated digest.
    const review = region!.querySelector(`a[href^="/review/${succeeded.finalDeliverable!.runId}"]`);
    assert.ok(review, 'the deliverable offers Review');
    assert.match(review!.getAttribute('href')!, new RegExp(`artifact=${succeeded.finalDeliverable!.id}`));
    // With per-agent sections on the page, the vaguer flat child list is gone.
    assert.equal(rendered.queryByText(/^Activity \(/), null);
  } finally { rendered.cleanup(); }
});

test('an unsettled production keeps polling; settlement stops it', () => {
  assert.equal(shouldPollDetail(detail('running')), true);
  for (const name of ['succeeded', 'partial', 'failed', 'cancelled'] as const) {
    assert.equal(shouldPollDetail(detail(name)), false, `${name} must not poll`);
  }
});

// ── 2. handoff truth ──────────────────────────────────────────────────

test('the handoff row carries the producer\'s artifact identity and correct ordinals', async () => {
  const succeeded = detail('succeeded');
  assert.equal(succeeded.handoffs.length, 1);
  const handoff = succeeded.handoffs[0];
  assert.equal(handoff.producerOrdinal, 0);
  assert.equal(handoff.consumerOrdinal, 1);

  const rendered = await render('outcome-handoff-row.tsx', { handoff });
  try {
    const text = rendered.text();
    assert.ok(text.includes('Agent 1'), 'names the producer');
    assert.ok(text.includes('Agent 2'), 'names the consumer');
    assert.ok(text.includes(handoff.artifactName!), 'names the handed artifact');
    assert.ok(text.includes(handoff.digestPrefix!), 'shows the digest prefix');
    assert.match(text, /digest verified/);
    assert.match(text, /handed to Agent 2/);
    assert.match(text, /dispatched/i);

    // The row is the seam, so its label states the direction unambiguously.
    const region = rendered.document.querySelector('[aria-label^="Handoff from agent 1 to agent 2"]');
    assert.ok(region, 'the handoff labels its own direction');
  } finally { rendered.cleanup(); }
});

test('no filename or digest can be associated with the wrong agent', async () => {
  const succeeded = detail('succeeded');
  const handoff = succeeded.handoffs[0];
  const producerArtifact = succeeded.nodes[0].execution.artifacts[0];
  const consumerArtifact = succeeded.nodes[1].execution.artifacts[0];

  // The handoff is the PRODUCER's output, not the consumer's.
  assert.equal(handoff.digest, producerArtifact.digest);
  assert.notEqual(handoff.digest, consumerArtifact.digest);

  const rendered = await render('outcome-handoff-row.tsx', { handoff });
  try {
    const text = rendered.text();
    assert.ok(!text.includes(consumerArtifact.name!), 'the consumer\'s own output never appears here');
    assert.ok(!text.includes(consumerArtifact.digest!.slice(0, 12)));
  } finally { rendered.cleanup(); }
});

test('a handoff naming a node this production does not have is unreadable, not rendered', () => {
  const raw = structuredClone((fixture as Record<string, any>).details.succeeded);
  raw.handoffs[0].producerOrdinal = 7;
  const production = parseProduction(raw);
  assert.ok(production);
  assert.equal(parseProductionDetail(raw, production!), null);
});

// ── 3. engine truth ───────────────────────────────────────────────────

test('a node pinned to Codex that ran on Claude reports both, plus the reason', async () => {
  const node = detail('succeeded').nodes[1];
  assert.equal(node.execution.requestedEngine, 'codex');
  assert.equal(node.execution.actualEngine, 'claude');
  assert.equal(node.execution.failover, true);

  const rendered = await renderNode('succeeded', 1);
  try {
    const text = rendered.text();
    assert.match(text, /Ran on Claude/, 'the ACTUAL engine leads');
    assert.match(text, /requested Codex/, 'the pin is shown as the request, not the outcome');
    assert.ok(text.includes(node.execution.failoverReason!), 'the router\'s own reason renders verbatim');
  } finally { rendered.cleanup(); }
});

test('a node that ran where it was asked shows one engine and no phantom failover', async () => {
  const node = detail('succeeded').nodes[0];
  assert.equal(node.execution.failover, false);
  assert.equal(node.execution.failoverReason, null);
  const rendered = await renderNode('succeeded', 0);
  try {
    assert.match(rendered.text(), /Ran on Codex/);
    assert.ok(!/requested Claude/.test(rendered.text()));
  } finally { rendered.cleanup(); }
});

test('a node that never executed is never labelled with an engine', async () => {
  const raw = structuredClone((fixture as Record<string, any>).details.succeeded);
  const node = raw.nodes[1];
  node.execution.actualEngine = null;
  node.execution.engineObservedAt = null;
  node.execution.failover = false;
  node.execution.failoverReason = null;
  node.execution.state = 'queued';
  const rendered = await render('outcome-node-section.tsx', { node });
  try {
    const text = rendered.text();
    assert.match(text, /Not started/);
    assert.ok(!/Ran on/.test(text), 'a pin is not evidence that anything ran');
  } finally { rendered.cleanup(); }
});

// ── 4. superseded shell ───────────────────────────────────────────────

test('a superseded shell says so, links to both authorities, and suppresses Run again', async () => {
  const lineage = parseLineageResponse((fixture as Record<string, any>).responses.lineageSupersededShell);
  assert.ok(lineage, 'the superseded lineage parses');
  assert.equal(lineage!.superseded, true);
  assert.equal(lineage!.suppressRunAgain, true, 'a settled success must not invite a duplicate');

  const rendered = await render('production-lineage-banner.tsx', { lineage });
  try {
    const text = rendered.text();
    assert.match(text, /This execution attempt was superseded by a related run\./);
    // Links to BOTH: the authoritative run and the parent production.
    assert.ok(rendered.document.querySelector(`a[href="/runs/${lineage!.authoritativeRunId}"]`),
      'links to the run that actually ran this step');
    assert.ok(rendered.document.querySelector(`a[href="/runs/productions/${lineage!.productionId}"]`),
      'links to the canonical production');
    // The authoritative run's real state is stated, not implied.
    assert.match(text, /completed/);
    assert.ok(!/this run stalled/i.test(text), 'the shell never gets the last word');
  } finally { rendered.cleanup(); }
});

test('the authoritative run points at its production without calling itself superseded', async () => {
  const lineage = parseLineageResponse((fixture as Record<string, any>).responses.lineageAuthoritative);
  assert.ok(lineage);
  assert.equal(lineage!.superseded, false);
  assert.equal(lineage!.isAuthoritative, true);

  const rendered = await render('production-lineage-banner.tsx', { lineage });
  try {
    assert.equal(rendered.document.querySelector('[aria-label="Superseded execution attempt"]'), null);
    assert.ok(rendered.queryByText(/Part of a production/));
    assert.ok(rendered.document.querySelector(`a[href="/runs/productions/${lineage!.productionId}"]`));
  } finally { rendered.cleanup(); }
});

test('a run outside any production renders no banner at all', async () => {
  assert.equal(parseLineageResponse((fixture as Record<string, any>).responses.lineageAbsent), null);
  const rendered = await render('production-lineage-banner.tsx', { lineage: null });
  try {
    assert.equal(rendered.text().trim(), '', 'nothing is claimed about a run with no lineage');
  } finally { rendered.cleanup(); }
});

test('a live production node still offers Run again — only a SETTLED success suppresses it', () => {
  const live = parseLineageResponse((fixture as Record<string, any>).lineages
    ? { ok: true, lineage: (fixture as Record<string, any>).lineages.liveNode } : null);
  assert.ok(live);
  assert.equal(live!.suppressRunAgain, false);
  assert.equal(live!.superseded, false);
});

// ── 5. failure ────────────────────────────────────────────────────────

test('agent 1 genuinely failed: agent 2 is RELEASED by the parent, not independently failed', async () => {
  // The sequential-failure shape: node 0 failed, so reconciliation released
  // node 1 rather than dispatching it. Node 1 never ran, so it has no engine,
  // no run, no steps — and the page must not invent any of them.
  const blocked = detail('blocked');
  const [first, second] = blocked.nodes;
  assert.equal(first.execution.outcomeLabel, 'failed');
  assert.equal(second.execution.grantState, 'released');
  assert.equal(second.execution.outcomeLabel, 'cancelled');
  assert.equal(second.execution.runId, null);
  assert.equal(second.execution.actualEngine, null);
  assert.equal(second.execution.creditsSpent, null, 'a released node was never billed');

  const failing = await renderNode('blocked', 0);
  try {
    const text = failing.text();
    assert.match(text, /Failed/);
    assert.ok(text.includes(first.execution.failureReason!), 'the typed failure renders on the agent that failed');
  } finally { failing.cleanup(); }

  const released = await renderNode('blocked', 1);
  try {
    const text = released.text();
    assert.match(text, /Released/, 'agent 2 reads as released by the parent');
    assert.ok(!/Failed/.test(text), 'agent 2 is never presented as having failed on its own');
    assert.ok(!/Ran on/.test(text), 'a node that never ran has no engine');
    assert.ok(text.includes(second.execution.failureReason!), 'and it says WHY it was released');
    assert.match(text, /Released8\//, 'its timestamp is when the parent released it, not a completion');
    assert.ok(!/ran \d+m/.test(text), 'a node that never ran has no duration');
    assert.equal(released.document.querySelector('a[href^="/runs/"]'), null, 'there is no run to link to');
  } finally { released.cleanup(); }

  // The handoff is the record that the artifact never moved.
  const handoff = blocked.handoffs[0];
  assert.equal(handoff.state, 'blocked');
  assert.equal(handoff.validationStatus, 'not_reached');
  assert.equal(handoff.artifactName, null, 'nothing was handed over, so nothing is named');
  const row = await render('outcome-handoff-row.tsx', { handoff });
  try {
    const text = row.text();
    assert.match(text, /did not succeed/);
    assert.match(text, /never produced/);
    assert.match(text, /Agent 2 released/);
  } finally { row.cleanup(); }

  // And the PARENT failure stays the authoritative account of the job.
  assert.equal(blocked.state, 'failed');
  assert.ok(blocked.blockers.length > 0);
  assert.equal(blocked.finalDeliverable, null);
});

test('a failed agent shows its typed failure; the next agent reads released, not failed', async () => {
  const failed = detail('failed');
  const first = await renderNode('failed', 0);
  try {
    const text = first.text();
    assert.match(text, /Failed/);
    assert.ok(text.includes(failed.nodes[0].execution.failureReason!),
      'the parent\'s typed reason renders verbatim on the agent that failed');
  } finally { first.cleanup(); }

  // The handoff records that agent 2 was blocked, not that it failed on its own.
  const handoff = failed.handoffs[0];
  assert.equal(handoff.state, 'blocked');
  assert.equal(handoff.validationStatus, 'not_reached');
  const row = await render('outcome-handoff-row.tsx', { handoff });
  try {
    assert.match(row.text(), /did not succeed|never produced|released/);
  } finally { row.cleanup(); }

  // And the parent failure stays the authoritative account.
  assert.equal(failed.state, 'failed');
  assert.ok(failed.blockers.length > 0);
  assert.equal(failed.finalDeliverable, null, 'a failed production claims no deliverable');
});

test('a partial production does not present its intermediate bundle as the deliverable', () => {
  const partial = detail('partial');
  assert.equal(partial.nodes[0].execution.outcomeLabel, 'succeeded');
  assert.equal(partial.nodes[1].execution.outcomeLabel, 'failed');
  assert.equal(partial.finalDeliverable, null,
    'agent 1\'s handed-over bundle is not the finished video');
});

test('live and failed nodes open by default; a quietly completed one does not', () => {
  const running = detail('running');
  assert.equal(nodeNeedsAttention(running.nodes[1]), true, 'the dispatched node earns attention');
  assert.equal(nodeNeedsAttention(detail('succeeded').nodes[0]), false);
  assert.equal(nodeNeedsAttention(detail('failed').nodes[0]), true);
});

// ── combined production trace ─────────────────────────────────────────

test('the production trace is chronological and every entry names its agent', async () => {
  const succeeded = detail('succeeded');
  const rendered = await render('outcome-production-trace.tsx', {
    trace: succeeded.trace, truncated: succeeded.traceTruncated,
  });
  try {
    const text = rendered.text();
    for (const label of ['Production started', 'Dispatched', 'Picked up', 'Output validated',
      'Completed', 'Receipt recorded']) {
      assert.ok(text.includes(label), `the trace shows "${label}"`);
    }
    // Node-scoped events are attributed; parent-level ones say so.
    assert.ok(text.includes('Agent 1') && text.includes('Agent 2'));
    assert.ok(text.includes('Production'), 'parent-level events are labelled too');
    // The failover is stated in the timeline, not only on the agent card.
    assert.match(text, /Codex was requested; executed with Claude/);

    const rows = [...rendered.document.querySelectorAll('ol > li')];
    assert.equal(rows.length, succeeded.trace.length, 'every persisted event renders');
  } finally { rendered.cleanup(); }
});

test('trace entries stay in the backend\'s order — the page never re-sorts them', async () => {
  const succeeded = detail('succeeded');
  const times = succeeded.trace.map((entry) => Date.parse(entry.at));
  assert.deepEqual(times, [...times].sort((a, b) => a - b));

  const rendered = await render('outcome-production-trace.tsx', { trace: succeeded.trace, truncated: false });
  try {
    const rows = [...rendered.document.querySelectorAll('ol > li')].map((li) => li.textContent || '');
    const firstAgentTwo = rows.findIndex((row) => row.includes('Agent 2'));
    const lastAgentOne = rows.map((row, i) => (row.includes('Agent 1') ? i : -1)).filter((i) => i >= 0).pop()!;
    assert.ok(lastAgentOne < firstAgentTwo, 'a sequential plan reads sequentially');
  } finally { rendered.cleanup(); }
});

test('an unknown event type renders its own name rather than vanishing', async () => {
  const trace = [
    ...detail('succeeded').trace,
    { at: '2026-08-16T10:30:00.000Z', type: 'some_future_event', source: 'outcome_production_events', ordinal: 1, detail: {} },
  ];
  const rendered = await render('outcome-production-trace.tsx', { trace, truncated: false });
  try {
    assert.match(rendered.text(), /some future event/);
  } finally { rendered.cleanup(); }
});
