// node --test lib/review-timestamp-feedback.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  beginRange, canEditIssue, canOfferRange, canReplaceDraft, completeRange, composerHeaderLabel,
  displayedSecond, draftFromIssue, draftIssuesAtSecond, draftMode, editAction,
  feedbackHereEditLabel, feedbackHereLabel, formatSeconds, openDraft, playheadFromEvent,
  pointCommentLabel, rangeEndButtonLabel, rangeEndError, rangeStartLabel, rangeSurvivesSelection,
  liveRangeError, replaceIssue, saveActionFor, saveDraftLabel, targetGuidance, targetLine,
  CANCEL_RANGE_LABEL, DRAFT_IN_PROGRESS, RANGE_END_BEFORE_START, SELECT_RANGE_LABEL,
  type FeedbackDraft, type FrozenTarget, type PendingRange, type RangeAttempt,
} from './review-timestamp-feedback.ts';
import * as feedbackModule from './review-timestamp-feedback.ts';
import { buildMediaAnchor, anchorError } from './review-anchor.ts';
import { resolveReviewAction } from './review-actions.ts';

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);

/** A delivered video, and a source file the agent was given to work from. */
const TARGETS: Record<string, FrozenTarget> = {
  artA: { artifactId: 'artA', sha256: SHA_A, relativePath: 'out/final.mp4', role: 'final_output' },
  artB: { artifactId: 'artB', sha256: SHA_B, relativePath: 'src/raw-take.mov', role: 'source' },
};

// ── a deterministic model of the room ───────────────────────────────────────
//
// A MODEL of the component's sequence, not the React runtime — this repo has no DOM
// renderer. What it pins is that the rules compose: the events a player actually fires,
// in the order it fires them, produce the labels the user sees and the anchor that gets
// saved. Every step below goes through the same pure functions the component calls.

type SavedCall = { action: string; issueId?: string; artifactId: string | null; anchor: any; body: string; kind: string };

function room(startOn: keyof typeof TARGETS = 'artA') {
  let selectedId: string | null = startOn;
  let target: FrozenTarget = TARGETS[startOn];
  let playheadMs: number | null = null;
  let draft: FeedbackDraft | null = null;
  let pendingRange: PendingRange = null;
  let issues: Array<Record<string, any>> = [];
  let refusal: string | null = null;
  const calls: SavedCall[] = [];
  let seq = 0;
  // `undefined` = no session yet. The FIRST write creates it, and which file it names
  // is the whole of finding 1 — session.selected_artifact_id is the only path the
  // compiled brief prints.
  let sessionArtifactId: string | null | undefined = undefined;
  // Only THAT something was pressed. The message shown is re-derived every read.
  let rangeAttempt: RangeAttempt = null;

  // Every media event goes through ONE path, exactly as the component wires it.
  const fire = (seconds: number, fromArtifactId = selectedId) => {
    const next = playheadFromEvent({
      eventArtifactId: fromArtifactId, selectedArtifactId: selectedId, seconds,
    });
    if (next !== null) playheadMs = next;
  };

  const api = {
    // the four events the player can move on
    loadedmetadata: (sec: number) => { fire(sec); return api; },
    timeupdate: (sec: number) => { fire(sec); return api; },
    seeked: (sec: number) => { fire(sec); return api; },
    pause: (sec: number) => { fire(sec); return api; },
    /** An event from a media element belonging to a DIFFERENT file. */
    strayEvent: (artifactId: string, sec: number) => { fire(sec, artifactId); return api; },

    hereIssues: () => draftIssuesAtSecond(issues as never, selectedId, playheadMs),
    pointLabel: () => pointCommentLabel({ playheadMs, existingCount: api.hereIssues().length }),
    rangeOffered: () => canOfferRange(playheadMs) && !pendingRange,
    playhead: () => playheadMs,
    draft: () => draft,
    range: () => pendingRange,
    issues: () => issues,
    calls: () => calls,
    refusal: () => refusal,
    sessionArtifact: () => sessionArtifactId,
    /** Accepting is session-level: it names the live selection, not a draft. */
    accept: () => { if (sessionArtifactId === undefined) sessionArtifactId = selectedId; return api; },

    pointComment: () => {
      refusal = null;
      if (!canReplaceDraft(draft)) { refusal = DRAFT_IN_PROGRESS; return api; }
      pendingRange = null;
      draft = openDraft({ target, playheadMs });
      return api;
    },
    selectRange: () => {
      refusal = null; rangeAttempt = null;
      if (!canReplaceDraft(draft)) { refusal = DRAFT_IN_PROGRESS; return api; }
      const begun = beginRange({ target, playheadMs });
      if (begun.error) { rangeAttempt = 'begin'; return api; }
      draft = null;
      pendingRange = begun.range;
      return api;
    },
    setEnd: () => {
      const done = completeRange(pendingRange, playheadMs);
      if (done.error || !done.draft) { rangeAttempt = 'end'; return api; }
      rangeAttempt = null;
      draft = done.draft;
      pendingRange = null;
      return api;
    },
    cancelRange: () => { pendingRange = null; rangeAttempt = null; refusal = null; return api; },
    /** What the room SHOWS right now — derived, exactly as the component derives it. */
    rangeError: () => liveRangeError({ attempt: rangeAttempt, range: pendingRange, playheadMs }),

    edit: (issueId: string) => {
      refusal = null;
      const issue = issues.find((i) => i.id === issueId);
      const next = draftFromIssue(issue as never, target);
      if (!next) { refusal = 'Only unsent feedback about the file you are viewing can be edited here.'; return api; }
      if (!canReplaceDraft(draft)) { refusal = DRAFT_IN_PROGRESS; return api; }
      pendingRange = null;
      draft = next;
      return api;
    },
    type: (body: string) => { draft = { ...(draft as FeedbackDraft), body }; return api; },
    cancel: () => { draft = null; refusal = null; return api; },

    switchArtifact: (artifactId: keyof typeof TARGETS) => {
      selectedId = artifactId; target = TARGETS[artifactId];
      // The component's preview effect: nothing per-file survives a switch.
      playheadMs = null; draft = null; pendingRange = null; refusal = null;
      return api;
    },
    /** Selection moves but the reset is NOT run — the defense-in-depth case. */
    selectWithoutReset: (artifactId: keyof typeof TARGETS) => {
      selectedId = artifactId; target = TARGETS[artifactId];
      return api;
    },

    save: () => {
      const d = draft!;
      // The component builds from the DRAFT's frozen digest, never the selected one.
      const anchor = d.anchorMs === null
        ? { version: 1, type: 'artifact', artifactSha256: d.target.sha256 }
        : buildMediaAnchor(d.target.sha256!, d.anchorMs / 1000, d.rangeEndMs === null ? null : d.rangeEndMs / 1000);
      const route = saveActionFor(d)!;
      const call: SavedCall = {
        action: route.action, artifactId: d.target.artifactId, anchor, body: d.body.trim(), kind: d.kind,
        ...(route.action === 'update_issue' ? { issueId: route.issueId } : {}),
      };
      calls.push(call);
      if (route.action === 'update_issue') {
        const existing = issues.find((i) => i.id === route.issueId)!;
        issues = replaceIssue(issues as never, route.issueId, { ...existing, kind: d.kind, anchor, body: d.body.trim() } as never);
      } else {
        // ensureSession(d.target.artifactId) — the FROZEN file, not the selection.
        if (sessionArtifactId === undefined) sessionArtifactId = d.target.artifactId;
        seq += 1;
        issues = [...issues, {
          id: `new-${seq}`, artifactId: d.target.artifactId, status: 'draft',
          kind: d.kind, anchor, body: d.body.trim(),
        }];
      }
      draft = null;
      return api;
    },
  };
  return api;
}

