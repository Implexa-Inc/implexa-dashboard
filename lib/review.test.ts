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
  // Realistic: the lineage contains the run being viewed — the page derives its
  // "you are here" label by finding it there.
  lineage: { rootRunId: 'run-1', versions: [{ runId: 'run-1', label: 'Original', runState: null, startedAt: null }] },
  artifacts: [], judgment: null, verification: { receipts: [] }, production: null, session: null, issues: [], reviewArtifacts: [],
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

test('review-supplied artifacts are role-bound to durable packet artifacts', () => {
  const targetId = 'artifact-target';
  const supportId = 'artifact-support';
  const packet = {
    ...goodPacket(),
    artifacts: [
      { id: targetId, runId: 'run-1', relativePath: 'review-inputs/a/old.mp4', role: 'review_input', status: 'validated', sha256: 'a'.repeat(64) },
      { id: supportId, runId: 'run-1', relativePath: 'review-inputs/b/replacements.zip', role: 'review_attachment', status: 'validated', sha256: 'b'.repeat(64) },
    ],
    reviewArtifacts: [
      { artifactId: targetId, purpose: 'review_target', displayName: 'old.mp4', createdAt: '2026-08-12T00:00:00Z' },
      { artifactId: supportId, purpose: 'supporting', displayName: 'replacements.zip', createdAt: '2026-08-12T00:00:01Z' },
    ],
  };
  assert.notEqual(parseReviewPacketResponse(packet, 'run-1'), null);
  assert.equal(parseReviewPacketResponse({ ...packet, reviewArtifacts: [
    { ...packet.reviewArtifacts[0], purpose: 'supporting' }, packet.reviewArtifacts[1],
  ] }, 'run-1'), null, 'purpose cannot relabel a review target as supporting context');
  assert.equal(parseReviewPacketResponse({ ...packet, reviewArtifacts: [packet.reviewArtifacts[0], packet.reviewArtifacts[0]] }, 'run-1'), null,
    'one immutable artifact may not be represented twice');
});

test('an unavailable review-artifact source may not claim stale attachment rows', () => {
  const packet = goodPacket();
  packet.sources.review_artifacts = 'unavailable';
  assert.notEqual(parseReviewPacketResponse(packet, 'run-1'), null, 'explicit unavailable with no claimed rows stays honest');
  packet.artifacts = [{ id: 'a', runId: 'run-1', relativePath: 'x.zip', role: 'review_attachment', status: 'validated', sha256: 'a'.repeat(64) }];
  packet.reviewArtifacts = [{ artifactId: 'a', purpose: 'supporting', displayName: 'x.zip', createdAt: 'now' }];
  assert.equal(parseReviewPacketResponse(packet, 'run-1'), null);
});

const goodProduction = () => ({
  id: 'production-1', qualityMode: 'professional', planDigest: 'b'.repeat(64), fps: 30, totalFrames: 25566,
  finalRender: { ready: false, reasons: ['segment-02 is unresolved'] },
  segments: [
    {
      id: 'segment-01', label: 'Opening', ordinal: 0, state: 'preview_ready',
      writableRange: { startFrame: 0, endFrameExclusive: 3600 },
      previewRange: { startFrame: 0, endFrameExclusive: 3660 }, writableOffsetFrames: 0,
      artifact: { id: 'proxy-1', runId: 'worker-run-1', relativePath: '.implexa/segments/segment-01.mp4', role: 'review_proxy', status: 'validated', sha256: 'a'.repeat(64), sizeBytes: 1, mtime: null, validatedAt: null },
    },
    {
      id: 'segment-02', label: 'Middle', ordinal: 1, state: 'pending',
      writableRange: { startFrame: 3600, endFrameExclusive: 7200 },
      previewRange: null, writableOffsetFrames: null, artifact: null,
    },
  ],
});

