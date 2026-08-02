// node --test lib/review-timestamp-feedback.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addFeedbackLabel, canEditIssue, canReplaceDraft, canSetRangeEnd, composerHeaderLabel,
  displayedSecond, draftFromIssue, draftIssuesAtSecond, editAction, feedbackHereEditLabel,
  feedbackHereLabel, formatSeconds, openDraft, playheadFromEvent, rangeEndError, replaceIssue,
  saveActionFor, saveDraftLabel, withRangeEnd, DRAFT_IN_PROGRESS, type FeedbackDraft,
} from './review-timestamp-feedback.ts';
import { buildMediaAnchor, anchorError } from './review-anchor.ts';
import { resolveReviewAction } from './review-actions.ts';

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);

// ── a deterministic model of the room ───────────────────────────────────────
//
// A MODEL of the component's sequence, not the React runtime — this repo has no DOM
// renderer. What it pins is that the rules compose: the events a player actually fires,
// in the order it fires them, produce the label the user sees and the anchor that gets
// saved. Every step below goes through the same pure functions the component calls.

type SavedCall = { action: string; issueId?: string; anchor: unknown; body: string; kind: string };

function room(opts: { artifactId?: string; sha?: string } = {}) {
  let selectedId: string | null = opts.artifactId ?? 'artA';
  let sha = opts.sha ?? SHA_A;
  let playheadMs: number | null = null;
  let draft: FeedbackDraft | null = null;
  let issues: Array<Record<string, any>> = [];
  let refusal: string | null = null;
  const calls: SavedCall[] = [];
  let seq = 0;

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
    buttonLabel: () => addFeedbackLabel({ playheadMs, existingCount: api.hereIssues().length }),
    playhead: () => playheadMs,
    draft: () => draft,
    issues: () => issues,
    calls: () => calls,
    refusal: () => refusal,

    addFeedback: () => {
      refusal = null;
      if (!canReplaceDraft(draft)) { refusal = DRAFT_IN_PROGRESS; return api; }
      draft = openDraft({ artifactId: selectedId, playheadMs });
      return api;
    },
    edit: (issueId: string) => {
      refusal = null;
      const issue = issues.find((i) => i.id === issueId);
      const next = draftFromIssue(issue as never);
      if (!next) { refusal = 'Only unsent feedback can be edited.'; return api; }
      if (!canReplaceDraft(draft)) { refusal = DRAFT_IN_PROGRESS; return api; }
      draft = next;
      return api;
    },
    type: (body: string) => { draft = { ...(draft as FeedbackDraft), body }; return api; },
    setEnd: () => {
      const next = withRangeEnd(draft, playheadMs);
      refusal = next.error;
      if (!next.error) draft = next.draft;
      return api;
    },
    cancel: () => { draft = null; refusal = null; return api; },
    switchArtifact: (artifactId: string, nextSha = SHA_B) => {
      selectedId = artifactId; sha = nextSha;
      // The component's preview effect: playhead and draft do not survive a switch.
      playheadMs = null; draft = null; refusal = null;
      return api;
    },

    save: () => {
      const d = draft!;
      const anchor = d.anchorMs === null
        ? { version: 1, type: 'artifact', artifactSha256: sha }
        : buildMediaAnchor(sha, d.anchorMs / 1000, d.rangeEndMs === null ? null : d.rangeEndMs / 1000);
      const route = saveActionFor(d)!;
      const call: SavedCall = {
        action: route.action, anchor, body: d.body.trim(), kind: d.kind,
        ...(route.action === 'update_issue' ? { issueId: route.issueId } : {}),
      };
      calls.push(call);
      if (route.action === 'update_issue') {
        const existing = issues.find((i) => i.id === route.issueId)!;
        issues = replaceIssue(issues as never, route.issueId, { ...existing, kind: d.kind, anchor, body: d.body.trim() } as never);
      } else {
        seq += 1;
        issues = [...issues, {
          id: `new-${seq}`, artifactId: selectedId, status: 'draft',
          kind: d.kind, anchor, body: d.body.trim(),
        }];
      }
      draft = null;
      return api;
    },

    seed: (issue: Record<string, any>) => { issues = [...issues, issue]; return api; },
  };
  return api;
}