// ── THE PRODUCTION BUG (still closed) ───────────────────────────────────────

test('REPRO: the player shows 00:01 while a prior pause sat at 3.042s — the offer and the anchor are 1s', () => {
  const r = room()
    .loadedmetadata(0)
    .pause(3.042)      // the stale position the button used to keep
    .seeked(1.0);      // the visible playhead now

  assert.equal(r.playhead(), 1000);
  assert.equal(r.pointLabel(), '+ Point comment at 00:01',
    'the offer must name the visible second, not the last pause');

  r.pointComment().type('the caption lands late here').save();
  assert.equal(r.calls()[0].anchor.timeStartMs, 1000,
    'and the SAVED anchor must be 1s — 3042 is where the comment used to land');
  assert.equal(anchorError(r.calls()[0].anchor as never), null);
});

test('REPRO: seeking without ever pausing updates the offer', () => {
  const r = room().loadedmetadata(0).timeupdate(0.2).seeked(7.5);
  assert.equal(r.pointLabel(), '+ Point comment at 00:07');
  r.seeked(12.9);
  assert.equal(r.pointLabel(), '+ Point comment at 00:12', 'floor, so it matches the player readout');
});

test('every position event moves the playhead — no subset of them', () => {
  for (const event of ['loadedmetadata', 'timeupdate', 'seeked', 'pause'] as const) {
    const r = room().loadedmetadata(0);
    (r[event] as (s: number) => unknown)(4.25);
    assert.equal(r.playhead(), 4250, `${event} must be authoritative for the playhead`);
  }
});

// ── discoverability: two explicit choices ───────────────────────────────────

test('REPRO: point and range are two visible choices at the playhead, not one plus a secret', () => {
  const r = room().loadedmetadata(0).seeked(23.4);
  assert.equal(r.pointLabel(), '+ Point comment at 00:23');
  assert.equal(r.rangeOffered(), true, 'a range must be offered before you commit to a point');
  assert.equal(SELECT_RANGE_LABEL, 'Select a range');
  assert.equal(CANCEL_RANGE_LABEL, 'Cancel range');

  // With no media position there is nothing to range over, and the point offer says so.
  const still = room();
  assert.equal(still.pointLabel(), '+ Add feedback');
  assert.equal(canOfferRange(null), false);
  assert.equal(still.rangeOffered(), false);
});

