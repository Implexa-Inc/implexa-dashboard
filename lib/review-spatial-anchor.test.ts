// node --test lib/review-spatial-anchor.test.ts
//
// The v2 anchor MIRROR: the exact shape backend 0155 validates, built and checked on
// this side of the wire. The load-bearing assertions are deepEqual on the whole
// anchor — the backend fails closed on any unknown or missing key, so "roughly the
// right shape" is indistinguishable from "refused after the reviewer wrote a comment".

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  anchorError, anchorLabel, buildSpatialAnchor, isAnchorStale, isSpatialAnchorV2,
  sortIssues, spatialPercentLabel,
  COORDINATE_SPACE, INTENT_CHANGE, INTENT_REFERENCE, SPATIAL_ANCHOR_TYPE,
  type SpatialAnchorV2,
} from './review-anchor.ts';

const OBSERVED = 'BBBBBBBB-1111-1111-1111-111111111111';
const TARGET = 'bbbbbbbb-2222-2222-2222-222222222222';
const SHA_O = 'd'.repeat(64);
const SHA_T = 'e'.repeat(64);

const videoPoint = () => buildSpatialAnchor({
  observedArtifactId: OBSERVED,
  observedArtifactSha256: SHA_O,
  intent: { mode: INTENT_CHANGE },
  temporalStartMs: 1656,
  geometry: { kind: 'point', x: 0.742188, y: 0.318519, width: null, height: null },
  sourceFrame: { visualWidth: 1080, visualHeight: 1920 },
});

// ── the exact shape ─────────────────────────────────────────────────────────

test('a video point builds the EXACT eight-key backend shape, uuid lowercased', () => {
  assert.deepEqual(videoPoint(), {
    version: 2,
    type: 'visual_spatial',
    observedArtifactId: OBSERVED.toLowerCase(),
    observedArtifactSha256: SHA_O,
    intent: { mode: 'change_observed_artifact' },
    temporal: { startMs: 1656, endMs: null },
    geometry: {
      kind: 'point',
      coordinateSpace: 'normalized_visual_content_v1',
      x: 0.742188, y: 0.318519, width: null, height: null,
    },
    sourceFrame: { visualWidth: 1080, visualHeight: 1920 },
  });
  assert.equal(anchorError(videoPoint()), null);
});

test('an image point carries temporal NULL — a still image has no clock', () => {
  const a = buildSpatialAnchor({
    observedArtifactId: OBSERVED, observedArtifactSha256: SHA_O,
    intent: { mode: INTENT_CHANGE }, temporalStartMs: null,
    geometry: { kind: 'point', x: 0.25, y: 0.25, width: null, height: null },
    sourceFrame: { visualWidth: 64, visualHeight: 64 },
  });
  assert.equal(a.temporal, null);
  assert.equal(anchorError(a), null);
});

test('a rect keeps its dimensions; a point forces width/height null even if a caller passes them', () => {
  const rect = buildSpatialAnchor({
    observedArtifactId: OBSERVED, observedArtifactSha256: SHA_O,
    intent: { mode: INTENT_CHANGE }, temporalStartMs: 2500,
    geometry: { kind: 'rect', x: 0.21, y: 0.16, width: 0.42, height: 0.18 },
    sourceFrame: { visualWidth: 160, visualHeight: 90 },
  });
  assert.deepEqual(rect.geometry, {
    kind: 'rect', coordinateSpace: COORDINATE_SPACE, x: 0.21, y: 0.16, width: 0.42, height: 0.18,
  });
  const point = buildSpatialAnchor({
    observedArtifactId: OBSERVED, observedArtifactSha256: SHA_O,
    intent: { mode: INTENT_CHANGE }, temporalStartMs: null,
    geometry: { kind: 'point', x: 0.5, y: 0.5, width: 0.4 as never, height: 0.4 as never },
    sourceFrame: { visualWidth: 64, visualHeight: 64 },
  });
  assert.equal(point.geometry.width, null);
  assert.equal(point.geometry.height, null);
});

