// node --test lib/review-anchor.test.ts
//
// The anchor is the identity of a piece of feedback: (artifact digest, location).
// These tests pin the capture precision, the client-side mirror of the backend
// validator, and the staleness rule that stops a comment silently re-pointing at
// different bytes after a file changes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  currentTimeToMs, buildMediaAnchor, buildTextAnchor, buildArtifactAnchor,
  anchorError, bodyError, isAnchorStale, formatMs, anchorLabel, sortIssues,
  QUOTE_MAX, BODY_MAX,
} from './review-anchor.ts';

const SHA = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);

// ── timestamped issue creation ──────────────────────────────────────────────

test('pausing captures currentTime * 1000, rounded to a whole millisecond', () => {
  assert.equal(currentTimeToMs(56.23), 56230);
  assert.equal(currentTimeToMs(0), 0);
  assert.equal(currentTimeToMs(64), 64000);
  // rounded, not truncated: the anchor is what the reviewer SAW when they paused,
  // and flooring would drift every mark earlier than the frame on screen.
  assert.equal(currentTimeToMs(1.2349), 1235);
  assert.equal(currentTimeToMs(1.2344), 1234);
  // the backend requires a non-negative integer, so garbage must not become one
  assert.equal(currentTimeToMs(-5), 0);
  assert.equal(currentTimeToMs(NaN), 0);
  assert.ok(Number.isInteger(currentTimeToMs(3.14159)));
});

test('a point anchor and a range anchor both pass the backend rules', () => {
  const point = buildMediaAnchor(SHA, 56.23);
  assert.deepEqual(point, { version: 1, type: 'media_time', artifactSha256: SHA, timeStartMs: 56230, timeEndMs: null });
  assert.equal(anchorError(point), null);

  const range = buildMediaAnchor(SHA, 64, 69);
  assert.equal(range.timeEndMs, 69000);
  assert.equal(anchorError(range), null);
});

test('an inverted range is refused HERE, before a round trip', () => {
  const bad = buildMediaAnchor(SHA, 9, 1);
  assert.match(anchorError(bad)!, /end of the range must come after/i);
});

test('a text selection carries offsets and a bounded quote', () => {
  const a = buildTextAnchor(SHA, 410, 468, 'selected excerpt');
  assert.equal(anchorError(a), null);
  assert.equal(a.startOffset, 410);
  assert.equal(a.endOffset, 468);

  const huge = buildTextAnchor(SHA, 0, 5000, 'x'.repeat(5000));
  assert.equal(huge.quote.length, QUOTE_MAX, 'bounded at capture, so the user is not refused after writing');
  assert.equal(anchorError(huge), null);

  assert.match(anchorError(buildTextAnchor(SHA, 0, 5, ''))!, /Select some text/i);
});

test('an artifact with no validated digest cannot be anchored to', () => {
  assert.match(anchorError(buildArtifactAnchor(''))!, /no validated digest/i);
  assert.match(anchorError(buildArtifactAnchor('short'))!, /no validated digest/i);
  assert.equal(anchorError(buildArtifactAnchor(SHA)), null);
});

test('the issue body is bounded the same way the backend bounds it', () => {
  assert.match(bodyError('')!, /Describe what should change/i);
  assert.match(bodyError('   ')!, /Describe what should change/i);
  assert.equal(bodyError('fix the timing'), null);
  assert.match(bodyError('x'.repeat(BODY_MAX + 1))!, /under 4000/);
});

// ── staleness ───────────────────────────────────────────────────────────────

test('a changed digest makes an anchor stale rather than re-pointing it', () => {
  const anchor = { artifactSha256: SHA };
  assert.equal(isAnchorStale(anchor, { sha256: SHA, status: 'validated' }), false);
  assert.equal(isAnchorStale(anchor, { sha256: OTHER, status: 'validated' }), true);
  // an artifact that lost its validated status can no longer back an anchor
  assert.equal(isAnchorStale(anchor, { sha256: SHA, status: 'declared' }), true);
  assert.equal(isAnchorStale(anchor, null), true);
  assert.equal(isAnchorStale(null, { sha256: SHA, status: 'validated' }), true);
});

// ── display ─────────────────────────────────────────────────────────────────

test('timestamps render exactly as the compiled brief prints them', () => {
  assert.equal(formatMs(56230), '00:56.230');
  assert.equal(formatMs(64000), '01:04.000');
  assert.equal(formatMs(3723456), '01:02:03.456');
  assert.equal(anchorLabel({ type: 'media_time', timeStartMs: 56230, timeEndMs: null }), '00:56.230');
  assert.equal(anchorLabel({ type: 'media_time', timeStartMs: 64000, timeEndMs: 69000 }), '01:04.000 – 01:09.000');
  assert.equal(anchorLabel({ type: 'artifact' }), 'Whole file');
});

test('the rail orders issues the way the brief compiles them', () => {
  const issues = [
    { id: 'c', anchor: { type: 'artifact' }, createdAt: '1' },
    { id: 'a', anchor: { type: 'media_time', timeStartMs: 9000 }, createdAt: '2' },
    { id: 'b', anchor: { type: 'media_time', timeStartMs: 1000 }, createdAt: '3' },
    { id: 'd', anchor: { type: 'text_selection', startOffset: 5 }, createdAt: '4' },
  ];
  assert.deepEqual(sortIssues(issues).map((i) => i.id), ['b', 'a', 'd', 'c'],
    'media by time, then text, then whole-file comments last');
});

test('ordering is deterministic for identical anchors', () => {
  const same = [
    { id: 'z', anchor: { type: 'media_time', timeStartMs: 1000 }, createdAt: '1' },
    { id: 'a', anchor: { type: 'media_time', timeStartMs: 1000 }, createdAt: '1' },
  ];
  assert.deepEqual(sortIssues(same).map((i) => i.id), ['a', 'z']);
  assert.deepEqual(sortIssues([...same].reverse()).map((i) => i.id), ['a', 'z']);
});
