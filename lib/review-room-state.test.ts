// node --test lib/review-room-state.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reviewRoomActions, ACCEPT_DISCLAIMER } from './review-room-state.ts';

const s = (over: Partial<Parameters<typeof reviewRoomActions>[0]> = {}) =>
  reviewRoomActions({ sessionState: 'draft', draftCount: 0, isApprovalHold: false, ...over });

// ── accepted session suppression ────────────────────────────────────────────

test('REPRO: an accepted session offers no further action and says so once', () => {
  const a = s({ sessionState: 'accepted', draftCount: 3 });
  assert.equal(a.canSubmit, false, 'an accepted result must not still offer to request fixes');
  assert.equal(a.canAccept, false, 'nor to accept it again');
  assert.equal(a.canEditIssues, false);
  assert.match(a.statusLine!, /You accepted this result/i);
});

test('a frozen session cannot be edited or resubmitted', () => {
  for (const st of ['submitting', 'submitted'] as const) {
    const a = s({ sessionState: st, draftCount: 2 });
    assert.equal(a.canSubmit, false, `${st} must not offer submit again`);
    assert.equal(a.canEditIssues, false, `${st} must not look editable — typed feedback could never reach the agent`);
    assert.equal(a.submitLabel, 'Revision queued');
    assert.ok(a.statusLine);
  }
});

// ── submit gating ───────────────────────────────────────────────────────────

test('submit is disabled with zero draft issues and enabled with any', () => {
  assert.equal(s({ draftCount: 0 }).canSubmit, false);
  assert.equal(s({ draftCount: 1 }).canSubmit, true);
  assert.equal(s({ draftCount: 4 }).submitLabel, 'Request fixes (4)');
});

// ── approval-before-action ──────────────────────────────────────────────────

test('REPRO: an approval hold never renders Accept result', () => {
  const a = s({ isApprovalHold: true, draftCount: 5 });
  assert.equal(a.canAccept, false, 'authorizing remaining work is a different question from accepting a result');
  assert.equal(a.showApproveNextAction, true);
  assert.equal(a.canSubmit, false);
  assert.match(a.statusLine!, /permission to continue/i);
});

test('a delivered result never renders Approve next action', () => {
  assert.equal(s({ draftCount: 1 }).showApproveNextAction, false);
  assert.equal(s({ sessionState: 'accepted' }).showApproveNextAction, false);
});

// ── no contradictory copy, exhaustively ─────────────────────────────────────

test('no state ever offers two contradictory actions at once', () => {
  const states: Array<'draft' | 'submitting' | 'submitted' | 'accepted' | 'dismissed' | null> =
    ['draft', 'submitting', 'submitted', 'accepted', 'dismissed', null];
  for (const sessionState of states) {
    for (const draftCount of [0, 1, 3]) {
      for (const isApprovalHold of [false, true]) {
        const a = reviewRoomActions({ sessionState, draftCount, isApprovalHold });

        // Accept and Approve answer different questions; offering both is incoherent.
        assert.equal(a.canAccept && a.showApproveNextAction, false,
          `${sessionState}/${draftCount}/${isApprovalHold}: offered Accept and Approve together`);
        // A terminal or frozen state must not also invite new work.
        if (a.statusLine && /accepted this result|Revision queued|were sent/i.test(a.statusLine)) {
          assert.equal(a.canSubmit, false, `${sessionState}: status says finished while submit is offered`);
        }
        // Submit is never offered without something to submit.
        if (a.canSubmit) assert.ok(draftCount > 0, 'submit offered with nothing to send');
        // Editing is never offered on a frozen/terminal session.
        if (a.canEditIssues) {
          assert.ok(!['submitting', 'submitted', 'accepted'].includes(String(sessionState)),
            `${sessionState}: issues look editable but cannot change`);
        }
      }
    }
  }
});

test('the accept disclaimer keeps human review distinct from Judge and verification', () => {
  assert.match(ACCEPT_DISCLAIMER, /doesn't change the Judge verdict/i);
  assert.match(ACCEPT_DISCLAIMER, /verified/i);
});
