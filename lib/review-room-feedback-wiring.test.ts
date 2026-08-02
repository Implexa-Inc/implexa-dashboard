// node --test lib/review-room-feedback-wiring.test.ts
//
// A SOURCE GUARD on <ReviewRoom />, in the same spirit as review-player-layout.test.ts.
//
// The rules in lib/review-timestamp-feedback.ts are proven by their own unit tests, but
// the production bug was not in a rule — it was in which VARIABLE the JSX handed to
// one. `pausedAtMs` was a perfectly correct value; it was simply the wrong one to offer
// as "where your feedback will land". The same shape of mistake is available one
// dimension over: handing the SELECTED artifact's digest to a draft that froze a
// different file. This repo has no DOM renderer, so those bindings — and the presence
// of the two discoverable choices — are pinned here as text: cheap, exact, and
// mutation-checked (see scripts/mutation-test-review-timestamp-feedback.mjs).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = readFileSync(
  fileURLToPath(new URL('../app/(dashboard)/_components/review-room.tsx', import.meta.url)),
  'utf8',
);

// ── the playhead binding ────────────────────────────────────────────────────

test('REPRO: the point-comment offer is bound to the live playhead, not a frozen or paused value', () => {
  assert.match(source, /pointCommentLabel\(\{ playheadMs, existingCount: hereIssues\.length \}\)/,
    'the label must read the authoritative playhead state directly');
});

test('the stale last-pause position no longer exists as state', () => {
  const uses = source.split('\n').filter((l) => l.includes('pausedAtMs') && !l.trimStart().startsWith('//'));
  assert.deepEqual(uses, [], 'a last-pause variable is the bug; there is nothing left to bind to');
});

test('every event that can move the position is wired to the one playhead handler', () => {
  for (const handler of ['onLoadedMetadata', 'onTimeUpdate', 'onSeeked', 'onPause']) {
    assert.ok(
      new RegExp(`${handler}=\\{\\(e\\) => \\{?[\\s\\S]{0,120}?onPlayhead\\(mediaKey,`).test(source),
      `${handler} must report into the playhead — a subset of these is how scrubbing went unseen`,
    );
  }
});

// ── discoverability ─────────────────────────────────────────────────────────