test('REFERENCE MODE: intent carries exactly mode + target identity, and nothing else', () => {
  const a = buildSpatialAnchor({
    observedArtifactId: OBSERVED, observedArtifactSha256: SHA_O,
    intent: { mode: INTENT_REFERENCE, targetArtifactId: TARGET.toUpperCase(), targetArtifactSha256: SHA_T },
    temporalStartMs: null,
    geometry: { kind: 'rect', x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
    sourceFrame: { visualWidth: 1080, visualHeight: 1920 },
  });
  assert.deepEqual(a.intent, {
    mode: 'reference_for_artifact', targetArtifactId: TARGET, targetArtifactSha256: SHA_T,
  });
  assert.equal(anchorError(a), null);
});

// ── the validator mirror ────────────────────────────────────────────────────

test('the mirror fails closed on the same inputs the backend refuses', () => {
  const bad = (mutate: (a: SpatialAnchorV2) => SpatialAnchorV2 | Record<string, unknown>): string | null =>
    anchorError(mutate(videoPoint()) as never);

  assert.match(bad((a) => ({ ...a, extra: true }))!, /field the server does not implement/);
  assert.match(bad((a) => ({ ...a, geometry: { ...a.geometry, coordinateSpace: 'element_px_v1' } }))!,
    /unsupported coordinate space/);
  assert.match(bad((a) => ({ ...a, geometry: { ...a.geometry, x: 1.2 } }))!, /outside the visible content/);
  assert.match(bad((a) => ({ ...a, geometry: { ...a.geometry, kind: 'rect', width: 0.5, height: 0.5, x: 0.6, y: 0.6 } }))!,
    /runs off the visible content/);
  assert.match(bad((a) => ({ ...a, geometry: { ...a.geometry, width: 0.1, height: 0.1 } }))!,
    /point annotation must not carry a size/);
  assert.match(bad((a) => ({ ...a, temporal: { startMs: 5.5, endMs: null } }))!, /not a valid position/);
  assert.match(bad((a) => ({ ...a, temporal: { startMs: 100, endMs: 100 } }))!, /must come after the start/);
  assert.match(bad((a) => ({ ...a, sourceFrame: { visualWidth: 0, visualHeight: 1920 } }))!,
    /dimensions were not captured/);
  assert.match(bad((a) => ({ ...a, intent: { mode: INTENT_CHANGE, targetArtifactId: TARGET } as never }))!,
    /must not carry a separate target/);
  assert.match(bad((a) => ({
    ...a,
    intent: { mode: INTENT_REFERENCE, targetArtifactId: OBSERVED.toLowerCase(), targetArtifactSha256: SHA_T } as never,
  }))!, /same file but carry different digests/);
});

// ── labels, ordering, staleness ─────────────────────────────────────────────

test('the rail label states shape, frozen time and percent position', () => {
  assert.equal(anchorLabel(videoPoint()), 'Pin 00:01.656 (74%, 32%)');
  const image = buildSpatialAnchor({
    observedArtifactId: OBSERVED, observedArtifactSha256: SHA_O,
    intent: { mode: INTENT_CHANGE }, temporalStartMs: null,
    geometry: { kind: 'rect', x: 0.21, y: 0.16, width: 0.42, height: 0.18 },
    sourceFrame: { visualWidth: 64, visualHeight: 64 },
  });
  assert.equal(anchorLabel(image), 'Area (21%, 16%)');
  assert.equal(spatialPercentLabel({ x: 0.742188, y: 0.318519 }), '(74%, 32%)');
});

test('ordering mirrors the backend: timed v2 sorts among temporal anchors, image pins after text', () => {
  const issues = [
    { id: 'd', anchor: { type: 'text_selection', startOffset: 5 } as never, createdAt: '1' },
    { id: 'a', anchor: videoPoint() as never, createdAt: '1' },
    { id: 'b', anchor: { type: 'media_time', timeStartMs: 900 } as never, createdAt: '1' },
    { id: 'e', anchor: { ...videoPoint(), temporal: null } as never, createdAt: '1' },
    { id: 'c', anchor: { type: 'artifact' } as never, createdAt: '1' },
  ];
  assert.deepEqual(sortIssues(issues).map((i) => i.id), ['b', 'a', 'd', 'e', 'c']);
});

test('staleness for a v2 anchor reads observedArtifactSha256, never the v1 key', () => {
  const artifact = { sha256: SHA_O, status: 'validated' };
  assert.equal(isAnchorStale(videoPoint(), artifact), false);
  assert.equal(isAnchorStale(videoPoint(), { sha256: 'f'.repeat(64), status: 'validated' }), true);
  assert.equal(isAnchorStale(videoPoint(), { sha256: SHA_O, status: 'declared' }), true);
});

test('the discriminator accepts exactly version-2 visual_spatial and nothing shaped like it', () => {
  assert.equal(isSpatialAnchorV2(videoPoint()), true);
  assert.equal(isSpatialAnchorV2({ version: 2, type: 'media_time' }), false);
  assert.equal(isSpatialAnchorV2({ version: 1, type: SPATIAL_ANCHOR_TYPE }), false);
  assert.equal(isSpatialAnchorV2(null), false);
});