// ── THE PRODUCTION BUG ──────────────────────────────────────────────────────

test('REPRO: the player shows 00:01 while a prior pause sat at 3.042s — the offer and the anchor are 1s', () => {
  // Exactly what was on screen: paused at 00:03.042, then scrubbed back to 1s. The old
  // button read `pausedAtMs` and said "+ Add feedback at 00:03.042" — and meant it.
  const r = room()
    .loadedmetadata(0)
    .pause(3.042)      // the stale position the button used to keep
    .seeked(1.0);      // the visible playhead now

  assert.equal(r.playhead(), 1000, 'the authoritative playhead is where the user is looking');
  assert.equal(r.buttonLabel(), '+ Add feedback at 00:01',
    'the offer must name the visible second, not the last pause');

  r.addFeedback().type('the caption lands late here').save();
  const [call] = r.calls();
  assert.equal((call.anchor as any).timeStartMs, 1000,
    'and the SAVED anchor must be 1s — 3042 is where the comment used to land');
  assert.equal(anchorError(call.anchor as never), null);
});

test('REPRO: seeking without ever pausing updates the offer', () => {
  // A scrub fires `seeked`, not `pause`. Binding to pause alone is why a reviewer who
  // never paused was offered 00:00 (or whatever the last pause was) forever.
  const r = room().loadedmetadata(0).timeupdate(0.2).seeked(7.5);
  assert.equal(r.buttonLabel(), '+ Add feedback at 00:07');
  r.seeked(12.9);
  assert.equal(r.buttonLabel(), '+ Add feedback at 00:12', 'floor, so it matches the player readout');
});

test('every position event moves the playhead — no subset of them', () => {
  for (const event of ['loadedmetadata', 'timeupdate', 'seeked', 'pause'] as const) {
    const r = room().loadedmetadata(0);
    (r[event] as (s: number) => unknown)(4.25);
    assert.equal(r.playhead(), 4250, `${event} must be authoritative for the playhead`);
  }
});

// ── the frozen anchor ───────────────────────────────────────────────────────

test('REPRO: opening the composer FREEZES the anchor while playback keeps moving', () => {
  const r = room().loadedmetadata(0).seeked(1.0).addFeedback();
  const frozen = r.draft()!.anchorMs;
  assert.equal(frozen, 1000);

  // the clip plays on under the open composer, and the user scrubs too
  r.timeupdate(2.0).timeupdate(3.042).seeked(9.9);
  assert.equal(r.draft()!.anchorMs, 1000, 'nothing about playback may move a draft that is already anchored');
  assert.match(composerHeaderLabel(r.draft()), /At 00:01/);

  r.type('fix this frame').save();
  assert.equal((r.calls()[0].anchor as any).timeStartMs, 1000,
    'saving reads the frozen value, never the player at submission time');
});

test('a jump to another comment does not re-point the draft being written', () => {
  const r = room().loadedmetadata(0).seeked(1.0).addFeedback().type('note');
  r.seeked(30);   // clicking an existing issue seeks the player
  assert.equal(r.draft()!.anchorMs, 1000);
});

test('REPRO: cancelling clears the frozen anchor', () => {
  const r = room().loadedmetadata(0).seeked(1.0).addFeedback().type('half a thought').cancel();
  assert.equal(r.draft(), null, 'a leftover anchor would silently claim the NEXT comment');
  r.seeked(5).addFeedback();
  assert.equal(r.draft()!.anchorMs, 5000, 'the next composer freezes the CURRENT playhead');
});

test('REPRO: switching artifact clears the playhead and any in-progress composer', () => {
  const r = room().loadedmetadata(0).seeked(1.0).addFeedback().type('about video A');
  r.switchArtifact('artB');
  assert.equal(r.draft(), null, 'a composer carried across would attach to a moment in a different file');
  assert.equal(r.playhead(), null, 'and the new file has not reported a position yet');
  assert.equal(r.buttonLabel(), '+ Add feedback', 'with no media position, the offer names no time');
});