test('the range offer withdraws while a range is already in progress', () => {
  const r = room().loadedmetadata(0).seeked(16.81).selectRange();
  assert.equal(r.rangeOffered(), false, 'two concurrent ranges is not a state this has');
  r.cancelRange();
  assert.equal(r.rangeOffered(), true);
});

// ── the point flow ──────────────────────────────────────────────────────────

test('REPRO: a point comment freezes artifact and time at the click', () => {
  const r = room().loadedmetadata(0).seeked(23.4).pointComment();
  const d = r.draft()!;
  assert.equal(draftMode(d), 'point');
  assert.equal(d.anchorMs, 23_400);
  assert.deepEqual(d.target, TARGETS.artA);
  assert.equal(composerHeaderLabel(d), 'Point comment · 00:23');

  // the clip plays on under the open composer, and the user scrubs too
  r.timeupdate(30).seeked(41.9);
  assert.equal(r.draft()!.anchorMs, 23_400, 'nothing about playback may move a draft that is already anchored');

  r.type('the logo pops in here').save();
  const call = r.calls()[0];
  assert.equal(call.anchor.timeStartMs, 23_400, 'saving reads the frozen value, not the player');
  assert.equal(call.anchor.timeEndMs, null, 'a point is a point');
  assert.equal(call.anchor.artifactSha256, SHA_A);
  assert.equal(call.artifactId, 'artA');
});

test('REPRO: cancelling clears the frozen anchor', () => {
  const r = room().loadedmetadata(0).seeked(1.0).pointComment().type('half a thought').cancel();
  assert.equal(r.draft(), null, 'a leftover anchor would silently claim the NEXT comment');
  r.seeked(5).pointComment();
  assert.equal(r.draft()!.anchorMs, 5000);
});

test('a draft with typed text is not silently discarded by another Add click', () => {
  const r = room().loadedmetadata(0).seeked(1.0).pointComment().type('important note');
  r.seeked(8).pointComment();
  assert.equal(r.refusal(), DRAFT_IN_PROGRESS);
  assert.equal(r.draft()!.anchorMs, 1000);
  assert.equal(r.draft()!.body, 'important note');

  // starting a RANGE must not discard it either
  r.selectRange();
  assert.equal(r.refusal(), DRAFT_IN_PROGRESS);
  assert.equal(r.range(), null);
  assert.equal(r.draft()!.body, 'important note');

  // an EMPTY composer has nothing to lose, so re-anchoring is what was asked for
  const empty = room().loadedmetadata(0).seeked(1).pointComment();
  empty.seeked(8).pointComment();
  assert.equal(empty.draft()!.anchorMs, 8000);
  assert.equal(empty.refusal(), null);
});

// ── the range flow ──────────────────────────────────────────────────────────

test('REPRO: the range start freezes while the end follows the playhead', () => {
  const r = room().loadedmetadata(0).seeked(16.81).selectRange();
  const range = r.range()!;
  assert.equal(range.startMs, 16_810);
  assert.deepEqual(range.target, TARGETS.artA, 'the file and its digest freeze with the start');
  assert.equal(rangeStartLabel(range), 'Start 00:16.810');

  // the end button tracks wherever the reviewer scrubs to
  assert.equal(rangeEndButtonLabel(r.playhead()), 'Set end at 00:16.810');
  r.seeked(20.5);
  assert.equal(rangeEndButtonLabel(r.playhead()), 'Set end at 00:20.500');
  r.timeupdate(23.778);
  assert.equal(rangeEndButtonLabel(r.playhead()), 'Set end at 00:23.778');
  assert.equal(r.range()!.startMs, 16_810, 'and the START has not moved a millisecond');

  r.setEnd();
  const d = r.draft()!;
  assert.equal(draftMode(d), 'range');
  assert.equal(r.range(), null, 'the range is complete; it is a draft now');
  assert.equal(composerHeaderLabel(d), 'Range comment · 00:16.810–00:23.778');

  r.type('this whole beat drags').save();
  const call = r.calls()[0];
  assert.equal(call.anchor.timeStartMs, 16_810);
  assert.equal(call.anchor.timeEndMs, 23_778, 'exact millisecond boundaries are stored');
  assert.equal(anchorError(call.anchor as never), null);
});

test('REPRO: an end at or before the start is refused without modifying anything', () => {
  const r = room().loadedmetadata(0).seeked(16.81).selectRange();
  const before = r.range();

  r.seeked(9).setEnd();
  assert.equal(r.rangeError(), RANGE_END_BEFORE_START);
  assert.equal(r.draft(), null, 'a refused end must not open a composer');
  assert.equal(r.range(), before, 'nor disturb the range in progress');

  // exactly equal is not a range either — it renders as one while marking nothing
  r.seeked(16.81).setEnd();
  assert.equal(r.rangeError(), RANGE_END_BEFORE_START);
  assert.equal(r.draft(), null);

  // one millisecond past the start IS a range
  r.seeked(16.811).setEnd();
  assert.equal(r.rangeError(), null);
  assert.equal(r.draft()!.rangeEndMs, 16_811);

  // and the pure rule, directly: a refusal hands back NO draft to assign
  const refused = completeRange({ target: TARGETS.artA, startMs: 5000 }, 2000);
  assert.equal(refused.draft, null, 'returning a half-built draft is how a rejected end gets stored anyway');
  assert.ok(refused.error);
  assert.ok(rangeEndError(null, 5000), 'a start is required first');
  assert.equal(rangeEndError(1000, 1001), null);
});

