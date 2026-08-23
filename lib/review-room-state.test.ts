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
  // Holds with and without drafts alike: authorizing remaining work is a different
  // question from accepting a delivered result.
  for (const draftCount of [0, 5]) {
    const a = s({ isApprovalHold: true, draftCount });
    assert.equal(a.canAccept, false, `hold with ${draftCount} drafts offered Accept`);
  }
});

test('an approval hold with nothing written still offers the gate', () => {
  const a = s({ isApprovalHold: true, draftCount: 0 });
  assert.equal(a.showApproveNextAction, true);
  assert.equal(a.canSubmit, false);
  assert.match(a.statusLine!, /permission to continue/i);
});

test('#129: drafts outrank the approval gate — Review Room owns sending them', () => {
  // The production failure: a reviewer with 14 written issues was shown "Approve next
  // action", which navigates to a run approval gate that does not carry their
  // feedback. Where a draft exists, the room owns the decision.
  const a = s({ isApprovalHold: true, draftCount: 5 });
  assert.equal(a.showApproveNextAction, false, 'the second approval gate was offered over written feedback');
  assert.equal(a.canSubmit, true);
  assert.equal(a.canEditIssues, true, 'a hold must not freeze feedback the reviewer is still writing');
});

test('a delivered result never renders Approve next action', () => {
  assert.equal(s({ draftCount: 1 }).showApproveNextAction, false);
  assert.equal(s({ sessionState: 'accepted' }).showApproveNextAction, false);
});