test('a draft with typed text is not silently discarded by another Add click', () => {
  const r = room().loadedmetadata(0).seeked(1.0).addFeedback().type('important note');
  r.seeked(8).addFeedback();
  assert.equal(r.refusal(), DRAFT_IN_PROGRESS);
  assert.equal(r.draft()!.anchorMs, 1000, 'the open draft keeps its anchor AND its text');
  assert.equal(r.draft()!.body, 'important note');

  // an EMPTY composer has nothing to lose, so re-anchoring is what was asked for
  const empty = room().loadedmetadata(0).seeked(1).addFeedback();
  empty.seeked(8).addFeedback();
  assert.equal(empty.draft()!.anchorMs, 8000);
  assert.equal(empty.refusal(), null);
});

// ── ranges ──────────────────────────────────────────────────────────────────

test('REPRO: an end at or before the start is refused', () => {
  const r = room().loadedmetadata(0).seeked(5).addFeedback();
  r.seeked(2).setEnd();
  assert.match(r.refusal()!, /must come after the start/);
  assert.equal(r.draft()!.rangeEndMs, null, 'a refused end must not be stored');

  // exactly equal is not a range either — it renders as one while marking nothing
  r.seeked(5).setEnd();
  assert.match(r.refusal()!, /must come after the start/);
  assert.equal(r.draft()!.rangeEndMs, null);

  // The refusal returns the draft ITSELF, unchanged. A caller that assigns the returned
  // draft unconditionally must still not end up storing a rejected end.
  const open = openDraft({ artifactId: 'artA', playheadMs: 5000 });
  const refused = withRangeEnd(open, 2000);
  assert.ok(refused.error);
  assert.equal(refused.draft, open, 'a refused end must leave the draft exactly as it was');
  assert.equal(refused.draft!.rangeEndMs, null);

  assert.equal(rangeEndError(1000, 1001), null);
  assert.equal(canSetRangeEnd(r.draft(), 2000), false);
  assert.equal(canSetRangeEnd(r.draft(), 9000), true);
  assert.equal(canSetRangeEnd(null, 9000), false, 'nothing to set an end for');
  assert.ok(rangeEndError(null, 5000), 'a start is required first');
});

test('a valid end is captured at exact milliseconds and displayed as a range', () => {
  const r = room().loadedmetadata(0).seeked(1.25).addFeedback();
  r.seeked(4.875).setEnd();
  assert.equal(r.refusal(), null);
  assert.equal(r.draft()!.anchorMs, 1250, 'setting an end must not move the start');
  assert.equal(r.draft()!.rangeEndMs, 4875, 'exact milliseconds are retained internally');
  assert.equal(composerHeaderLabel(r.draft()), 'At 00:01 – 00:04');

  r.type('this whole beat drags').save();
  const anchor = r.calls()[0].anchor as any;
  assert.equal(anchor.timeStartMs, 1250);
  assert.equal(anchor.timeEndMs, 4875);
  assert.equal(anchorError(anchor), null);
});

// ── several comments at one moment ──────────────────────────────────────────