test('REPRO: the refusal clears as soon as the playhead becomes a valid end', () => {
  // Observed in production: `Start 00:00.000 → Set end at 03:42.147` with "The end of
  // the range must come after the start." still beside it. The reviewer had already
  // fixed it by scrubbing; the room was a stored string telling them they had not.
  // This is the surface's original bug in a third costume — a snapshot outliving the
  // live value it described.
  const r = room().loadedmetadata(0).selectRange();       // start frozen at 00:00.000
  r.setEnd();                                             // taken at 0 — equal, refused
  assert.equal(r.rangeError(), RANGE_END_BEFORE_START);

  r.timeupdate(222.147);                                  // scrub to 03:42.147
  assert.equal(r.rangeError(), null,
    'the sentence is a reading of the current state, not a note left by an earlier one');
  assert.equal(rangeEndButtonLabel(r.playhead()), 'Set end at 03:42.147');
  assert.notEqual(r.range(), null, 'and clearing the message must not clear the range');

  // it comes BACK if they scrub behind the start again, without another click
  r.seeked(0);
  assert.equal(r.rangeError(), RANGE_END_BEFORE_START);

  // and taking a valid end leaves nothing behind
  r.seeked(222.147).setEnd();
  assert.equal(r.rangeError(), null);
  assert.equal(r.draft()!.rangeEndMs, 222_147);
});

test('a refusal is shown only after an attempt, never pre-emptively', () => {
  // Deriving the message must not turn into nagging at a position nobody chose.
  const r = room().loadedmetadata(0).selectRange();
  assert.equal(r.rangeError(), null, 'the playhead is at the start, but nothing was pressed yet');
  assert.equal(liveRangeError({ attempt: null, range: { target: TARGETS.artA, startMs: 5000 }, playheadMs: 0 }), null);
  // cancelling clears the attempt with the range
  r.setEnd();
  assert.equal(r.rangeError(), RANGE_END_BEFORE_START);
  r.cancelRange();
  assert.equal(r.rangeError(), null);
});

test('a begin refusal clears the moment a position exists', () => {
  const r = room().selectRange();                 // no playhead at all
  assert.match(r.rangeError()!, /Move to the moment/);
  r.loadedmetadata(4);
  assert.equal(r.rangeError(), null, 'the complaint is obsolete the instant it is answered');
  // and the end-attempt case with no range in progress still says something true
  assert.match(liveRangeError({ attempt: 'end', range: null, playheadMs: 1000 })!, /no range in progress/i);
});

test('a range cannot be started without a position to start it at', () => {
  const r = room().selectRange();
  assert.equal(r.range(), null);
  assert.match(r.rangeError()!, /Move to the moment/);
  assert.equal(completeRange(null, 5000).draft, null);
});

test('REPRO: switching files cancels an unfinished range', () => {
  const r = room().loadedmetadata(0).seeked(16.81).selectRange();
  assert.notEqual(r.range(), null);
  r.switchArtifact('artB');
  assert.equal(r.range(), null, 'a start time from video A marks nothing in video B');
  assert.equal(r.playhead(), null);
  assert.equal(r.draft(), null);

  // and the rule that makes it true of the STATE, not just of the reset path
  assert.equal(rangeSurvivesSelection({ target: TARGETS.artA, startMs: 1 }, 'artA'), true);
  assert.equal(rangeSurvivesSelection({ target: TARGETS.artA, startMs: 1 }, 'artB'), false);
  assert.equal(rangeSurvivesSelection(null, 'artA'), false);
});

// ── file targeting ──────────────────────────────────────────────────────────

test('REPRO: the composer names the frozen file, not whatever is selected later', () => {
  const r = room('artA').loadedmetadata(0).seeked(5).pointComment().type('about the delivered cut');
  assert.equal(targetLine(r.draft()!.target), 'Feedback applies to: out/final.mp4');

  // selection moves to B WITHOUT the reset — the draft must still be about A
  r.selectWithoutReset('artB');
  const d = r.draft()!;
  assert.deepEqual(d.target, TARGETS.artA, 'a draft opened on A stays bound to A');
  assert.equal(targetLine(d.target), 'Feedback applies to: out/final.mp4');

  r.save();
  const call = r.calls()[0];
  assert.equal(call.artifactId, 'artA', "feedback from file A must never be recorded against file B");
  assert.equal(call.anchor.artifactSha256, SHA_A, 'the digest travels with the draft, not with the selector');
});

