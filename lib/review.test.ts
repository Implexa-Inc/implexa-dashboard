// node --test lib/review.test.ts
//
// The Review queue's honesty contract. Every test here guards the same failure:
// a surface that turns "we could not read this" into a calm, confident answer.
//
// The backend goes to real trouble to keep those apart — three-valued sources, a
// null issue count, an explicit truncated flag — and every bit of it is undone by a
// client that renders an empty list as "nothing to review". These are the tests that
// keep the last inch honest.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  reviewQueueWarning, canClaimAllClear, unresolvedIssueLabel, reasonLabel,
  primaryActionLabel, versionSummary, unavailableSources,
  type ReviewQueue, type ReviewQueueItem,
} from './review.ts';

const queue = (over: Partial<ReviewQueue> = {}): ReviewQueue => ({
  items: [], truncated: false, total: 0, visibleCount: 0,
  sources: { holds: 'ready', judgments: 'ready', sessions: 'ready', acceptance: 'ready', issueCounts: 'ready', deliveredOutputs: 'ready' },
  live: true, ...over,
});

const item = (over: Partial<ReviewQueueItem> = {}): ReviewQueueItem => ({
  rootRunId: 'root-1', latestRunId: 'run-1', slug: 'video-editor', reason: 'new_result',
  holdKind: null, judgeVerdict: null, unresolvedIssueCount: 0, versionCount: 1,
  lineageAvailable: true, latestAt: '2026-07-30T09:00:00Z', ...over,
});

// ── unavailable is never empty ──────────────────────────────────────────────

test('an empty queue with every source ready may claim all-clear', () => {
  const q = queue();
  assert.equal(reviewQueueWarning(q), null);
  assert.equal(canClaimAllClear(q), true);
});

