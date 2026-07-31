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

// ── artifact scoping ────────────────────────────────────────────────────────
//
// The live stress fixture carries 28 artifacts. Every issue belongs to exactly one of
// them, and the surface must respect that: an issue about video B shown over video A
// is anchored to bytes that are not on screen.

import { issuesForArtifact, artifactForIssue, isIssueStale, issueClickTarget } from './review-room-state.ts';

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const artifacts = [
  { id: 'artA', relativePath: 'out/videoA.mp4', sha256: SHA_A, status: 'validated' },
  { id: 'artB', relativePath: 'out/videoB.mp4', sha256: SHA_B, status: 'validated' },
];
const iss = (over: Record<string, unknown> = {}) => ({
  id: 'i1', artifactId: 'artA', status: 'draft',
  anchor: { type: 'media_time', artifactSha256: SHA_A, timeStartMs: 5000 },
  ...over,
}) as never;

test('REPRO: only the selected artifact\'s issues reach that artifact surface', () => {
  const all = [iss({ id: 'a1', artifactId: 'artA' }), iss({ id: 'b1', artifactId: 'artB' }), iss({ id: 'whole', artifactId: null })];
  assert.deepEqual(issuesForArtifact(all, 'artA').map((i: any) => i.id), ['a1'],
    "video B's issue must not be drawn on video A's timeline");
  assert.deepEqual(issuesForArtifact(all, 'artB').map((i: any) => i.id), ['b1']);
  // a whole-run comment has no position on any one timeline
  assert.deepEqual(issuesForArtifact(all, 'artA').map((i: any) => i.id).includes('whole'), false);
  assert.deepEqual(issuesForArtifact(all, null), []);
});

test('REPRO: staleness is measured against the issue\'s OWN artifact', () => {
  // An issue on B, viewed while A is selected, is NOT stale — its own file is unchanged.
  const onB = iss({ artifactId: 'artB', anchor: { type: 'media_time', artifactSha256: SHA_B, timeStartMs: 1 } });
  assert.equal(isIssueStale(onB, artifacts), false,
    'comparing against the selected artifact would flag a current comment as stale on every file switch');

  // genuinely stale: its own artifact's digest moved
  const changed = iss({ artifactId: 'artA', anchor: { type: 'media_time', artifactSha256: 'c'.repeat(64), timeStartMs: 1 } });
  assert.equal(isIssueStale(changed, artifacts), true);

  // its artifact is no longer validated
  assert.equal(isIssueStale(iss(), [{ id: 'artA', relativePath: 'x', sha256: SHA_A, status: 'declared' }]), true);
  // it names an artifact this packet does not contain
  assert.equal(isIssueStale(iss({ artifactId: 'gone' }), artifacts), true);
  // a whole-run comment cannot go stale against a file
  assert.equal(isIssueStale(iss({ artifactId: null }), artifacts), false);
});

test('REPRO: clicking an issue for another file SWITCHES before seeking', () => {
  const onB = iss({ artifactId: 'artB', anchor: { type: 'media_time', artifactSha256: SHA_B, timeStartMs: 9000 } });
  const t = issueClickTarget(onB, 'artA');
  assert.equal(t.needsSwitch, true, 'seeking now would move the WRONG player to that timestamp');
  assert.equal(t.artifactId, 'artB');
  assert.equal(t.seekMs, 9000);

  // same artifact: seek directly
  const sameFile = issueClickTarget(iss({ artifactId: 'artA' }), 'artA');
  assert.equal(sameFile.needsSwitch, false);
  assert.equal(sameFile.seekMs, 5000);

  // a non-media anchor has nothing to seek to
  const textIssue = issueClickTarget(iss({ anchor: { type: 'text_selection', startOffset: 3 } }), 'artA');
  assert.equal(textIssue.seekMs, null);
});

test('the rail can name the file each issue belongs to', () => {
  assert.equal(artifactForIssue(iss({ artifactId: 'artB' }), artifacts)!.relativePath, 'out/videoB.mp4');
  assert.equal(artifactForIssue(iss({ artifactId: null }), artifacts), null);
  assert.equal(artifactForIssue(iss({ artifactId: 'gone' }), artifacts), null);
});

test('the 28-artifact case: issues stay partitioned across many files', () => {
  const many = Array.from({ length: 28 }, (_, n) => ({ id: `art${n}`, relativePath: `out/f${n}.mp4`, sha256: SHA_A, status: 'validated' }));
  const all = many.map((a, n) => iss({ id: `i${n}`, artifactId: a.id }));
  for (let n = 0; n < 28; n += 1) {
    const scoped = issuesForArtifact(all, `art${n}`);
    assert.equal(scoped.length, 1, `art${n} must see exactly its own issue`);
    assert.equal((scoped[0] as any).id, `i${n}`);
  }
});
