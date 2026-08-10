// node --test lib/review-spatial-feedback.test.ts
//
// The spatial draft's FREEZE discipline — the same two-position rule the timestamp
// module exists for, one dimension richer: a spatial draft freezes its file, its exact
// media timestamp, its normalized geometry AND the decoded dimensions those
// coordinates were read against, all at open. Nothing that happens afterwards —
// playback, seeking, resizing, switching files — may change any of it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  composerHeaderLabel, draftFromIssue, draftMode, openSpatialDraft,
  spatialAnchorFromDraft, spatialReferenceLine,
  type FeedbackDraft, type FrozenTarget,
} from './review-timestamp-feedback.ts';
import { INTENT_CHANGE, INTENT_REFERENCE } from './review-anchor.ts';
import { evidenceGate, evidenceChip, isSpatialIssue } from './review-evidence-status.ts';

const VID = 'bbbbbbbb-1111-1111-1111-111111111111';
const IMG = 'bbbbbbbb-2222-2222-2222-222222222222';
const SHA_V = 'd'.repeat(64);
const SHA_I = 'e'.repeat(64);
const target: FrozenTarget = { artifactId: VID, sha256: SHA_V, relativePath: 'out/final.mp4', role: 'final_output' };

const spatial = () => ({
  geometry: { kind: 'point' as const, x: 0.5, y: 0.25, width: null, height: null },
  sourceFrame: { visualWidth: 1600, visualHeight: 900 },
});

// ── the freeze ──────────────────────────────────────────────────────────────

test('openSpatialDraft freezes file, exact timestamp, geometry and dimensions in one act', () => {
  const d = openSpatialDraft({ target, frozenTimestampMs: 1655.6, spatial: spatial() });
  assert.equal(d.target.artifactId, VID);
  assert.equal(d.target.sha256, SHA_V);
  assert.equal(d.anchorMs, 1656, 'rounded to the integer millisecond the anchor stores');
  assert.deepEqual(d.spatial!.geometry, { kind: 'point', x: 0.5, y: 0.25, width: null, height: null });
  assert.deepEqual(d.spatial!.sourceFrame, { visualWidth: 1600, visualHeight: 900 });
  assert.equal(d.referenceTarget, null, 'change mode is the default — never inferred');
  assert.equal(draftMode(d), 'spatial');
});

test('the frozen values are COPIES — mutating the inputs afterwards changes nothing', () => {
  const s = spatial();
  const t = { ...target };
  const d = openSpatialDraft({ target: t, frozenTimestampMs: 1000, spatial: s });
  s.geometry.x = 0.9;
  s.sourceFrame.visualWidth = 1;
  t.sha256 = 'f'.repeat(64);
  assert.equal(d.spatial!.geometry.x, 0.5);
  assert.equal(d.spatial!.sourceFrame.visualWidth, 1600);
  assert.equal(d.target.sha256, SHA_V);
});

test('an image spatial draft has no timestamp at all — null, not zero', () => {
  const d = openSpatialDraft({
    target: { ...target, artifactId: IMG, sha256: SHA_I }, frozenTimestampMs: null, spatial: spatial(),
  });
  assert.equal(d.anchorMs, null);
});

// ── the anchor a draft saves as ─────────────────────────────────────────────

test('spatialAnchorFromDraft builds from the FROZEN identity, change mode by default', () => {
  const d = openSpatialDraft({ target, frozenTimestampMs: 1656, spatial: spatial() });
  const a = spatialAnchorFromDraft(d)!;
  assert.equal(a.observedArtifactId, VID);
  assert.equal(a.observedArtifactSha256, SHA_V);
  assert.deepEqual(a.intent, { mode: INTENT_CHANGE });
  assert.deepEqual(a.temporal, { startMs: 1656, endMs: null });
  assert.deepEqual(a.sourceFrame, { visualWidth: 1600, visualHeight: 900 });
});