test('a segment proxy is separately bound to its worker run and parses without entering the parent artifact ledger', () => {
  const parsed = parseReviewPacketResponse({ ...goodPacket(), production: goodProduction() }, 'run-1');
  assert.notEqual(parsed, null);
  assert.equal(parsed!.artifacts.length, 0);
  assert.equal(parsed!.production!.segments[0].artifact!.runId, 'worker-run-1');
  assert.equal(parsed!.production!.finalRender.ready, false);
});

test('malformed segment projections fail closed at the Review Room boundary', () => {
  const base = goodProduction();
  const cases: Array<[string, unknown]> = [
    ['preview-ready without proxy evidence', { ...base, segments: [{ ...base.segments[0], artifact: null }, base.segments[1]] }],
    ['proxy without validated digest', { ...base, segments: [{ ...base.segments[0], artifact: { ...base.segments[0].artifact, sha256: null } }, base.segments[1]] }],
    ['duplicate segment id', { ...base, segments: [base.segments[0], { ...base.segments[1], id: 'segment-01' }] }],
    ['incorrect writable offset', { ...base, segments: [{ ...base.segments[0], writableOffsetFrames: 12 }, base.segments[1]] }],
    ['pending segment carrying an artifact', { ...base, segments: [base.segments[0], { ...base.segments[1], artifact: base.segments[0].artifact }] }],
  ];
  for (const [why, production] of cases) {
    assert.equal(parseReviewPacketResponse({ ...goodPacket(), production }), null, why);
  }
});

test('rendering and qa-failed attempts retain bounded preview geometry without claiming a validated proxy', () => {
  for (const state of ['rendering', 'qa_failed'] as const) {
    const production = goodProduction();
    production.segments[0] = { ...production.segments[0], state, artifact: null };
    assert.notEqual(parseReviewPacketResponse({ ...goodPacket(), production }), null, state);
  }
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
  // When present they must be FULLY shaped — the UI renders every one of these fields.
  assert.notEqual(parseReviewPacketResponse({
    ...goodPacket(),
    judgment: { id: 'j1', verdict: 'pass', summary: 'looks good', nextAction: null, createdAt: null },
    session: { id: 's1', runId: 'run-1', state: 'draft', selectedArtifactId: null },
  }), null);
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
    lineage: { rootRunId: '8fe1a734-d124-49a4-9011-5bd91a98aa40', versions: [
      { runId: '8fe1a734-d124-49a4-9011-5bd91a98aa40', label: 'Original', runState: null, startedAt: null },
      { runId: '695352a5-2f9f-45d6-b6f7-188a7e6f1c5a', label: 'Revision 10', runState: null, startedAt: null },
    ] },
    artifacts: [{ id: 'a1', runId: '695352a5-2f9f-45d6-b6f7-188a7e6f1c5a', relativePath: 'out/x.mp4', role: 'final_output', status: 'validated', sha256: 'a'.repeat(64), sizeBytes: 1, mtime: null, validatedAt: null }],
    judgment: { id: 'j', verdict: 'pass', summary: 's', nextAction: null, createdAt: null },
    verification: { receipts: [] }, production: null, session: null, issues: [], reviewArtifacts: [],
    sources: { artifacts: 'ready', issues: 'ready', judgment: 'ready', lineage: 'ready', production: 'ready', reviewer_resolutions: 'ready', review_artifacts: 'ready', run: 'ready', session: 'ready', verification: 'ready', evidence: 'ready', submission: 'ready' },
  };
  assert.notEqual(parseReviewPacketResponse(livePacket, '695352a5-2f9f-45d6-b6f7-188a7e6f1c5a'), null,
    'the real packet must satisfy the parser, identity check included');
});

// ── nested field validation: the containers were checked, the contents were not ──

test('REPRO: items: [{}] is UNAVAILABLE, not a row', () => {
  // Array.isArray passed, so this rendered an agent named "undefined" linking to
  // /review/undefined — a dead row that looks like real review work.
  const parsed = parseReviewQueueResponse({ ...goodQueue(), items: [{}] });
  assert.equal(parsed, null);
});