test('REPRO: a switch immediately before save must not open the session on the other file', () => {
  // Finding 1. The issue and its digest were already frozen, but the SESSION was still
  // created from the live selection — and session.selected_artifact_id is the ONLY
  // path the compiled brief prints ("Primary artifact: …"). So this sequence handed
  // the agent a brief headed with file B carrying nothing but comments about file A.
  const r = room('artA').loadedmetadata(0).seeked(12).pointComment().type('the cut is early here');
  r.selectWithoutReset('artB');   // the switch that used to decide the session
  r.save();

  assert.equal(r.sessionArtifact(), 'artA',
    'the session must name the file the issue is actually about');
  assert.equal(r.calls()[0].artifactId, 'artA');
  assert.equal(r.calls()[0].anchor.artifactSha256, SHA_A);
});

test('the session is opened once, by whichever write comes first', () => {
  // Two drafts on the same file: the second must not re-point the session.
  const r = room('artA').loadedmetadata(0).seeked(3).pointComment().type('one').save();
  assert.equal(r.sessionArtifact(), 'artA');
  r.switchArtifact('artB').loadedmetadata(0).seeked(4).pointComment().type('two').save();
  assert.equal(r.sessionArtifact(), 'artA', 'an existing session is reused, never re-created');
  assert.equal(r.calls()[1].artifactId, 'artB', 'while the issue still names its own file');
});

test('accepting names the live selection, because it is not about one draft', () => {
  const r = room('artA').loadedmetadata(0).seeked(3).accept();
  assert.equal(r.sessionArtifact(), 'artA');
  // and it never writes an issue
  assert.deepEqual(r.calls(), []);
});

test('a whole-run comment says so rather than naming a file it does not have', () => {
  assert.equal(targetLine({ artifactId: null, sha256: null, relativePath: null, role: null }),
    'Feedback applies to: the whole run');
  assert.equal(targetLine(null), 'Feedback applies to: the whole run');
});

test('REPRO: a source artifact shows the source/reference guidance, naming the file', () => {
  const r = room('artB').loadedmetadata(0).seeked(5).pointComment();
  const guidance = targetGuidance(r.draft()!.target)!;
  assert.match(guidance, /This is a source file/);
  assert.match(guidance, /applies to src\/raw-take\.mov/,
    'naming the file is the point — "this source" is what arrives ambiguously');
  assert.match(guidance, /say so in your own words and name the file you want changed/);
  assert.equal(targetLine(r.draft()!.target), 'Feedback applies to: src/raw-take.mov');
  // a source artifact with no path still gets guidance, without inventing a name
  assert.match(targetGuidance({ artifactId: 'x', sha256: SHA_B, relativePath: null, role: 'source' })!,
    /applies to this source file/);
});

test('REPRO: no canned reference-only sentence is offered while the brief names one file', () => {
  // Finding 2. A one-click "Use this section as reference; do not modify the source
  // file." was built and removed: the compiled brief prints ONE artifact path, so that
  // sentence can arrive under a heading naming a different file — reading as precise
  // while being wrong. The guidance says why the reviewer must name the files.
  const guidance = targetGuidance(TARGETS.artB)!;
  assert.equal(/Use this section as reference/.test(guidance), false,
    'a confident sentence in the wrong context is worse than no sentence');
  assert.match(guidance, /does not yet label each comment with its own file/,
    'the reviewer is told WHY they have to name it, not just that they should');
  // and there is no helper left to insert one
  assert.equal(Object.keys(feedbackModule).includes('withReferenceSentence'), false);
  assert.equal(Object.keys(feedbackModule).includes('REFERENCE_ONLY_SENTENCE'), false);
});

test('REPRO: an output artifact shows no such warning', () => {
  const r = room('artA').loadedmetadata(0).seeked(5).pointComment();
  assert.equal(targetGuidance(r.draft()!.target), null,
    'warning every comment about sources would train reviewers to ignore it');
  for (const role of ['final_output', 'review_proxy', 'receipt', 'qa_report', 'manifest', 'log', 'other', null]) {
    assert.equal(targetGuidance({ artifactId: 'x', sha256: SHA_A, relativePath: 'p', role }), null, `role=${role}`);
  }
});

test('reference-only intent is never inferred, and never stored as a field', () => {
  const r = room('artB').loadedmetadata(0).seeked(5).pointComment();
  // the guidance implies nothing about the draft
  assert.equal(r.draft()!.body, '');
  // no typed intent exists on a draft — the contract has nowhere to put one
  for (const invented of ['intent', 'referenceOnly', 'targetIntent', 'mode']) {
    assert.equal(Object.keys(r.draft()!).includes(invented), false,
      `${invented} would look structured and carry nothing`);
  }
  // reviewer text is passed through untouched, whatever it says
  r.type('Use src/raw-take.mov as reference only; change out/final.mp4.').save();
  assert.equal(r.calls()[0].body, 'Use src/raw-take.mov as reference only; change out/final.mp4.');
  assert.equal(Object.keys(r.calls()[0].anchor).includes('intent'), false,
    'the backend drops unknown anchor keys on a 200 — sending one would silently vanish');
});