test('a reference draft carries observe-A-change-B: geometry stays on A, intent names B', () => {
  const d: FeedbackDraft = {
    ...openSpatialDraft({ target, frozenTimestampMs: null, spatial: spatial() }),
    referenceTarget: { artifactId: IMG, sha256: SHA_I, relativePath: 'refs/board.png' },
  };
  const a = spatialAnchorFromDraft(d)!;
  assert.equal(a.observedArtifactId, VID, 'geometry belongs to the OBSERVED file');
  assert.deepEqual(a.intent, {
    mode: INTENT_REFERENCE, targetArtifactId: IMG, targetArtifactSha256: SHA_I,
  });
  assert.match(spatialReferenceLine(d), /Marked on out\/final\.mp4 as a reference/);
  assert.match(spatialReferenceLine(d), /applies to refs\/board\.png/);
});

test('a draft without a validated frozen identity anchors to NOTHING', () => {
  const noSha = openSpatialDraft({
    target: { ...target, sha256: null }, frozenTimestampMs: 1000, spatial: spatial(),
  });
  assert.equal(spatialAnchorFromDraft(noSha), null);
  const notSpatial = openSpatialDraft({ target, frozenTimestampMs: 1000, spatial: spatial() });
  assert.equal(spatialAnchorFromDraft({ ...notSpatial, spatial: null }), null);
});

// ── reopening an existing spatial issue ─────────────────────────────────────

const storedIssue = (over: Record<string, unknown> = {}) => ({
  id: 'dddddddd-1111-1111-1111-111111111111',
  artifactId: VID,
  kind: 'visual',
  body: 'tighten this card',
  status: 'draft',
  anchor: {
    version: 2, type: 'visual_spatial',
    observedArtifactId: VID, observedArtifactSha256: SHA_V,
    intent: { mode: 'change_observed_artifact' },
    temporal: { startMs: 3000, endMs: null },
    geometry: { kind: 'point', coordinateSpace: 'normalized_visual_content_v1', x: 0.25, y: 0.75, width: null, height: null },
    sourceFrame: { visualWidth: 1600, visualHeight: 900 },
  },
  ...over,
});

test('draftFromIssue reopens the FROZEN geometry, time and dimensions — never the live layout', () => {
  const d = draftFromIssue(storedIssue() as never, target)!;
  assert.equal(draftMode(d), 'spatial');
  assert.equal(d.anchorMs, 3000);
  assert.deepEqual(d.spatial!.geometry, { kind: 'point', x: 0.25, y: 0.75, width: null, height: null });
  assert.deepEqual(d.spatial!.sourceFrame, { visualWidth: 1600, visualHeight: 900 });
  assert.equal(d.editingIssueId, storedIssue().id);
  assert.equal(d.referenceTarget, null);
});

test('a reference issue reopens WITH its target identity intact', () => {
  const issue = storedIssue({
    anchor: {
      ...(storedIssue().anchor as Record<string, unknown>),
      intent: { mode: 'reference_for_artifact', targetArtifactId: IMG, targetArtifactSha256: SHA_I },
    },
  });
  const d = draftFromIssue(issue as never, target)!;
  assert.equal(d.referenceTarget!.artifactId, IMG);
  assert.equal(d.referenceTarget!.sha256, SHA_I);
});

test('reopening still refuses a target that is not the issue’s own file', () => {
  const other: FrozenTarget = { artifactId: IMG, sha256: SHA_I, relativePath: 'refs/board.png', role: 'source' };
  assert.equal(draftFromIssue(storedIssue() as never, other), null);
});

// ── the composer header ─────────────────────────────────────────────────────

test('the header states shape, exact frozen time and percent position', () => {
  const video = openSpatialDraft({ target, frozenTimestampMs: 1656, spatial: spatial() });
  assert.equal(composerHeaderLabel(video), 'Pin · 00:01.656 · (50%, 25%)');
  const image = openSpatialDraft({
    target, frozenTimestampMs: null,
    spatial: { geometry: { kind: 'rect', x: 0.21, y: 0.16, width: 0.42, height: 0.18 }, sourceFrame: { visualWidth: 64, visualHeight: 64 } },
  });
  assert.equal(composerHeaderLabel(image), 'Area · (21%, 16%)');
});