test('a queue row must carry what the row USES — links, classification, counts', () => {
  const good = {
    rootRunId: 'root-1', latestRunId: 'run-1', slug: 'a', reason: 'new_result',
    holdKind: null, judgeVerdict: null, unresolvedIssueCount: 0, versionCount: 1,
    lineageAvailable: true, latestAt: null,
  };
  assert.notEqual(parseReviewQueueResponse({ ...goodQueue(), items: [good] }), null);

  const broken: Array<[string, Record<string, unknown>]> = [
    ['no latestRunId (the link target)', { ...good, latestRunId: undefined }],
    ['empty latestRunId',                { ...good, latestRunId: '' }],
    ['no rootRunId (the row key)',       { ...good, rootRunId: undefined }],
    ['no reason (the classification)',   { ...good, reason: undefined }],
    ['empty reason',                     { ...good, reason: '' }],
    ['count undefined, not null',        { ...good, unresolvedIssueCount: undefined }],
    ['count a string',                   { ...good, unresolvedIssueCount: '3' }],
    ['versionCount undefined',           { ...good, versionCount: undefined }],
    ['lineageAvailable missing',         { ...good, lineageAvailable: undefined }],
    ['lineageAvailable a string',        { ...good, lineageAvailable: 'yes' }],
    ['row not an object',                { ...good } && ('nope' as unknown as Record<string, unknown>)],
  ];
  for (const [why, row] of broken) {
    assert.equal(parseReviewQueueResponse({ ...goodQueue(), items: [row] }), null, `${why} must be rejected`);
  }
});

test('ONE malformed row poisons the read — it is not silently dropped', () => {
  const good = {
    rootRunId: 'r', latestRunId: 'l', slug: 'a', reason: 'judge', holdKind: null,
    judgeVerdict: 'blocked', unresolvedIssueCount: 0, versionCount: 1, lineageAvailable: true, latestAt: null,
  };
  // Dropping the bad one would under-report review work — the same lie as an empty list.
  assert.equal(parseReviewQueueResponse({ ...goodQueue(), items: [good, {}] }), null);
});

test('an unknown reason is accepted (forward compatible) but never downgraded', () => {
  const row = {
    rootRunId: 'r', latestRunId: 'l', slug: 'a', reason: 'some_future_reason', holdKind: null,
    judgeVerdict: null, unresolvedIssueCount: 0, versionCount: 1, lineageAvailable: true, latestAt: null,
  };
  assert.notEqual(parseReviewQueueResponse({ ...goodQueue(), items: [row] }), null,
    'a newer backend classification must not break an older client');
  assert.notEqual(reasonLabel('some_future_reason'), reasonLabel('new_result'),
    'but it must not be silently demoted to "New result" either');
  assert.equal(reasonLabel('some_future_reason'), 'Needs review');
});

// ── packet identity ─────────────────────────────────────────────────────────

test('REPRO: a valid-looking packet for a DIFFERENT run is UNAVAILABLE', () => {
  // Otherwise run B's artifacts, lineage and issues render under run A's heading, and
  // every action the user takes targets the wrong run.
  // Internally CONSISTENT packet for run B — its own lineage names run B. The only
  // thing wrong with it is that we asked for run A.
  const packetForB = {
    ...goodPacket(),
    run: { ...goodPacket().run, id: 'run-B' },
    lineage: { rootRunId: 'run-B', versions: [{ runId: 'run-B', label: 'Original', runState: null, startedAt: null }] },
  };
  assert.equal(parseReviewPacketResponse(packetForB, 'run-A'), null, 'identity mismatch must be refused');
  // and the matching case still parses
  assert.notEqual(parseReviewPacketResponse(packetForB, 'run-B'), null);
  // no expectation supplied -> no identity check (used by callers that have none)
  assert.notEqual(parseReviewPacketResponse(packetForB), null);
});