// ── several comments at one moment (unchanged behaviour) ────────────────────

test('REPRO: a second comment at the same second is a NEW issue, never a merge', () => {
  const r = room().loadedmetadata(0).seeked(1.0)
    .pointComment().type('the music is too loud').save();

  assert.equal(r.hereIssues().length, 1);
  assert.equal(r.pointLabel(), '+ Add another point at 00:01', 'adding another must stay available and say so');
  assert.equal(feedbackHereLabel(1), '1 feedback here');

  r.timeupdate(1.42).pointComment().type('and the caption is mistimed').save();

  assert.equal(r.issues().length, 2, 'two distinct issues, nothing merged or overwritten');
  assert.equal(r.calls().filter((c) => c.action === 'create_issue').length, 2);
  assert.notEqual(r.issues()[0].id, r.issues()[1].id);
  assert.equal(r.hereIssues().length, 2);
  assert.equal(feedbackHereLabel(2), '2 feedback items here');
  assert.equal(feedbackHereEditLabel(0, 1), 'Edit');
  assert.deepEqual([feedbackHereEditLabel(0, 2), feedbackHereEditLabel(1, 2)], ['Edit 1', 'Edit 2']);
});

test('REPRO: same-second matching is scoped to the SELECTED artifact', () => {
  const at1s = (over: Record<string, unknown>) => ({
    id: 'x', artifactId: 'artA', status: 'draft',
    anchor: { type: 'media_time', artifactSha256: SHA_A, timeStartMs: 1200 }, body: '', kind: 'content',
    ...over,
  });
  const issues = [
    at1s({ id: 'a1' }),
    at1s({ id: 'b1', artifactId: 'artB', anchor: { type: 'media_time', artifactSha256: SHA_B, timeStartMs: 1400 } }),
    at1s({ id: 'whole', artifactId: null, anchor: { type: 'artifact', artifactSha256: SHA_A } }),
  ];
  assert.deepEqual(draftIssuesAtSecond(issues as never, 'artA', 1000).map((i: any) => i.id), ['a1'],
    "video B's comment must never be offered as editable at video A's playhead");
  assert.deepEqual(draftIssuesAtSecond(issues as never, 'artB', 1900).map((i: any) => i.id), ['b1']);
  assert.deepEqual(draftIssuesAtSecond(issues as never, 'artA', 2000), []);
  assert.deepEqual(draftIssuesAtSecond(issues as never, null, 1000), []);
  assert.deepEqual(draftIssuesAtSecond(issues as never, 'artA', null), []);
});

test('only DRAFT issues count as feedback here', () => {
  const mk = (status: string, id: string) => ({
    id, artifactId: 'artA', status,
    anchor: { type: 'media_time', artifactSha256: SHA_A, timeStartMs: 1000 },
  });
  const issues = [mk('draft', 'd'), mk('submitted', 's'), mk('dismissed', 'x'), mk('resolved', 'r')];
  assert.deepEqual(draftIssuesAtSecond(issues as never, 'artA', 1000).map((i: any) => i.id), ['d'],
    'offering an immutable issue as editable here promises an edit that cannot happen');
});

test('a stray event from another file cannot move this playhead', () => {
  const r = room().loadedmetadata(0).seeked(1.0);
  r.strayEvent('artB', 42);
  assert.equal(r.playhead(), 1000, "artifact B's position has no meaning on artifact A's timeline");
  assert.equal(playheadFromEvent({ eventArtifactId: 'artA', selectedArtifactId: 'artA', seconds: NaN }), null,
    'NaN before metadata is not a position and must not be reported as 00:00');
  assert.equal(playheadFromEvent({ eventArtifactId: null, selectedArtifactId: null, seconds: 3 }), null);
  assert.equal(playheadFromEvent({ eventArtifactId: 'artA', selectedArtifactId: 'artA', seconds: -2 }), 0);
});

// ── editing an existing draft (unchanged behaviour) ─────────────────────────

test('REPRO: editing saves through update_issue and REPLACES the item, never appends', () => {
  const r = room().loadedmetadata(0).seeked(1.0)
    .pointComment().type('the music is too loud').save();
  const original = r.issues()[0];

  r.edit(original.id);
  assert.equal(r.draft()!.body, 'the music is too loud');
  assert.equal(r.draft()!.anchorMs, 1000);
  assert.equal(r.draft()!.editingIssueId, original.id);
  assert.match(composerHeaderLabel(r.draft()), /^Editing · Point comment · 00:01$/);
  assert.equal(saveDraftLabel(r.draft()), 'Save changes');

  // the player has moved on since — the edit must keep the issue's OWN anchor
  r.seeked(20).type('the music is too loud under the VO').save();

  assert.equal(r.issues().length, 1, 'an edit that appends is the edit-as-create regression');
  assert.equal(r.issues()[0].id, original.id);
  assert.equal(r.issues()[0].body, 'the music is too loud under the VO');
  assert.equal(r.issues()[0].anchor.timeStartMs, 1000, 'the edit kept its own moment');

  const last = r.calls()[r.calls().length - 1];
  assert.equal(last.action, 'update_issue');
  assert.equal(last.issueId, original.id);
  assert.equal(r.calls().filter((c) => c.action === 'create_issue').length, 1, 'exactly one create, ever');
});

