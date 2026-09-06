import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ReviewArtifact, ReviewProduction } from './review.ts';
import {
  finalRenderControl,
  preferredReviewArtifact,
  previewRequestIdentity,
  reviewableArtifacts,
  segmentForArtifact,
  segmentPlaybackClock,
} from './segmented-review.ts';
import { resolveInitialArtifact } from './review-room-state.ts';

const proxy: ReviewArtifact = {
  id: 'proxy-1', runId: 'worker-run-1', relativePath: '.implexa/segments/segment-01.mp4',
  role: 'review_proxy', status: 'validated', sha256: 'a'.repeat(64), sizeBytes: 100,
  mtime: null, validatedAt: null,
};

const production: NonNullable<ReviewProduction> = {
  id: 'production-1', qualityMode: 'professional', planDigest: 'b'.repeat(64), fps: 30, totalFrames: 25566,
  finalRender: { ready: false, reasons: ['segment-02 is unresolved'] },
  segments: [
    {
      id: 'segment-01', label: 'Opening', ordinal: 0, state: 'preview_ready',
      writableRange: { startFrame: 0, endFrameExclusive: 3600 },
      previewRange: { startFrame: 0, endFrameExclusive: 3660 }, writableOffsetFrames: 0, artifact: proxy,
    },
    ...Array.from({ length: 5 }, (_, index) => ({
      id: `segment-0${index + 2}`, label: `Segment ${index + 2}`, ordinal: index + 1, state: 'pending' as const,
      writableRange: { startFrame: 3600 + (index * 4393), endFrameExclusive: 7993 + (index * 4393) },
      previewRange: null, writableOffsetFrames: null, artifact: null,
    })),
  ],
};

test('the segment proxy is preferred and previewed through its worker run identity', () => {
  const parent: ReviewArtifact = { ...proxy, id: 'final', runId: 'parent-run', role: 'final_output' };
  const selected = preferredReviewArtifact([parent], production);
  assert.equal(selected?.id, 'proxy-1');
  assert.deepEqual(previewRequestIdentity(selected!), { runId: 'worker-run-1', artifactId: 'proxy-1' });
  assert.equal(segmentForArtifact(production, selected!.id)?.id, 'segment-01');
});

test('supporting attachments accompany submission context but never become review or reference targets', () => {
  const target: ReviewArtifact = { ...proxy, id: 'local-target', role: 'review_input' };
  const support: ReviewArtifact = { ...proxy, id: 'support-zip', role: 'review_attachment' };
  assert.deepEqual(
    reviewableArtifacts([target, support], null).map((artifact) => artifact.id),
    ['local-target'],
  );
});

test('recovered source support cannot become fallback or deep-link selection while a historical video remains reviewable', () => {
  const plan: ReviewArtifact = { ...proxy, id: 'recovered-plan', role: 'source', relativePath: 'plan.json' };
  const transcript: ReviewArtifact = { ...proxy, id: 'recovered-transcript', role: 'source', relativePath: 'transcript.json' };
  const historicalVideo: ReviewArtifact = {
    ...proxy, id: 'historical-video', role: 'other', relativePath: 'historical-candidate.mp4',
  };
  const supportIds = new Set([plan.id, transcript.id]);
  const candidateIds = new Set([historicalVideo.id]);
  const qa: ReviewArtifact = { ...proxy, id: 'recovered-qa', role: 'other', relativePath: 'video-qa.json' };
  const reviewable = reviewableArtifacts([plan, transcript, qa, historicalVideo], null, supportIds, candidateIds);
  assert.deepEqual(reviewable.map((artifact) => artifact.id), ['historical-video']);
  assert.equal(preferredReviewArtifact([plan, transcript, qa, historicalVideo], null, supportIds, candidateIds)?.id, historicalVideo.id);
  assert.equal(resolveInitialArtifact(plan.id, reviewable, historicalVideo.id), historicalVideo.id,
    'a supporting-source deep link cannot select a manifest as the target');
  assert.equal(resolveInitialArtifact('foreign-artifact', reviewable, historicalVideo.id), historicalVideo.id,
    'a foreign deep link cannot displace the exact historical candidate');
  assert.equal(resolveInitialArtifact(historicalVideo.id, reviewable, null), historicalVideo.id,
    'the explicit historical role=other video remains a valid target');
  const final: ReviewArtifact = { ...proxy, id: 'normal-final', role: 'final_output' };
  assert.equal(preferredReviewArtifact([final, historicalVideo], null, new Set(), candidateIds)?.id, historicalVideo.id,
    'the exact historical candidate outranks an unrelated validated final output on its Review page');
});

test('legacy Review still allows a source target when no historical candidate narrows the packet', () => {
  const source: ReviewArtifact = { ...proxy, id: 'source-plan', role: 'source', relativePath: 'plan.json' };
  assert.deepEqual(reviewableArtifacts([source], null), [source]);
  assert.equal(preferredReviewArtifact([source], null)?.id, source.id);
});

test('unavailable historical provenance fails closed instead of falling back to source or unlisted other artifacts', () => {
  const source: ReviewArtifact = { ...proxy, id: 'source-plan', role: 'source', relativePath: 'plan.json' };
  const qa: ReviewArtifact = { ...proxy, id: 'qa-other', role: 'other', relativePath: 'qa.json' };
  const final: ReviewArtifact = { ...proxy, id: 'normal-final', role: 'final_output' };
  const reviewable = reviewableArtifacts([source, qa, final], null, new Set(), new Set(), true);
  assert.deepEqual(reviewable.map((artifact) => artifact.id), [final.id]);
  assert.equal(preferredReviewArtifact([source, qa, final], null, new Set(), new Set(), true)?.id, final.id);
});

test('preview time exposes the writable offset and maps to global and segment-relative time', () => {
  const segment = { ...production.segments[0], writableRange: { startFrame: 3600, endFrameExclusive: 7200 }, previewRange: { startFrame: 3540, endFrameExclusive: 7260 }, writableOffsetFrames: 60 };
  assert.deepEqual(segmentPlaybackClock(production, segment, 3000), {
    globalMs: 121000,
    segmentMs: 1000,
    writableOffsetMs: 2000,
  });
});

test('five unresolved segments keep final render refused', () => {
  assert.deepEqual(finalRenderControl(production), { enabled: false, reason: 'segment-02 is unresolved' });
});