test('REPRO: an unavailable source forbids the all-clear even with zero items', () => {
  // This is the exact live failure that shipped: holds was unavailable and the queue
  // rendered as though nothing needed review.
  const q = queue({ sources: { ...queue().sources, holds: 'unavailable' } });
  assert.equal(canClaimAllClear(q), false, 'an unreadable source must never read as "nothing to review"');
  assert.match(reviewQueueWarning(q)!, /couldn't check every source/i);
  assert.deepEqual(unavailableSources(q.sources), ['holds']);
});

test('an unreachable endpoint forbids the all-clear', () => {
  const q = queue({ live: false, sources: { review_endpoint: 'unavailable' } });
  assert.equal(canClaimAllClear(q), false);
  assert.match(reviewQueueWarning(q)!, /couldn't load your review queue/i);
});

test('a truncated list forbids the all-clear and says so first', () => {
  const q = queue({ truncated: true, items: [item()] });
  assert.match(reviewQueueWarning(q)!, /not complete/i);
  assert.equal(canClaimAllClear(q), false);
});

test('`disabled` is configuration, not failure — it does not raise a warning', () => {
  // The delivered-output source is fail-closed until REVIEW_ROLLOUT_CUTOFF is set.
  // Treating that as breakage would cry wolf on every deployment that hasn't enabled it.
  const q = queue({ sources: { ...queue().sources, deliveredOutputs: 'disabled' } });
  assert.equal(reviewQueueWarning(q), null);
  assert.equal(canClaimAllClear(q), true);
  assert.deepEqual(unavailableSources(q.sources), []);
});

// ── null unresolved count ───────────────────────────────────────────────────

test('REPRO: a null issue count reads as unavailable, never as zero', () => {
  assert.equal(unresolvedIssueLabel(null), 'Issue count unavailable');
  assert.equal(unresolvedIssueLabel(undefined), 'Issue count unavailable');
  // and the honest zero is still allowed to say zero
  assert.equal(unresolvedIssueLabel(0), 'No open issues');
  assert.equal(unresolvedIssueLabel(1), '1 open issue');
  assert.equal(unresolvedIssueLabel(4), '4 open issues');
  assert.notEqual(unresolvedIssueLabel(null), unresolvedIssueLabel(0),
    '"cannot count" and "none" must never render identically');
});

// ── source precedence / classification ──────────────────────────────────────

test('every backend classification keeps distinct copy', () => {
  const labels = ['new_result', 'in_review', 'judge', 'judge_repair_unattended', 'judge_repair_exhausted', 'approval']
    .map((r) => reasonLabel(r));
  assert.equal(new Set(labels).size, labels.length, 'no two reasons may render the same words');
});

test('judge_repair_unattended is NOT collapsed into judge', () => {
  // Its whole point is that nothing is acting on the run. If it read the same as a
  // plain Judge flag, the runs most in need of a human would look routine.
  assert.notEqual(reasonLabel('judge_repair_unattended'), reasonLabel('judge'));
  assert.match(reasonLabel('judge_repair_unattended'), /nothing is fixing it/i);
  assert.match(reasonLabel('judge_repair_exhausted'), /gave up/i);
});

test('an approval hold offers Approve next action, never Accept result', () => {
  assert.equal(primaryActionLabel({ reason: 'approval', holdKind: 'approval_before_action' }), 'Approve next action');
  // even if the reason were mislabelled, the hold kind alone must be enough
  assert.equal(primaryActionLabel({ reason: 'new_result', holdKind: 'approval_before_action' }), 'Approve next action');
  assert.equal(primaryActionLabel({ reason: 'new_result', holdKind: 'review_delivered_result' }), 'Review result');
});

// ── lineage ─────────────────────────────────────────────────────────────────

test('lineage is never guessed when it could not be computed', () => {
  assert.equal(versionSummary({ versionCount: null, lineageAvailable: false }), 'Version history unavailable');
  assert.equal(versionSummary({ versionCount: 5, lineageAvailable: false }), 'Version history unavailable');
  assert.equal(versionSummary({ versionCount: 1, lineageAvailable: true }), 'Original');
  assert.equal(versionSummary({ versionCount: 11, lineageAvailable: true }), '11 versions');
});

// ── the live stress fixture ─────────────────────────────────────────────────

test('the 11-version / 28-artifact production row renders without loss', () => {
  // Shape copied from the live queue payload for
  // ig-reel-avatar-b-roll-producer-proof-aware-retest.
  const real = item({
    rootRunId: '8fe1a734-d124-49a4-9011-5bd91a98aa40',
    latestRunId: '695352a5-2f9f-45d6-b6f7-188a7e6f1c5a',
    slug: 'ig-reel-avatar-b-roll-producer-proof-aware-retest',
    reason: 'new_result', holdKind: null, judgeVerdict: null,
    unresolvedIssueCount: 0, versionCount: 11, lineageAvailable: true,
  });
  assert.equal(versionSummary(real), '11 versions');
  assert.equal(primaryActionLabel(real), 'Review result');
  assert.equal(unresolvedIssueLabel(real.unresolvedIssueCount), 'No open issues');

  const q = queue({ items: [real], total: 12, visibleCount: 12 });
  assert.equal(canClaimAllClear(q), false, 'a queue with items is never all-clear');
  assert.equal(reviewQueueWarning(q), null, 'but it is complete, so no warning');
});

test('the live judge_repair_unattended row keeps its distinct classification', () => {
  // Also copied from live: final-video-editor-with-avatar-presenter, verdict=repair
  // with no repair request in flight.
  const real = item({ reason: 'judge_repair_unattended', judgeVerdict: 'repair', versionCount: 7 });
  assert.match(reasonLabel(real.reason), /nothing is fixing it/i);
  assert.equal(primaryActionLabel(real), 'Review result');
});

// ═════════════════════════════════════════════════════════════════════════════
// RESPONSE BOUNDARY. A 200 is not a contract.
//
// The readers used to COERCE whatever arrived into a valid-looking status —
// `items: null` became `[]`, a missing `sources` became `{}` — and with no source keys
// there is nothing to report as unavailable, so a malformed 200 rendered a confident
// "Nothing is waiting for your review." Every guarantee above was undone one layer
// below it. Parsing is now rejection.
// ═════════════════════════════════════════════════════════════════════════════

import { parseReviewQueueResponse, parseReviewPacketResponse, QUEUE_SOURCE_KEYS, PACKET_SOURCE_KEYS } from './review.ts';

const okSources = Object.fromEntries(QUEUE_SOURCE_KEYS.map((k) => [k, 'ready']));
const goodQueue = () => ({ ok: true, items: [], truncated: false, total: 0, visibleCount: 0, sources: { ...okSources } });

const okPacketSources = Object.fromEntries(PACKET_SOURCE_KEYS.map((k) => [k, 'ready']));
const goodPacket = () => ({
  ok: true,
  run: { id: 'run-1', slug: 's', runState: 'completed', status: 'completed', reviewStatus: 'pending', holdKind: null, startedAt: null },
  lineage: { rootRunId: 'run-1', versions: [] },
  artifacts: [], judgment: null, verification: { receipts: [] }, session: null, issues: [],
  sources: { ...okPacketSources },
});

test('a well-formed queue response parses', () => {
  const q = parseReviewQueueResponse(goodQueue());
  assert.notEqual(q, null);
  assert.equal(q!.live, true);
  assert.equal(canClaimAllClear(q!), true, 'a genuinely empty, fully-sourced queue may say all-clear');
});

test('REPRO: { ok: true, items: null, sources: {} } is UNAVAILABLE, not a live empty', () => {
  const parsed = parseReviewQueueResponse({ ok: true, items: null, sources: {} });
  assert.equal(parsed, null, 'a malformed 200 must not become a live status');
  // and the reader turns that into the honest empty
  const asStatus = parsed ?? { items: [], truncated: false, total: null, visibleCount: 0, sources: { review_endpoint: 'unavailable' as const }, live: false };
  assert.equal(asStatus.live, false);
  assert.equal(canClaimAllClear(asStatus), false, 'this is exactly the false all-clear the surface exists to prevent');
});

test('every mandatory queue field is required', () => {
  const cases: Array<[string, unknown]> = [
    ['items missing',      { ...goodQueue(), items: undefined }],
    ['items null',         { ...goodQueue(), items: null }],
    ['items not an array', { ...goodQueue(), items: {} }],
    ['sources missing',    { ...goodQueue(), sources: undefined }],
    ['sources empty',      { ...goodQueue(), sources: {} }],
    ['sources not object', { ...goodQueue(), sources: [] }],
    ['truncated missing',  { ...goodQueue(), truncated: undefined }],
    ['visibleCount missing', { ...goodQueue(), visibleCount: undefined }],
    ['total undefined',    { ...goodQueue(), total: undefined }],
    ['ok false',           { ...goodQueue(), ok: false }],
    ['ok missing',         { ...goodQueue(), ok: undefined }],
    ['not an object',      'nope'],
    ['null body',          null],
  ];
  for (const [why, body] of cases) {
    assert.equal(parseReviewQueueResponse(body), null, `${why} must be rejected`);
  }
});

test('a missing CONTRACTED source key is rejected; unknown extra keys are allowed', () => {
  for (const key of QUEUE_SOURCE_KEYS) {
    const body = goodQueue();
    delete (body.sources as Record<string, unknown>)[key];
    assert.equal(parseReviewQueueResponse(body), null, `dropping ${key} must be rejected — its absence is exactly how a gap hides`);
  }
  // forward compatible: the backend must be free to add a source
  const extra = { ...goodQueue(), sources: { ...okSources, someFutureSource: 'ready' } };
  assert.notEqual(parseReviewQueueResponse(extra), null);
});

test('an unknown source STATE is rejected, not passed through', () => {
  // A consumer testing `=== "unavailable"` would read "degraded" as healthy.
  for (const bad of ['degraded', 'partial', '', true, null, 1]) {
    const body = { ...goodQueue(), sources: { ...okSources, holds: bad } };
    assert.equal(parseReviewQueueResponse(body as never), null, `state ${JSON.stringify(bad)} must be rejected`);
  }
  for (const good of ['ready', 'unavailable', 'disabled']) {
    const body = { ...goodQueue(), sources: { ...okSources, holds: good } };
    assert.notEqual(parseReviewQueueResponse(body as never), null);
  }
});

test('total may be null (a source cap fired) but never absent', () => {
  assert.notEqual(parseReviewQueueResponse({ ...goodQueue(), total: null }), null);
  assert.notEqual(parseReviewQueueResponse({ ...goodQueue(), total: 12 }), null);
  assert.equal(parseReviewQueueResponse({ ...goodQueue(), total: '12' } as never), null);
});

// ── packet ──────────────────────────────────────────────────────────────────

test('a well-formed packet response parses', () => {
  const p = parseReviewPacketResponse(goodPacket());
  assert.notEqual(p, null);
  assert.equal(p!.live, true);
  assert.equal(p!.run!.id, 'run-1');
});

test('REPRO: a packet with a valid run but everything else missing is UNAVAILABLE', () => {
  // An "actionable empty review" — real run id, no artifacts, no issues, nothing marked
  // unavailable — tells the user their agent delivered nothing. That is a different and
  // much worse claim than "we could not load this".
  const parsed = parseReviewPacketResponse({ ok: true, run: { id: 'valid-run', slug: 's' } });
  assert.equal(parsed, null);
});

test('every mandatory packet field is required', () => {
  const cases: Array<[string, unknown]> = [
    ['run missing',        { ...goodPacket(), run: undefined }],
    ['run null',           { ...goodPacket(), run: null }],
    ['run without id',     { ...goodPacket(), run: { slug: 's' } }],
    ['artifacts missing',  { ...goodPacket(), artifacts: undefined }],
    ['artifacts null',     { ...goodPacket(), artifacts: null }],
    ['issues missing',     { ...goodPacket(), issues: undefined }],
    ['lineage missing',    { ...goodPacket(), lineage: undefined }],
    ['lineage without versions', { ...goodPacket(), lineage: { rootRunId: 'r' } }],
    ['verification missing', { ...goodPacket(), verification: undefined }],
    ['verification without receipts', { ...goodPacket(), verification: {} }],
    ['sources missing',    { ...goodPacket(), sources: undefined }],
    ['sources empty',      { ...goodPacket(), sources: {} }],
    ['judgment a string',  { ...goodPacket(), judgment: 'pass' }],
    ['session a string',   { ...goodPacket(), session: 'draft' }],
    ['ok false',           { ...goodPacket(), ok: false }],
  ];
  for (const [why, body] of cases) {
    assert.equal(parseReviewPacketResponse(body), null, `${why} must be rejected`);
  }
});

test('judgment and session are legitimately null, and that still parses', () => {
  assert.notEqual(parseReviewPacketResponse({ ...goodPacket(), judgment: null, session: null }), null);
  assert.notEqual(parseReviewPacketResponse({ ...goodPacket(), judgment: { verdict: 'pass' }, session: { id: 's', state: 'draft' } }), null);
});

test('a missing CONTRACTED packet source key is rejected', () => {
  for (const key of PACKET_SOURCE_KEYS) {
    const body = goodPacket();
    delete (body.sources as Record<string, unknown>)[key];
    assert.equal(parseReviewPacketResponse(body), null, `dropping ${key} must be rejected`);
  }
});

test('the LIVE payload shape parses — the parser matches production, not just the spec', () => {
  // Copied from the deployed endpoint.
  const live = {
    ok: true, items: [], truncated: false, visibleCount: 12, total: 12,
    sources: { acceptance: 'ready', deliveredOutputs: 'ready', holds: 'ready', issueCounts: 'ready', judgments: 'ready', sessions: 'ready' },
  };
  assert.notEqual(parseReviewQueueResponse(live), null, 'the real payload must satisfy the parser');

  const livePacket = {
    ok: true,
    run: { id: '695352a5-2f9f-45d6-b6f7-188a7e6f1c5a', slug: 'ig-reel', runState: 'completed', status: 'completed', reviewStatus: 'none', holdKind: null, startedAt: null },
    lineage: { rootRunId: '8fe1a734-d124-49a4-9011-5bd91a98aa40', versions: [{ runId: 'a', label: 'Original', runState: null, startedAt: null }] },
    artifacts: [{ id: 'a1', runId: 'r', relativePath: 'out/x.mp4', role: 'final_output', status: 'validated', sha256: 'a'.repeat(64), sizeBytes: 1, mtime: null, validatedAt: null }],
    judgment: { id: 'j', verdict: 'pass', summary: 's', nextAction: null, createdAt: null },
    verification: { receipts: [] }, session: null, issues: [],
    sources: { artifacts: 'ready', issues: 'ready', judgment: 'ready', lineage: 'ready', run: 'ready', session: 'ready', verification: 'ready' },
  };
  assert.notEqual(parseReviewPacketResponse(livePacket), null, 'the real packet must satisfy the parser');
});