test('Approve next action is unreachable wherever a draft exists', () => {
  for (const sessionState of ['draft', 'submitting', 'submitted', 'accepted', null] as const) {
    for (const isApprovalHold of [false, true]) {
      for (const draftCount of [1, 14]) {
        assert.equal(
          reviewRoomActions({ sessionState, draftCount, isApprovalHold }).showApproveNextAction, false,
          `${sessionState}/${draftCount}/${isApprovalHold} offered a second approval page`,
        );
      }
    }
  }
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

// ── the cross-artifact seek race ────────────────────────────────────────────

import { shouldApplySeek, shouldDropPendingSeek } from './review-room-state.ts';

test('REPRO: a pending seek is NOT applied while the old artifact is still on screen', () => {
  // The exact intermediate render: selection has moved to B, but the preview still
  // belongs to A because setPreview(null) is not visible yet in the same flush.
  assert.equal(shouldApplySeek({
    pending: { artifactId: 'artB', seekMs: 9000 },
    selectedArtifactId: 'artB',
    readyPreviewArtifactId: 'artA',
  }), false, "this is the frame where the old code seeked A to B's timestamp and cleared the request");

  // and once B's preview is genuinely loaded, it applies
  assert.equal(shouldApplySeek({
    pending: { artifactId: 'artB', seekMs: 9000 },
    selectedArtifactId: 'artB',
    readyPreviewArtifactId: 'artB',
  }), true);
});

test('REPRO: a further switch cannot apply B\'s timestamp to C', () => {
  // user clicked an issue on B, then manually switched to C before B loaded
  assert.equal(shouldApplySeek({
    pending: { artifactId: 'artB', seekMs: 9000 },
    selectedArtifactId: 'artC',
    readyPreviewArtifactId: 'artC',
  }), false, 'identity travels with the request precisely so this cannot happen');
});

test('all three must agree — no two-out-of-three shortcut', () => {
  const cases: Array<[string, string | null, string | null, boolean]> = [
    // pendingFor, selected, ready, expected
    ['artB', 'artB', 'artB', true],
    ['artB', 'artB', 'artA', false],   // preview still the old file
    ['artB', 'artA', 'artB', false],   // selection moved away
    ['artB', 'artA', 'artA', false],   // request is stale
    ['artB', 'artB', null,   false],   // nothing loaded yet
    ['artB', null,   'artB', false],
  ];
  for (const [pendingFor, selected, ready, expected] of cases) {
    assert.equal(
      shouldApplySeek({ pending: { artifactId: pendingFor, seekMs: 1 }, selectedArtifactId: selected, readyPreviewArtifactId: ready }),
      expected,
      `pending=${pendingFor} selected=${selected} ready=${ready}`,
    );
  }
  assert.equal(shouldApplySeek({ pending: null, selectedArtifactId: 'artB', readyPreviewArtifactId: 'artB' }), false);
});

test('REPRO: a FAILED artifact A must not cancel a pending seek for B', () => {
  // The second instance of the same stale-state race, one variable over: the render
  // that carries selected=B still carries A's failure decision, and a cleanup effect
  // reading it in that flush cancelled B's perfectly valid request. B then opened
  // without seeking to its issue.
  assert.equal(shouldDropPendingSeek({
    pending: { artifactId: 'artB', seekMs: 9000 },
    selectedArtifactId: 'artB',
    failedArtifactId: 'artA',
  }), false, "A's failure says nothing about B");
});

test('a pending seek is retained while its OWN artifact is still loading', () => {
  assert.equal(shouldDropPendingSeek({
    pending: { artifactId: 'artB', seekMs: 1 }, selectedArtifactId: 'artB', failedArtifactId: null,
  }), false);
});

test('a pending seek is dropped when its OWN artifact fails', () => {
  assert.equal(shouldDropPendingSeek({
    pending: { artifactId: 'artB', seekMs: 1 }, selectedArtifactId: 'artB', failedArtifactId: 'artB',
  }), true, 'it can never load, and holding it would fire on some unrelated later load');
});

test("REPRO: B's failure must not decide C's fate", () => {
  // pending for C, selected C, but a stale failure decision still names B
  assert.equal(shouldDropPendingSeek({
    pending: { artifactId: 'artC', seekMs: 1 }, selectedArtifactId: 'artC', failedArtifactId: 'artB',
  }), false);
});

test('a pending seek is dropped when the user moves to a different artifact', () => {
  assert.equal(shouldDropPendingSeek({
    pending: { artifactId: 'artB', seekMs: 1 }, selectedArtifactId: 'artC', failedArtifactId: null,
  }), true, 'the request is moot either way');
  assert.equal(shouldDropPendingSeek({ pending: null, selectedArtifactId: 'artB', failedArtifactId: 'artB' }), false);
});

test('LIFECYCLE REPLAY: the batched switch->load sequence seeks the NEW player exactly once', () => {
  // A deterministic replay of the render/effect ordering the component goes through.
  // NOTE: this is a MODEL of the sequence, not the React runtime — this repo has no DOM
  // renderer, so the assembled component is still only exercised by hand (see the PR's
  // residual gates). What it does pin is that the GATE rejects the intermediate frame
  // and accepts exactly one later one.
  let selected = 'artA';
  let ready: string | null = 'artA';           // A's preview is loaded
  let pending: { artifactId: string; seekMs: number } | null = null;
  const seeks: Array<{ artifact: string | null; ms: number }> = [];

  const mediaReady = () => {
    if (shouldApplySeek({ pending, selectedArtifactId: selected, readyPreviewArtifactId: ready })) {
      seeks.push({ artifact: ready, ms: pending!.seekMs });
      pending = null;
    }
  };

  // 1. click an issue belonging to B: selection and request are batched together
  selected = 'artB';
  pending = { artifactId: 'artB', seekMs: 9000 };
  // 2. the intermediate frame — preview state still says A
  mediaReady();
  assert.deepEqual(seeks, [], 'must NOT seek while A is still the loaded preview');
  assert.notEqual(pending, null, 'and must NOT clear the request');
  // 3. the preview lifecycle clears, then B loads
  ready = null; mediaReady();
  assert.deepEqual(seeks, []);
  ready = 'artB'; mediaReady();
  assert.deepEqual(seeks, [{ artifact: 'artB', ms: 9000 }], 'seeks the NEW player, once');
  assert.equal(pending, null);
  // 4. a later loadedmetadata (e.g. a re-render) must not seek again
  mediaReady();
  assert.equal(seeks.length, 1, 'exactly once');
});

test('LIFECYCLE REPLAY: switching from a FAILED A to issue-linked B still seeks B', () => {
  // The full sequence the reviewer traced, replayed deterministically. A MODEL of the
  // ordering, not the React runtime (no DOM renderer here) — see the PR's residual gates.
  let selected = 'artA';
  let ready: string | null = null;                 // A never loaded
  let failed: string | null = 'artA';              // A's preview failed
  let pending: { artifactId: string; seekMs: number } | null = null;
  const seeks: Array<{ artifact: string | null; ms: number }> = [];

  const cleanup = () => {
    if (shouldDropPendingSeek({ pending, selectedArtifactId: selected, failedArtifactId: failed })) pending = null;
  };
  const mediaReady = () => {
    if (shouldApplySeek({ pending, selectedArtifactId: selected, readyPreviewArtifactId: ready })) {
      seeks.push({ artifact: ready, ms: pending!.seekMs });
      pending = null;
    }
  };

  // 1. click an issue on B while A is showing its failure
  selected = 'artB';
  pending = { artifactId: 'artB', seekMs: 4200 };
  // 2. the intermediate flush — `failed` still names A
  cleanup();
  assert.notEqual(pending, null, "A's stale failure must not cancel B's request");
  // 3. B's decision lands (loading), then B loads
  failed = null; cleanup();
  assert.notEqual(pending, null);
  ready = 'artB'; mediaReady();
  assert.deepEqual(seeks, [{ artifact: 'artB', ms: 4200 }], 'B seeks to its issue');
  assert.equal(pending, null);
});

test('LIFECYCLE REPLAY: when B itself fails, its request is dropped rather than left hanging', () => {
  let selected = 'artB';
  let failed: string | null = null;
  let pending: { artifactId: string; seekMs: number } | null = { artifactId: 'artB', seekMs: 1000 };
  const cleanup = () => {
    if (shouldDropPendingSeek({ pending, selectedArtifactId: selected, failedArtifactId: failed })) pending = null;
  };
  cleanup();
  assert.notEqual(pending, null, 'still loading');
  failed = 'artB'; cleanup();
  assert.equal(pending, null, 'B can never load, so the request must not survive to fire on a later one');
});

// ── initial artifact selection (clip deep links) ────────────────────────────

import { reconcileArtifactSelection, resolveInitialArtifact } from './review-room-state.ts';

test('a clip deep link opens on its artifact only when the packet contains it', () => {
  const reviewable = [{ id: 'artA' }, { id: 'artB' }];
  assert.equal(resolveInitialArtifact('artB', reviewable, 'artA'), 'artB');
});

test('a stale or foreign deep-link id falls back to the preferred artifact', () => {
  const reviewable = [{ id: 'artA' }];
  // A requested id the packet does not confirm is never trusted as a selection.
  assert.equal(resolveInitialArtifact('artZ', reviewable, 'artA'), 'artA');
  assert.equal(resolveInitialArtifact(null, reviewable, 'artA'), 'artA');
  assert.equal(resolveInitialArtifact('artZ', [], null), null);
});

test('late validated artifacts replace the mounted room\'s empty selection', () => {
  const reviewable = [{ id: 'artA' }];
  assert.equal(reconcileArtifactSelection(null, [], null), null);
  assert.equal(reconcileArtifactSelection(null, reviewable, 'artA'), 'artA');
});

test('packet refresh preserves a live user selection and replaces a vanished one', () => {
  const reviewable = [{ id: 'artA' }, { id: 'artB' }];
  assert.equal(reconcileArtifactSelection('artB', reviewable, 'artA'), 'artB');
  assert.equal(reconcileArtifactSelection('artZ', reviewable, 'artA'), 'artA');
});