test('an edit cannot be opened against a file the issue is not about', () => {
  const onB = {
    id: 'i2', artifactId: 'artB', status: 'draft', kind: 'content', body: 'about B',
    anchor: { type: 'media_time', artifactSha256: SHA_B, timeStartMs: 1000 },
  };
  assert.equal(draftFromIssue(onB as never, TARGETS.artA), null,
    "opening B's comment against A would re-anchor it to A's bytes on save");
  assert.notEqual(draftFromIssue(onB as never, TARGETS.artB), null);
  // and the rail says what the affordance will actually do
  assert.deepEqual(editAction(onB as never, 'artA'), { label: 'Open to edit', opensElsewhere: true });
  assert.deepEqual(editAction(onB as never, 'artB'), { label: 'Edit', opensElsewhere: false });
});

test('update_issue reaches exactly one upstream call — a PATCH on that issue', () => {
  const target = resolveReviewAction('update_issue', {
    issueId: '11111111-2222-4333-8444-555555555555',
    kind: 'audio', body: 'x', anchor: { version: 1, type: 'artifact', artifactSha256: SHA_A },
  });
  assert.notEqual(typeof target, 'string');
  assert.equal((target as any).method, 'PATCH');
  assert.equal((target as any).path, '/api/v2/review/issues/11111111-2222-4333-8444-555555555555');
});

test('the save route is derived from the draft, not guessed at the call site', () => {
  assert.deepEqual(saveActionFor(openDraft({ target: TARGETS.artA, playheadMs: 1000 })), { action: 'create_issue' });
  const editing = draftFromIssue({
    id: 'i9', artifactId: 'artA', status: 'draft', kind: 'timing', body: 'b',
    anchor: { type: 'media_time', artifactSha256: SHA_A, timeStartMs: 1000, timeEndMs: null },
  } as never, TARGETS.artA);
  assert.deepEqual(saveActionFor(editing), { action: 'update_issue', issueId: 'i9' });
  assert.equal(saveActionFor(null), null);
});

test('REPRO: submitted, accepted and dismissed work cannot be edited', () => {
  for (const status of ['submitted', 'resolved', 'dismissed', 'accepted']) {
    const issue = {
      id: 'i1', artifactId: 'artA', status, kind: 'content', body: 'sent already',
      anchor: { type: 'media_time', artifactSha256: SHA_A, timeStartMs: 1000 },
    };
    assert.equal(canEditIssue(issue), false, `${status} is a record of work already acted on`);
    assert.equal(draftFromIssue(issue as never, TARGETS.artA), null);
    assert.equal(editAction(issue as never, 'artA'), null, 'no affordance for a promise we would refuse');
  }
  const draftIssue = {
    id: 'i1', artifactId: 'artA', status: 'draft', kind: 'content', body: 'unsent',
    anchor: { type: 'media_time', artifactSha256: SHA_A, timeStartMs: 1000 },
  };
  assert.equal(canEditIssue(draftIssue), true);
  assert.deepEqual(editAction(draftIssue as never, 'artA'), { label: 'Edit', opensElsewhere: false });
});

test('a non-draft issue cannot be loaded into the composer by any route', () => {
  const r = room().loadedmetadata(0).seeked(1.0).pointComment().type('note').save();
  const id = r.issues()[0].id;
  r.issues()[0].status = 'submitted';
  r.edit(id);
  assert.equal(r.draft(), null);
  assert.match(r.refusal()!, /Only unsent feedback/);
});

test('replaceIssue swaps in place and never appends', () => {
  const list = [{ id: 'a', body: '1' }, { id: 'b', body: '2' }, { id: 'c', body: '3' }];
  const next = replaceIssue(list, 'b', { id: 'b', body: 'edited' });
  assert.equal(next.length, 3, 'an update that grows the list is a duplicate');
  assert.deepEqual(next.map((i) => i.body), ['1', 'edited', '3']);
  const unchanged = replaceIssue(list, 'zz', { id: 'zz', body: 'stray' });
  assert.equal(unchanged.length, 3);
  assert.equal(unchanged, list);
});

