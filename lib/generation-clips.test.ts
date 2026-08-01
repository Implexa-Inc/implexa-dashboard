// node --test lib/generation-clips.test.ts
//
// Clip rows: the digest is the join, no path or URL ever appears in a row, an
// unreadable artifact source is loud, and regeneration is honestly disabled.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clipActions, clipReviewHref, clipRows } from './generation-clips.ts';
import type { ReviewArtifact } from './review.ts';

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const RUN_ID = 'run-1';

const artifact = (over: Partial<ReviewArtifact> = {}): ReviewArtifact => ({
  id: 'art-1', runId: RUN_ID, relativePath: 'clips/hook.mp4', role: 'final_output',
  status: 'validated', sha256: SHA_A, sizeBytes: 10, mtime: null, validatedAt: null,
  ...over,
});

const vm = {
  tasks: [
    { taskId: 't1', momentId: 'hook', variant: 'primary', window: { startSeconds: 12, endSeconds: 17 }, model: 'm', promptText: 'p', promptDigest: SHA_A, ratio: '720:1280', durationSeconds: 5, credits: 60 },
    { taskId: 't2', momentId: 'build', variant: 'primary', window: { startSeconds: 20, endSeconds: 25 }, model: 'm', promptText: 'p', promptDigest: SHA_A, ratio: '720:1280', durationSeconds: 5, credits: 60 },
  ],
  receipt: {
    digest: null,
    tasks: [
      { taskId: 't1', providerTaskId: null, promptDigest: null, status: 'succeeded' as const, artifactSha256: SHA_A },
      { taskId: 't2', providerTaskId: null, promptDigest: null, status: 'failed' as const, artifactSha256: null },
    ],
  },
};

test('each clip renders separately with its task label and timestamp window', () => {
  const result = clipRows(vm, [artifact()], true);
  assert.equal(result.state, 'ready');
  const rows = result.state === 'ready' ? result.rows : [];
  assert.equal(rows.length, 2);
  assert.equal(rows[0].label, 'hook — primary');
  assert.equal(rows[0].window, '0:12–0:17');
  assert.equal(rows[1].label, 'build — primary');
});

test('the digest is the join: a matching validated artifact is linked by id only', () => {
  const result = clipRows(vm, [artifact()], true);
  const rows = result.state === 'ready' ? result.rows : [];
  assert.equal(rows[0].artifactId, 'art-1');
  assert.equal(rows[0].noArtifactReason, null);
  // no url, src, or path field exists on a row — playback goes through the
  // Review Room's opaque token protocol, never through data carried here
  const keys = Object.keys(rows[0]);
  for (const forbidden of ['url', 'src', 'path', 'previewUrl', 'localPath']) {
    assert.ok(!keys.includes(forbidden), forbidden);
  }
});

test('a validated artifact with a different digest does not match', () => {
  const result = clipRows(vm, [artifact({ sha256: SHA_B })], true);
  const rows = result.state === 'ready' ? result.rows : [];
  assert.equal(rows[0].artifactId, null);
  assert.match(String(rows[0].noArtifactReason), /not in this run/i);
});

test('an unvalidated artifact never matches, even with the right digest', () => {
  const result = clipRows(vm, [artifact({ status: 'declared' })], true);
  const rows = result.state === 'ready' ? result.rows : [];
  assert.equal(rows[0].artifactId, null);
});

test('a failed clip without an artifact says so instead of showing a dead link', () => {
  const result = clipRows(vm, [artifact()], true);
  const rows = result.state === 'ready' ? result.rows : [];
  assert.equal(rows[1].artifactId, null);
  assert.match(String(rows[1].noArtifactReason), /did not produce/i);
});

test('an unreadable artifact source is its own state — clips are not quietly file-less', () => {
  const result = clipRows(vm, [], false);
  assert.equal(result.state, 'artifacts_unavailable');
  const rows = result.state === 'artifacts_unavailable' ? result.rows : [];
  // the clip with a digest explains unavailability rather than claiming absence
  assert.match(String(rows[0].noArtifactReason), /couldn't load/i);
});

test('a dead artifact source is never joined against — even if stale artifacts are passed', () => {
  // The caller handed over artifacts it also said it could not read. Linking a
  // clip through them would present an unverified read as this clip's file.
  const result = clipRows(vm, [artifact()], false);
  const rows = result.state === 'artifacts_unavailable' ? result.rows : [];
  assert.equal(rows[0].artifactId, null);
});

test('no receipt means no results yet — not an empty list of results', () => {
  assert.deepEqual(clipRows({ tasks: vm.tasks, receipt: null }, [artifact()], true), { state: 'no_results_yet' });
  assert.deepEqual(
    clipRows({ tasks: vm.tasks, receipt: { digest: null, tasks: [] } }, [artifact()], true),
    { state: 'no_results_yet' },
  );
});

// ── per-clip actions ────────────────────────────────────────────────────────

test('open and comment require a matched artifact; regenerate is always disabled with the reason', () => {
  const matched = clipActions({ artifactId: 'art-1', status: 'succeeded' });
  assert.equal(matched.canOpen, true);
  assert.equal(matched.canComment, true);
  assert.equal(matched.regenerate.enabled, false);
  assert.match(matched.regenerate.reason, /isn.t supported yet/i);
  assert.match(matched.regenerate.reason, /backend/i);

  const unmatched = clipActions({ artifactId: null, status: 'succeeded' });
  assert.equal(unmatched.canOpen, false);
  assert.equal(unmatched.canComment, false);
  assert.equal(unmatched.regenerate.enabled, false);
});

test('a clip opens via a Review Room ROUTE carrying only ids', () => {
  const href = clipReviewHref('run-1', 'art-1');
  assert.equal(href, '/review/run-1?artifact=art-1');
  assert.ok(!href.includes('implexa-artifact://'), 'no capability URL in a route');
  assert.ok(!/\/Users\/|\/home\/|[A-Z]:\\/.test(href), 'no path shape in a route');
});