test('packet nested shapes are validated: artifacts, issues, versions, session', () => {
  const base = goodPacket();
  const cases: Array<[string, unknown]> = [
    ['artifact without id',        { ...base, artifacts: [{ runId: 'r', relativePath: 'a.mp4', status: 'validated', sha256: 'a'.repeat(64) }] }],
    ['artifact without path',      { ...base, artifacts: [{ id: 'a', runId: 'r', status: 'validated', sha256: 'a'.repeat(64) }] }],
    ['validated artifact with no digest', { ...base, artifacts: [{ id: 'a', runId: 'r', relativePath: 'a.mp4', status: 'validated', sha256: null }] }],
    ['artifact not an object',     { ...base, artifacts: ['a.mp4'] }],
    ['issue without anchor',       { ...base, issues: [{ id: 'i', sessionId: 's', runId: 'r', kind: 'timing', body: 'x', status: 'draft' }] }],
    ['issue without id',           { ...base, issues: [{ sessionId: 's', runId: 'r', kind: 'timing', body: 'x', status: 'draft', anchor: {} }] }],
    ['issue anchor not an object', { ...base, issues: [{ id: 'i', sessionId: 's', runId: 'r', kind: 'timing', body: 'x', status: 'draft', anchor: 'at 5s' }] }],
    ['version without runId',      { ...base, lineage: { rootRunId: 'r', versions: [{ label: 'Original' }] } }],
    ['version without label',      { ...base, lineage: { rootRunId: 'r', versions: [{ runId: 'r' }] } }],
    ['session without state',      { ...base, session: { id: 's' } }],
    ['session without id',         { ...base, session: { state: 'draft' } }],
  ];
  for (const [why, body] of cases) {
    assert.equal(parseReviewPacketResponse(body, 'run-1'), null, `${why} must be rejected`);
  }
});

test('a fully-populated valid packet still parses with all nested shapes present', () => {
  const full = {
    ...goodPacket(),
    artifacts: [{ id: 'a1', runId: 'run-1', relativePath: 'out/x.mp4', role: 'final_output', status: 'validated', sha256: 'a'.repeat(64), sizeBytes: 1, mtime: null, validatedAt: null }],
    issues: [{ id: 'i1', sessionId: 's1', runId: 'run-1', artifactId: 'a1', kind: 'timing', anchor: { version: 1, type: 'media_time', artifactSha256: 'a'.repeat(64), timeStartMs: 1000, timeEndMs: null }, body: 'fix', status: 'draft', submittedRequestId: null, createdAt: null, reviewerResolution: null }],
    lineage: { rootRunId: 'run-1', versions: [{ runId: 'run-1', label: 'Original', runState: null, startedAt: null }] },
    session: { id: 's1', runId: 'run-1', state: 'draft', selectedArtifactId: 'a1', submittedRequestId: null, submittedIssueIds: null, compiledBrief: null, acceptedAt: null },
  };
  const p = parseReviewPacketResponse(full, 'run-1');
  assert.notEqual(p, null);
  assert.equal(p!.artifacts.length, 1);
  assert.equal(p!.issues.length, 1);
});

// ── nested records must be BOUND to the requested run ───────────────────────
//
// Validating each record in isolation is not enough: a well-formed record belonging to
// a DIFFERENT run (or a different session of this run) renders under this run's
// heading, and every action taken on it targets the wrong thing.

const boundPacket = () => ({
  ...goodPacket(),
  artifacts: [{ id: 'a1', runId: 'run-1', relativePath: 'out/x.mp4', role: 'final_output', status: 'validated', sha256: 'a'.repeat(64), sizeBytes: 1, mtime: null, validatedAt: null }],
  session: { id: 's1', runId: 'run-1', state: 'draft', selectedArtifactId: 'a1' },
  issues: [{ id: 'i1', sessionId: 's1', runId: 'run-1', artifactId: 'a1', kind: 'timing', anchor: { version: 1, type: 'artifact', artifactSha256: 'a'.repeat(64) }, body: 'fix', status: 'draft', submittedRequestId: null, createdAt: null, reviewerResolution: null }],
});