test('REPRO: a second comment at the same second is a NEW issue, never a merge', () => {
  const r = room().loadedmetadata(0).seeked(1.0)
    .addFeedback().type('the music is too loud').save();

  assert.equal(r.hereIssues().length, 1);
  assert.equal(r.buttonLabel(), '+ Add another at 00:01', 'adding another must stay available and say so');
  assert.equal(feedbackHereLabel(1), '1 feedback here');

  // slightly different exact position, same DISPLAYED second — this is the case that
  // used to feel like an overwrite
  r.timeupdate(1.42).addFeedback().type('and the caption is mistimed').save();

  assert.equal(r.issues().length, 2, 'two distinct issues, nothing merged or overwritten');
  assert.equal(r.calls().filter((c) => c.action === 'create_issue').length, 2);
  assert.notEqual(r.issues()[0].id, r.issues()[1].id);
  assert.equal(r.hereIssues().length, 2);
  assert.equal(feedbackHereLabel(2), '2 feedback items here');
  assert.equal(r.buttonLabel(), '+ Add another at 00:01');
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
  // different second, same file
  assert.deepEqual(draftIssuesAtSecond(issues as never, 'artA', 2000), []);
  // nothing selected, or no media position at all
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

// ── editing an existing draft ───────────────────────────────────────────────

test('REPRO: editing saves through update_issue and REPLACES the item, never appends', () => {
  const r = room().loadedmetadata(0).seeked(1.0)
    .addFeedback().type('the music is too loud').save();
  const original = r.issues()[0];

  r.edit(original.id);
  // the body, kind AND anchor come back
  assert.equal(r.draft()!.body, 'the music is too loud');
  assert.equal(r.draft()!.anchorMs, 1000);
  assert.equal(r.draft()!.editingIssueId, original.id);
  assert.match(composerHeaderLabel(r.draft()), /^Editing · At 00:01$/);
  assert.equal(saveDraftLabel(r.draft()), 'Save changes');

  // the player has moved on since — the edit must keep the issue's OWN anchor
  r.seeked(20).type('the music is too loud under the VO').save();

  assert.equal(r.issues().length, 1, 'an edit that appends is the edit-as-create regression');
  assert.equal(r.issues()[0].id, original.id);
  assert.equal(r.issues()[0].body, 'the music is too loud under the VO');
  assert.equal((r.issues()[0].anchor as any).timeStartMs, 1000, 'the edit kept its own moment');

  const last = r.calls()[r.calls().length - 1];
  assert.equal(last.action, 'update_issue');
  assert.equal(last.issueId, original.id);
  assert.equal(r.calls().filter((c) => c.action === 'create_issue').length, 1, 'exactly one create, ever');
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
  assert.deepEqual(saveActionFor(openDraft({ artifactId: 'artA', playheadMs: 1000 })), { action: 'create_issue' });
  const editing = draftFromIssue({
    id: 'i9', artifactId: 'artA', status: 'draft', kind: 'timing', body: 'b',
    anchor: { type: 'media_time', artifactSha256: SHA_A, timeStartMs: 1000, timeEndMs: null },
  });
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
    assert.equal(draftFromIssue(issue as never), null);
    assert.equal(editAction(issue as never, 'artA'), null, 'no affordance for a promise we would refuse');
  }
  const draftIssue = {
    id: 'i1', artifactId: 'artA', status: 'draft', kind: 'content', body: 'unsent',
    anchor: { type: 'media_time', artifactSha256: SHA_A, timeStartMs: 1000 },
  };
  assert.equal(canEditIssue(draftIssue), true);
  assert.deepEqual(editAction(draftIssue as never, 'artA'), { label: 'Edit', opensElsewhere: false });
});

test("a draft on ANOTHER file offers to open that file, not an editor over this one", () => {
  const onB = {
    id: 'i2', artifactId: 'artB', status: 'draft', kind: 'content', body: 'about B',
    anchor: { type: 'media_time', artifactSha256: SHA_B, timeStartMs: 1000 },
  };
  assert.deepEqual(editAction(onB as never, 'artA'), { label: 'Open to edit', opensElsewhere: true });
  assert.deepEqual(editAction(onB as never, 'artB'), { label: 'Edit', opensElsewhere: false });
});

test('a non-draft issue cannot be loaded into the composer by any route', () => {
  const r = room().loadedmetadata(0).seeked(1.0)
    .addFeedback().type('note').save();
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
  // an id that is not here does not belong here
  const unchanged = replaceIssue(list, 'zz', { id: 'zz', body: 'stray' });
  assert.equal(unchanged.length, 3);
  assert.equal(unchanged, list);
});

test('an edit restores a range and a text selection intact', () => {
  const ranged = draftFromIssue({
    id: 'i3', artifactId: 'artA', status: 'draft', kind: 'timing', body: 'drags',
    anchor: { type: 'media_time', artifactSha256: SHA_A, timeStartMs: 1250, timeEndMs: 4875 },
  })!;
  assert.equal(ranged.anchorMs, 1250);
  assert.equal(ranged.rangeEndMs, 4875);
  assert.equal(composerHeaderLabel(ranged), 'Editing · At 00:01 – 00:04');

  const text = draftFromIssue({
    id: 'i4', artifactId: 'artA', status: 'draft', kind: 'content', body: 'typo',
    anchor: { type: 'text_selection', artifactSha256: SHA_A, startOffset: 12, endOffset: 30, quote: 'hello' },
  })!;
  assert.equal(text.anchorMs, null, 'a text comment anchors to characters, not to a time');
  assert.deepEqual(text.selection, { start: 12, end: 30, quote: 'hello' });
  assert.equal(composerHeaderLabel(text), 'Editing · Characters 12–30');

  const whole = draftFromIssue({
    id: 'i5', artifactId: 'artA', status: 'draft', kind: 'other', body: 'general',
    anchor: { type: 'artifact', artifactSha256: SHA_A },
  })!;
  assert.equal(whole.anchorMs, null);
  assert.equal(composerHeaderLabel(whole), 'Editing · Whole file');
});

// ── copy ────────────────────────────────────────────────────────────────────

test('the four button states read exactly as specified', () => {
  assert.equal(addFeedbackLabel({ playheadMs: null }), '+ Add feedback');
  assert.equal(addFeedbackLabel({ playheadMs: 1000 }), '+ Add feedback at 00:01');
  assert.equal(addFeedbackLabel({ playheadMs: 1042, existingCount: 0 }), '+ Add feedback at 00:01');
  assert.equal(addFeedbackLabel({ playheadMs: 1042, existingCount: 1 }), '+ Add another at 00:01');
  assert.equal(feedbackHereLabel(0), null);
  assert.equal(feedbackHereLabel(1), '1 feedback here');
  assert.equal(feedbackHereLabel(3), '3 feedback items here');
  // a position of zero is a position, and must not fall through to the no-media copy
  assert.equal(addFeedbackLabel({ playheadMs: 0 }), '+ Add feedback at 00:00');
});

test('users see whole seconds while milliseconds survive underneath', () => {
  assert.equal(formatSeconds(1042), '00:01');
  assert.equal(formatSeconds(1999), '00:01', 'a player reading 00:01 is at anything under 2s');
  assert.equal(formatSeconds(61_000), '01:01');
  assert.equal(formatSeconds(3_723_000), '01:02:03');
  assert.equal(formatSeconds(null), '00:00');
  assert.equal(displayedSecond(3042), 3);
  assert.equal(displayedSecond(null), null);
  assert.equal(displayedSecond(Number.NaN), null);

  // the draft keeps the exact value the offer rounded for display
  const r = room().loadedmetadata(0).seeked(3.042).addFeedback();
  assert.equal(r.buttonLabel(), '+ Add feedback at 00:03');
  assert.equal(r.draft()!.anchorMs, 3042, 'exact milliseconds are what the anchor is made of');
});

test('the composer header always states the frozen position', () => {
  assert.equal(composerHeaderLabel(openDraft({ artifactId: 'artA', playheadMs: 1042 })), 'At 00:01');
  assert.equal(composerHeaderLabel(openDraft({ artifactId: 'artA', playheadMs: null })), 'Whole file');
  assert.equal(composerHeaderLabel(null), '');
  assert.equal(saveDraftLabel(openDraft({ artifactId: 'artA', playheadMs: 1 })), 'Save issue');
});

test('a text selection opens a composer with no time claim', () => {
  const d = openDraft({ artifactId: 'artA', playheadMs: 5000, selection: { start: 1, end: 4, quote: 'abc' } });
  assert.equal(d.anchorMs, null, 'a comment cannot be about a character range AND a moment');
  assert.equal(composerHeaderLabel(d), 'Characters 1–4');
});

test('canReplaceDraft protects typed text only', () => {
  assert.equal(canReplaceDraft(null), true);
  const empty = openDraft({ artifactId: 'artA', playheadMs: 1000 });
  assert.equal(canReplaceDraft(empty), true);
  assert.equal(canReplaceDraft({ ...empty, body: '   ' }), true, 'whitespace is not written feedback');
  assert.equal(canReplaceDraft({ ...empty, body: 'x' }), false);
});