test('an edit restores a range and a text selection intact', () => {
  const ranged = draftFromIssue({
    id: 'i3', artifactId: 'artA', status: 'draft', kind: 'timing', body: 'drags',
    anchor: { type: 'media_time', artifactSha256: SHA_A, timeStartMs: 16_810, timeEndMs: 23_778 },
  } as never, TARGETS.artA)!;
  assert.equal(ranged.anchorMs, 16_810);
  assert.equal(ranged.rangeEndMs, 23_778);
  assert.equal(composerHeaderLabel(ranged), 'Editing · Range comment · 00:16.810–00:23.778');

  const text = draftFromIssue({
    id: 'i4', artifactId: 'artA', status: 'draft', kind: 'content', body: 'typo',
    anchor: { type: 'text_selection', artifactSha256: SHA_A, startOffset: 12, endOffset: 30, quote: 'hello' },
  } as never, TARGETS.artA)!;
  assert.equal(text.anchorMs, null, 'a text comment anchors to characters, not to a time');
  assert.deepEqual(text.selection, { start: 12, end: 30, quote: 'hello' });
  assert.equal(composerHeaderLabel(text), 'Editing · Characters 12–30');
  assert.equal(draftMode(text), 'text');

  const whole = draftFromIssue({
    id: 'i5', artifactId: 'artA', status: 'draft', kind: 'other', body: 'general',
    anchor: { type: 'artifact', artifactSha256: SHA_A },
  } as never, TARGETS.artA)!;
  assert.equal(whole.anchorMs, null);
  assert.equal(composerHeaderLabel(whole), 'Editing · Whole file');
  assert.equal(draftMode(whole), 'whole');
});

// ── copy ────────────────────────────────────────────────────────────────────

test('the point-comment states read exactly as specified', () => {
  assert.equal(pointCommentLabel({ playheadMs: null }), '+ Add feedback');
  assert.equal(pointCommentLabel({ playheadMs: 23_400 }), '+ Point comment at 00:23');
  assert.equal(pointCommentLabel({ playheadMs: 23_400, existingCount: 0 }), '+ Point comment at 00:23');
  assert.equal(pointCommentLabel({ playheadMs: 23_400, existingCount: 1 }), '+ Add another point at 00:23');
  assert.equal(feedbackHereLabel(0), null);
  assert.equal(feedbackHereLabel(1), '1 feedback here');
  assert.equal(feedbackHereLabel(3), '3 feedback items here');
  // a position of zero is a position, and must not fall through to the no-media copy
  assert.equal(pointCommentLabel({ playheadMs: 0 }), '+ Point comment at 00:00');
});

test('a point shows whole seconds; a range shows the exact boundaries it claims', () => {
  assert.equal(formatSeconds(1042), '00:01');
  assert.equal(formatSeconds(1999), '00:01', 'a player reading 00:01 is at anything under 2s');
  assert.equal(formatSeconds(61_000), '01:01');
  assert.equal(formatSeconds(3_723_000), '01:02:03');
  assert.equal(formatSeconds(null), '00:00');
  assert.equal(displayedSecond(3042), 3);
  assert.equal(displayedSecond(null), null);
  assert.equal(displayedSecond(Number.NaN), null);

  assert.equal(rangeStartLabel({ target: TARGETS.artA, startMs: 3_723_042 }), 'Start 01:02:03.042');
  assert.equal(rangeEndButtonLabel(null), 'Set end');
  assert.equal(rangeStartLabel(null), '');

  // the draft keeps the exact value the point offer rounded for display
  const r = room().loadedmetadata(0).seeked(3.042).pointComment();
  assert.equal(r.pointLabel(), '+ Point comment at 00:03');
  assert.equal(r.draft()!.anchorMs, 3042, 'exact milliseconds are what the anchor is made of');
});

test('the composer header always states its mode and its frozen position', () => {
  assert.equal(composerHeaderLabel(openDraft({ target: TARGETS.artA, playheadMs: 1042 })), 'Point comment · 00:01');
  assert.equal(composerHeaderLabel(openDraft({ target: TARGETS.artA, playheadMs: null })), 'Whole file');
  assert.equal(composerHeaderLabel(null), '');
  assert.equal(saveDraftLabel(openDraft({ target: TARGETS.artA, playheadMs: 1 })), 'Save issue');
  assert.equal(draftMode(null), null);
});

test('a text selection opens a composer with no time claim', () => {
  const d = openDraft({ target: TARGETS.artA, playheadMs: 5000, selection: { start: 1, end: 4, quote: 'abc' } });
  assert.equal(d.anchorMs, null, 'a comment cannot be about a character range AND a moment');
  assert.equal(composerHeaderLabel(d), 'Characters 1–4');
});

test('canReplaceDraft protects typed text only', () => {
  assert.equal(canReplaceDraft(null), true);
  const empty = openDraft({ target: TARGETS.artA, playheadMs: 1000 });
  assert.equal(canReplaceDraft(empty), true);
  assert.equal(canReplaceDraft({ ...empty, body: '   ' }), true, 'whitespace is not written feedback');
  assert.equal(canReplaceDraft({ ...empty, body: 'x' }), false);
});

test('a draft copies its target rather than aliasing the live one', () => {
  const live: FrozenTarget = { ...TARGETS.artA };
  const d = openDraft({ target: live, playheadMs: 1000 });
  live.relativePath = 'out/something-else.mp4';
  assert.equal(d.target.relativePath, 'out/final.mp4', 'a shared reference would let the file change under the draft');

  const liveRange: FrozenTarget = { ...TARGETS.artA };
  const begun = beginRange({ target: liveRange, playheadMs: 1000 }).range!;
  liveRange.sha256 = SHA_B;
  assert.equal(begun.target.sha256, SHA_A);
});