test('the bound packet parses — the binding rules do not reject legitimate data', () => {
  assert.notEqual(parseReviewPacketResponse(boundPacket(), 'run-1'), null);
});

test('REPRO: an artifact, session or issue from ANOTHER run is rejected', () => {
  const cases: Array<[string, unknown]> = [
    ['artifact.runId is another run', { ...boundPacket(), artifacts: [{ ...boundPacket().artifacts[0], runId: 'run-B' }] }],
    ['session.runId is another run',  { ...boundPacket(), session: { ...boundPacket().session, runId: 'run-B' } }],
    ['issue.runId is another run',    { ...boundPacket(), issues: [{ ...boundPacket().issues[0], runId: 'run-B' }] }],
    ['session has no runId at all',   { ...boundPacket(), session: { id: 's1', state: 'draft' } }],
  ];
  for (const [why, body] of cases) {
    assert.equal(parseReviewPacketResponse(body, 'run-1'), null, `${why} must be rejected`);
  }
});

test('a carried issue from another session of this run is accepted with its original identity', () => {
  const body = { ...boundPacket(), issues: [{ ...boundPacket().issues[0], sessionId: 's-other' }] };
  const parsed = parseReviewPacketResponse(body, 'run-1');
  assert.ok(parsed);
  assert.equal(parsed.issues[0].sessionId, 's-other',
    'the next round carries the original issue ID/session instead of cloning it');
});

test('REPRO: issues cannot exist when there is no session', () => {
  const body = { ...boundPacket(), session: null };
  assert.equal(parseReviewPacketResponse(body, 'run-1'), null,
    'a rail of issues with no session cannot be edited, submitted or accepted');
  // and a genuinely session-less packet with no issues is fine
  assert.notEqual(parseReviewPacketResponse({ ...boundPacket(), session: null, issues: [] }, 'run-1'), null);
});

test('REPRO: a referenced artifact id must exist in the packet', () => {
  const orphanIssue = { ...boundPacket(), issues: [{ ...boundPacket().issues[0], artifactId: 'a-missing' }] };
  assert.equal(parseReviewPacketResponse(orphanIssue, 'run-1'), null,
    'an issue anchored to an absent artifact can never be seeked to or highlighted');
  const orphanSel = { ...boundPacket(), session: { ...boundPacket().session, selectedArtifactId: 'a-missing' } };
  assert.equal(parseReviewPacketResponse(orphanSel, 'run-1'), null);
  // a whole-file issue with no artifact reference is legitimate
  assert.notEqual(parseReviewPacketResponse({ ...boundPacket(), issues: [{ ...boundPacket().issues[0], artifactId: null }] }, 'run-1'), null);
});

test('REPRO: lineage must contain the requested run, with unique version ids', () => {
  const missing = { ...boundPacket(), lineage: { rootRunId: 'run-0', versions: [{ runId: 'run-0', label: 'Original' }] } };
  assert.equal(parseReviewPacketResponse(missing, 'run-1'), null,
    'the version switcher could not mark "you are here" and would offer only other runs');
  const dupes = { ...boundPacket(), lineage: { rootRunId: 'run-1', versions: [
    { runId: 'run-1', label: 'Original' }, { runId: 'run-1', label: 'Revision 1' },
  ] } };
  assert.equal(parseReviewPacketResponse(dupes, 'run-1'), null, 'two rows claiming to be the same version');
});

test('REPRO: an EMPTY lineage is malformed when sources.lineage is ready', () => {
  // A successful lineage always contains at least the run being viewed, as "Original".
  // Accepting empty here rendered a confident "No revisions yet." over a computation
  // that had actually failed or come back mis-shaped.
  const readyButEmpty = { ...boundPacket(), lineage: { rootRunId: 'run-1', versions: [] } };
  assert.equal(parseReviewPacketResponse(readyButEmpty, 'run-1'), null);

  // Empty IS honest when lineage could not be computed — that is what unavailable means.
  const unavailable = {
    ...boundPacket(),
    lineage: { rootRunId: null, versions: [] },
    sources: { ...okPacketSources, lineage: 'unavailable' },
  };
  assert.notEqual(parseReviewPacketResponse(unavailable, 'run-1'), null,
    'an unavailable lineage legitimately carries no versions');
});

