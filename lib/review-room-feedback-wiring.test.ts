// node --test lib/review-room-feedback-wiring.test.ts
//
// A SOURCE GUARD on <ReviewRoom />, in the same spirit as review-player-layout.test.ts.
//
// The rules in lib/review-timestamp-feedback.ts are proven by their own unit tests, but
// the production bug was not in a rule — it was in which VARIABLE the JSX handed to
// one. `pausedAtMs` was a perfectly correct value; it was simply the wrong one to offer
// as "where your feedback will land". This repo has no DOM renderer, so the binding
// itself is pinned here as text: cheap, exact, and mutation-checked (see
// scripts/mutation-test-review-timestamp-feedback.mjs).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = readFileSync(
  fileURLToPath(new URL('../app/(dashboard)/_components/review-room.tsx', import.meta.url)),
  'utf8',
);

test('REPRO: the add-feedback offer is bound to the live playhead, not a frozen or paused value', () => {
  assert.match(source, /addFeedbackLabel\(\{ playheadMs, existingCount: hereIssues\.length \}\)/,
    'the label must read the authoritative playhead state directly');
});

test('the stale last-pause position no longer exists as state', () => {
  // `pausedAtMs` survives ONLY in the comment explaining why it is gone.
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

test('the saved anchor is built from the frozen draft, never from the player', () => {
  assert.match(source, /buildMediaAnchor\(sha, d\.anchorMs \/ 1000, d\.rangeEndMs === null \? null : d\.rangeEndMs \/ 1000\)/,
    'reading mediaRef.current.currentTime at save time is the same bug one layer down');
  // The anchor builder and the save path must not consult the live element at all.
  const builder = source.slice(source.indexOf('const buildAnchor'), source.indexOf('const dismissIssue'));
  assert.ok(builder.length > 200, 'anchor/save region not found — this guard would be vacuous');
  assert.equal(/mediaRef\.current/.test(builder), false,
    'the draft holds the position the reviewer aimed at; the player has moved on');
});

test('an edit updates in place — it is never a second create', () => {
  assert.match(source, /const route = saveActionFor\(d\);/);
  assert.match(source, /action: 'update_issue', issueId: editingId,/);
  assert.match(source, /return replaceIssue\(prev, editingId, updated\);/,
    'appending here is the edit-as-create regression: the rail shows the comment twice');
});

test('switching artifact resets the playhead and closes any in-progress composer', () => {
  const effect = source.slice(source.indexOf('// ── preview lifecycle'), source.indexOf('// ── issue creation'));
  assert.ok(effect.length > 200, 'preview lifecycle effect not found — this guard would be vacuous');
  assert.match(effect, /setPlayheadMs\(null\);/, 'the new file has reported no position yet');
  assert.match(effect, /setDraft\(null\);/, 'a composer carried across would attach to the wrong file');
});

test('the composer renders from the draft, so it cannot exist without a frozen anchor', () => {
  assert.match(source, /\{draft && !frozen && !accepted && \(/,
    'a separate open flag is how a composer ends up on screen with a position nobody snapshotted');
  assert.match(source, /\{composerHeaderLabel\(draft\)\}/);
});