// ── the evidence gate ───────────────────────────────────────────────────────

const spatialDraftIssue = (id: string) => ({ id, anchor: storedIssue().anchor });
const v1DraftIssue = (id: string) => ({ id, anchor: { version: 1, type: 'media_time', timeStartMs: 5 } });

test('no spatial drafts — no gate, no status line', () => {
  const g = evidenceGate({ draftIssues: [v1DraftIssue('a')], status: null });
  assert.equal(g.blocked, false);
  assert.equal(g.reason, 'none_required');
});

test('UNKNOWN blocks: no successful status read must never unlock the send', () => {
  const g = evidenceGate({ draftIssues: [spatialDraftIssue('a')], status: null });
  assert.equal(g.blocked, true);
  assert.equal(g.reason, 'unknown');
  const unreadable = evidenceGate({
    draftIssues: [spatialDraftIssue('a')],
    status: { state: 'unavailable', issues: [] },
  });
  assert.equal(unreadable.blocked, true);
});

test('PENDING blocks as waiting; a terminal failure blocks as retryable; VALIDATED alone unlocks', () => {
  const status = (evidence: Record<string, unknown> | null) => ({
    state: 'ready' as const,
    issues: [{ issueId: 'a', anchorDigest: 'f'.repeat(64), evidence: evidence as never }],
  });
  const pending = evidenceGate({ draftIssues: [spatialDraftIssue('a')], status: status({ status: 'pending', ready: false }) });
  assert.equal(pending.blocked, true);
  assert.equal(pending.reason, 'waiting');
  assert.deepEqual(pending.retryIssueIds, []);

  const failed = evidenceGate({ draftIssues: [spatialDraftIssue('a')], status: status({ status: 'unavailable', ready: false }) });
  assert.equal(failed.blocked, true);
  assert.equal(failed.reason, 'failed');
  assert.deepEqual(failed.retryIssueIds, ['a']);

  const ready = evidenceGate({ draftIssues: [spatialDraftIssue('a')], status: status({ status: 'validated', ready: true }) });
  assert.equal(ready.blocked, false);
  assert.equal(ready.reason, 'ready');
});

test('THE COERCION GUARD: a validated-labelled row that is not ready:true still blocks', () => {
  // The projection alone decides readiness — a row claiming `validated` while the
  // server projection withheld `ready` (malformed descriptor, digest drift) must not
  // unlock the send.
  const g = evidenceGate({
    draftIssues: [spatialDraftIssue('a')],
    status: { state: 'ready', issues: [{ issueId: 'a', anchorDigest: 'f'.repeat(64), evidence: { status: 'validated', ready: false } as never }] },
  });
  assert.equal(g.blocked, true);
});

test('every spatial draft must be covered — one missing entry blocks the lot', () => {
  const g = evidenceGate({
    draftIssues: [spatialDraftIssue('a'), spatialDraftIssue('b')],
    status: { state: 'ready', issues: [{ issueId: 'a', anchorDigest: 'f'.repeat(64), evidence: { status: 'validated', ready: true } as never }] },
  });
  assert.equal(g.blocked, true);
  assert.deepEqual(g.waitingIssueIds, ['b']);
});

test('the chip never calls anything verified except the ready projection', () => {
  assert.equal(evidenceChip({ status: 'validated', ready: true })!.label, 'Screenshot: verified');
  assert.equal(evidenceChip({ status: 'pending', ready: false })!.tone, 'waiting');
  assert.equal(evidenceChip({ status: 'unavailable', ready: false })!.tone, 'failed');
  assert.equal(evidenceChip(null)!.tone, 'waiting');
});

test('isSpatialIssue discriminates exactly', () => {
  assert.equal(isSpatialIssue(spatialDraftIssue('a')), true);
  assert.equal(isSpatialIssue(v1DraftIssue('a')), false);
  assert.equal(isSpatialIssue({ anchor: null }), false);
});