// ── every field the UI actually renders ─────────────────────────────────────

test('REPRO: judgment: {} is rejected — it rendered "Judge: undefined"', () => {
  assert.equal(parseReviewPacketResponse({ ...boundPacket(), judgment: {} }, 'run-1'), null);
  const partial: Array<[string, unknown]> = [
    ['no verdict', { id: 'j', summary: 's' }],
    ['empty verdict', { id: 'j', verdict: '', summary: 's' }],
    ['no summary', { id: 'j', verdict: 'pass' }],
    ['no id', { verdict: 'pass', summary: 's' }],
  ];
  for (const [why, judgment] of partial) {
    assert.equal(parseReviewPacketResponse({ ...boundPacket(), judgment }, 'run-1'), null, `judgment ${why} must be rejected`);
  }
  assert.notEqual(parseReviewPacketResponse({ ...boundPacket(), judgment: { id: 'j', verdict: 'pass', summary: 'ok', nextAction: null, createdAt: null } }, 'run-1'), null);
});

test('REPRO: verification.receipts: [{}] is rejected — it rendered "undefined: undefined"', () => {
  assert.equal(parseReviewPacketResponse({ ...boundPacket(), verification: { receipts: [{}] } }, 'run-1'), null);
  for (const receipt of [{ id: 'r' }, { id: 'r', adapterKind: 'video_qa' }, { adapterKind: 'video_qa', status: 'pass' }, { id: 'r', adapterKind: '', status: 'pass' }]) {
    assert.equal(parseReviewPacketResponse({ ...boundPacket(), verification: { receipts: [receipt] } }, 'run-1'), null);
  }
  assert.notEqual(parseReviewPacketResponse({ ...boundPacket(), verification: { receipts: [{ id: 'r', adapterKind: 'video_qa', status: 'pass', createdAt: null }] } }, 'run-1'), null);
});

// ── a real digest ───────────────────────────────────────────────────────────

test('REPRO: a validated artifact with sha256: "" is rejected', () => {
  // "" is a string and passed the old typeof check. It anchors nothing: every issue
  // made against it would compare equal to an empty digest and never read as stale.
  for (const sha256 of ['', 'not-a-digest', 'a'.repeat(63), 'a'.repeat(65), 'g'.repeat(64), null, undefined]) {
    const body = { ...boundPacket(), artifacts: [{ ...boundPacket().artifacts[0], sha256 }] };
    assert.equal(parseReviewPacketResponse(body, 'run-1'), null, `validated artifact with sha256=${JSON.stringify(sha256)} must be rejected`);
  }
  // a real digest passes, in either case
  for (const sha256 of ['a'.repeat(64), 'A1B2'.repeat(16)]) {
    const body = { ...boundPacket(), artifacts: [{ ...boundPacket().artifacts[0], sha256 }] };
    assert.notEqual(parseReviewPacketResponse(body, 'run-1'), null);
  }
});

test('a DECLARED artifact may have no digest — it is not evidence yet', () => {
  const declared = { ...boundPacket(), artifacts: [{ id: 'a1', runId: 'run-1', relativePath: 'x.mp4', role: null, status: 'declared', sha256: null }] };
  assert.notEqual(parseReviewPacketResponse(declared, 'run-1'), null);
  // ...but a junk digest is still malformed
  const junk = { ...boundPacket(), artifacts: [{ id: 'a1', runId: 'run-1', relativePath: 'x.mp4', role: null, status: 'declared', sha256: 'nope' }] };
  assert.equal(parseReviewPacketResponse(junk, 'run-1'), null);
});
