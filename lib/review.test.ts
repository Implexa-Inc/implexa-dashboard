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