test('REPRO: point and range are two rendered choices, not one plus a hidden affordance', () => {
  assert.match(source, /onClick=\{openPointComment\}/);
  assert.match(source, /onClick=\{startRange\}/);
  assert.match(source, /\{SELECT_RANGE_LABEL\}/, 'the range must be offered by name, before a point is committed to');
  // AND on exactly this condition. Asserting only that the button exists in the file
  // lets a `{false && …}` — or a nesting inside the open-draft branch — put it back
  // where nobody finds it while every other assertion here still passes.
  assert.match(source, /\{canOfferRange\(playheadMs\) && !pendingRange && \(/,
    'the range offer is gated on having a position and no range already running — nothing else');
  // The old accidental path: a "Set end here" button that only materialised after a
  // point draft was open. Its absence is the discoverability fix. Matched as a RENDERED
  // label rather than as the bare phrase, which also appears in the comment explaining
  // why it is gone.
  assert.equal(/Set end here\s*<\/button>/.test(source), false,
    'a range must not require discovering it mid-point-comment');
});

test('a range in progress renders its frozen start, a playhead-following end, and a cancel', () => {
  const strip = source.slice(source.indexOf('{pendingRange && !frozen'), source.indexOf('{draft && !frozen'));
  assert.ok(strip.length > 200, 'range strip not found — this guard would be vacuous');
  assert.match(strip, /\{rangeStartLabel\(pendingRange\)\}/, 'the frozen start must be visible');
  assert.match(strip, /\{rangeEndButtonLabel\(playheadMs\)\}/, 'the end button must FOLLOW the playhead');
  assert.match(strip, /\{CANCEL_RANGE_LABEL\}/);
  assert.match(strip, /onClick=\{finishRange\}/);
});

// ── the frozen anchor and the frozen file ───────────────────────────────────

test('the saved anchor is built from the frozen draft, never from the player', () => {
  assert.match(source, /buildMediaAnchor\(sha, d\.anchorMs \/ 1000, d\.rangeEndMs === null \? null : d\.rangeEndMs \/ 1000\)/,
    'reading mediaRef.current.currentTime at save time is the same bug one layer down');
  const builder = source.slice(source.indexOf('const buildAnchor'), source.indexOf('const dismissIssue'));
  assert.ok(builder.length > 200, 'anchor/save region not found — this guard would be vacuous');
  assert.equal(/mediaRef\.current/.test(builder), false,
    'the draft holds the position the reviewer aimed at; the player has moved on');
});

test("REPRO: the anchor's digest and the issue's file come from the DRAFT, not the selection", () => {
  assert.match(source, /const sha = d\?\.target\.sha256;/,
    "using the selected artifact's digest anchors A's comment to B's bytes the moment the selector moves");
  assert.match(source, /action: 'create_issue', sessionId: sid, artifactId: d!\.target\.artifactId,/,
    'the issue must be recorded against the file it was written about');
  const builder = source.slice(source.indexOf('const buildAnchor'), source.indexOf('const dismissIssue'));
  assert.equal(/artifact\?\.sha256/.test(builder), false);
});

test('REPRO: the SESSION is opened on the frozen file too, not the live selection', () => {
  // session.selected_artifact_id is the only path the compiled brief prints. Creating
  // the session from the selector while the issue is frozen to another file heads the
  // agent's brief with the wrong "Primary artifact".
  assert.match(source, /await ensureSession\(d!\.target\.artifactId\)/,
    'a switch immediately before save must not decide which file the session names');
  assert.match(source, /const ensureSession = useCallback\(async \(artifactId: string \| null\)/,
    'ensureSession must take the identity from its caller rather than reading the selection');
  const create = source.slice(source.indexOf('const ensureSession'), source.indexOf('const buildAnchor'));
  assert.equal(/artifact\?\.id/.test(create), false, 'no live-selection fallback may remain in this path');
  // Accept is session-level and legitimately uses the selection — but it writes no issue.
  assert.match(source, /await ensureSession\(selectedId\)/);
});

test('the composer shows the frozen filename and never re-derives it', () => {
  assert.match(source, /\{targetLine\(draft\.target\)\}/,
    'a timestamp alone does not say which of several files the comment is about');
  assert.match(source, /targetGuidance\(draft\.target\)/);
});

test('an edit is opened against the issue\'s own file', () => {
  assert.match(source, /draftFromIssue\(issue as never, targetIdentity\)/,
    'draftFromIssue refuses a mismatch, so this can never open B\'s comment over A');
});

// ── lifecycle ───────────────────────────────────────────────────────────────

test('switching artifact resets the playhead, the composer AND any unfinished range', () => {
  const effect = source.slice(source.indexOf('// ── preview lifecycle'), source.indexOf('// ── issue creation'));
  assert.ok(effect.length > 200, 'preview lifecycle effect not found — this guard would be vacuous');
  assert.match(effect, /setPlayheadMs\(null\);/, 'the new file has reported no position yet');
  assert.match(effect, /setDraft\(null\);/, 'a composer carried across would attach to the wrong file');
  assert.match(effect, /setPendingRange\(null\);/, 'a start time from video A marks nothing in video B');
});

test('REPRO: the range refusal is derived every render, never stored', () => {
  // A stored string outlives the state it described: production showed "The end of the
  // range must come after the start." beside `Start 00:00.000 → Set end at 03:42.147`.
  assert.match(source, /const rangeError = liveRangeError\(\{ attempt: rangeAttempt, range: pendingRange, playheadMs \}\);/,
    'the message must be a reading of live state, not a note left by an earlier click');
  assert.match(source, /useState<RangeAttempt>\(null\)/,
    'state records only THAT something was pressed');
  // Nothing may put a message into state.
  assert.equal(/setRangeError\(/.test(source), false,
    'storing the refusal is exactly how it goes stale');
  assert.match(source, /setRangeAttempt\('begin'\)/);
  assert.match(source, /setRangeAttempt\('end'\)/);
});

test('a range that outlives its file is dropped by the state itself', () => {
  assert.match(source, /if \(pendingRange && !rangeSurvivesSelection\(pendingRange, selectedId\)\)/,
    'belt and braces: the reset path is not the only thing keeping a range on its own file');
});

test('an edit updates in place — it is never a second create', () => {
  assert.match(source, /const route = saveActionFor\(d\);/);
  assert.match(source, /action: 'update_issue', issueId: editingId,/);
  assert.match(source, /return replaceIssue\(prev, editingId, updated\);/,
    'appending here is the edit-as-create regression: the rail shows the comment twice');
});

test('the composer renders from the draft, so it cannot exist without a frozen anchor', () => {
  assert.match(source, /\{draft && !frozen && !accepted && \(/,
    'a separate open flag is how a composer ends up on screen with a position nobody snapshotted');
  assert.match(source, /\{composerHeaderLabel\(draft\)\}/);
});

test('clicking a rail issue for another file switches before it seeks', () => {
  assert.match(source, /if \(target\.needsSwitch && target\.artifactId\) \{/,
    'seeking first would move the WRONG player to that timestamp');
});

// ── the honesty boundary ────────────────────────────────────────────────────

test('no dashboard-only "reference only" field is invented', () => {
  // The backend drops unknown anchor keys silently on a 200 (see
  // docs/review-target-intent-contract.md), so a structured intent here would be a
  // control that records nothing while looking like it recorded something.
  for (const invented of ['referenceOnly', 'targetIntent', 'doNotModify', "intent:"]) {
    assert.equal(source.includes(invented), false, `${invented} would be a field that carries nothing`);
  }
});

test('REPRO: no canned reference sentence is offered while the brief names one file', () => {
  // The guidance is rendered; the one-click insert that used to sit under it is gone,
  // because the brief prints only the session's artifact path — so a canned "use this
  // as reference" can arrive under a heading naming a different file.
  assert.match(source, /targetGuidance\(draft\.target\)/);
  assert.equal(/withReferenceSentence/.test(source), false,
    'a helper that writes the sentence for the reviewer implies it is sufficient — it is not yet');
  assert.equal(/REFERENCE_ONLY_SENTENCE/.test(source), false);
});
