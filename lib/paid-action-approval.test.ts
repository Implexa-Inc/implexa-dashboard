import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatPaidActionCost,
  paidActionModelLabel,
  parsePaidActionApprovalRead,
  parsePaidActionApprovalSummary,
  validPaidActionApprovalResponse,
  type PaidActionApprovalSummary,
} from './paid-action-approval.ts';

const RUN = '10000000-0000-4000-8000-000000000001';
const SUMMARY: PaidActionApprovalSummary = {
  contractVersion: 'paid-action-approval-summary.v3',
  approvalIntentId: '10000000-0000-4000-8000-000000000002',
  requestManifestArtifactId: '10000000-0000-4000-8000-000000000003',
  requestManifestDigest: 'a'.repeat(64),
  provider: 'higgsfield',
  operation: 'kling3_0.video_generation',
  requestCount: 2,
  estimatedCost: 24,
  currency: 'credits',
  inputs: [
    { semanticKey: 'project_bundle', displayName: 'project-bundle.zip', artifactId: '10000000-0000-4000-8000-000000000004', sha256: 'b'.repeat(64) },
    { semanticKey: 'presenter_video', displayName: 'veed edited .mp4', artifactId: '10000000-0000-4000-8000-000000000005', sha256: 'c'.repeat(64) },
  ],
  requests: [
    { requestId: 'kling-01', sceneId: 'scene-12', prompt: 'Aerial route across the East Bay.', sourceRange: { startFrame: 120, endFrame: 271 }, model: 'kling3_0', resolution: '1920x1080', durationSeconds: 5, estimatedCost: 12, intendedUse: 'Full-screen B-roll at scene 12 with presenter bottom-right.', outputRelativePath: 'public/media/illustration-01.mp4' },
    { requestId: 'kling-02', sceneId: 'scene-19', prompt: 'Residential street approaching the property.', sourceRange: { startFrame: 800, endFrame: 951 }, model: 'kling3_0', resolution: '1920x1080', durationSeconds: 5, estimatedCost: 12, intendedUse: 'Full-screen B-roll at scene 19 before returning to presenter.', outputRelativePath: 'public/media/illustration-02.mp4' },
  ],
};

const read = (approval: unknown) => ({ ok: true, run: { id: RUN, paidActionApproval: approval } });

test('accepts the complete v3 summary and binds it to the exact run', () => {
  assert.deepEqual(parsePaidActionApprovalSummary(SUMMARY), SUMMARY);
  assert.deepEqual(parsePaidActionApprovalRead(read(SUMMARY), RUN), { state: 'ready', summary: SUMMARY });
  assert.deepEqual(parsePaidActionApprovalRead(read(SUMMARY), '10000000-0000-4000-8000-000000000099'), { state: 'unavailable', reason: 'malformed' });
});

test('legacy or incomplete manifests are update-required and never approval-ready', () => {
  assert.deepEqual(parsePaidActionApprovalRead(read({ contractVersion: 'paid-action-approval-unavailable.v1', reason: 'paid_action_manifest_v3_required' }), RUN),
    { state: 'agent_update_required', reason: 'paid_action_manifest_v3_required' });
  assert.deepEqual(parsePaidActionApprovalRead(read({ ...SUMMARY, contractVersion: 'paid-action-approval-summary.v2', inputs: undefined }), RUN),
    { state: 'unavailable', reason: 'malformed' });
  assert.deepEqual(parsePaidActionApprovalRead(read(null), RUN), { state: 'unavailable', reason: 'missing' });
});

test('refuses summaries whose trusted inputs, request placement or totals are incomplete or contradictory', () => {
  const invalid = [
    { ...SUMMARY, extra: true },
    { ...SUMMARY, requestManifestDigest: 'A'.repeat(64) },
    { ...SUMMARY, inputs: [] },
    { ...SUMMARY, inputs: [...SUMMARY.inputs, ...Array.from({ length: 15 }, (_, index) => ({
      semanticKey: `extra_${index}`, displayName: `extra-${index}.json`,
      artifactId: `10000000-0000-4000-8000-${String(100 + index).padStart(12, '0')}`, sha256: 'e'.repeat(64),
    }))] },
    { ...SUMMARY, inputs: [SUMMARY.inputs[0]] },
    { ...SUMMARY, inputs: [SUMMARY.inputs[0], { ...SUMMARY.inputs[1], displayName: '../secret.mp4' }] },
    { ...SUMMARY, inputs: [SUMMARY.inputs[0], { ...SUMMARY.inputs[1], displayName: '..\\secret.mp4' }] },
    { ...SUMMARY, inputs: [...SUMMARY.inputs,
      { semanticKey: 'extra_reference', displayName: 'one.json', artifactId: '10000000-0000-4000-8000-000000000010', sha256: 'f'.repeat(64) },
      { semanticKey: 'extra_reference', displayName: 'two.json', artifactId: '10000000-0000-4000-8000-000000000011', sha256: '0'.repeat(64) }] },
    { ...SUMMARY, requests: [SUMMARY.requests[0], { ...SUMMARY.requests[0], outputRelativePath: 'public/media/duplicate-request.mp4' }] },
    { ...SUMMARY, provider: 'other-provider' },
    { ...SUMMARY, operation: 'other.video_generation' },
    { ...SUMMARY, requests: [{ ...SUMMARY.requests[0], requestId: 'scene 1' }, SUMMARY.requests[1]] },
    { ...SUMMARY, requests: [{ ...SUMMARY.requests[0], sceneId: 'scene/1' }, SUMMARY.requests[1]] },
    { ...SUMMARY, requests: [{ ...SUMMARY.requests[0], model: 'kling3_0_turbo' }, SUMMARY.requests[1]] },
    { ...SUMMARY, requests: [{ ...SUMMARY.requests[0], intendedUse: '' }, SUMMARY.requests[1]] },
    { ...SUMMARY, requests: [{ ...SUMMARY.requests[0], outputRelativePath: '../illustration-01.mp4' }, SUMMARY.requests[1]] },
    { ...SUMMARY, requests: [{ ...SUMMARY.requests[0], outputRelativePath: 'public/media/nested/illustration-01.mp4' }, SUMMARY.requests[1]] },
    { ...SUMMARY, requests: [{ ...SUMMARY.requests[0], outputRelativePath: 'public\\media\\illustration-01.mp4' }, SUMMARY.requests[1]] },
    { ...SUMMARY, requests: [{ ...SUMMARY.requests[0], outputRelativePath: 'public/media/.hidden.mp4' }, SUMMARY.requests[1]] },
    { ...SUMMARY, requests: [{ ...SUMMARY.requests[0], outputRelativePath: SUMMARY.requests[1].outputRelativePath }, SUMMARY.requests[1]] },
    { ...SUMMARY, requests: [{ ...SUMMARY.requests[0], resolution: '16:9' }, SUMMARY.requests[1]] },
    { ...SUMMARY, requests: [{ ...SUMMARY.requests[0], durationSeconds: 5.5 }, SUMMARY.requests[1]] },
    { ...SUMMARY, requests: [{ ...SUMMARY.requests[0], estimatedCost: 12.0000001 },
      { ...SUMMARY.requests[1], estimatedCost: 11.9999999 }] },
    { ...SUMMARY, estimatedCost: 10_000_001 },
    { ...SUMMARY, requests: [{ ...SUMMARY.requests[0], sourceRange: { startFrame: 271, endFrame: 120 } }, SUMMARY.requests[1]] },
    { ...SUMMARY, requestCount: 3 },
    { ...SUMMARY, estimatedCost: 23 },
  ];
  for (const value of invalid) assert.equal(parsePaidActionApprovalSummary(value), null);
});

test('approval response must be exact and return the identical reviewed summary', () => {
  const response = { ok: true, requestId: '10000000-0000-4000-8000-000000000006', approvalDigest: 'd'.repeat(64), summary: SUMMARY, idempotent: false };
  assert.equal(validPaidActionApprovalResponse(response, SUMMARY), true);
  assert.equal(validPaidActionApprovalResponse({ ...response, extra: true }, SUMMARY), false);
  assert.equal(validPaidActionApprovalResponse({ ...response, summary: {
    ...SUMMARY, requests: [{ ...SUMMARY.requests[0], prompt: 'A different but structurally valid prompt.' }, SUMMARY.requests[1]],
  } }, SUMMARY), false);
  assert.equal(validPaidActionApprovalResponse({ ...response, requestId: 'not-a-uuid' }, SUMMARY), false);
});

test('labels the provider model and cost without hiding currency', () => {
  assert.equal(paidActionModelLabel('kling3_0'), 'Kling 3.0');
  assert.equal(paidActionModelLabel('kling3_0_turbo'), 'Kling 3.0 Turbo');
  assert.equal(formatPaidActionCost(24, 'credits'), '24 credits');
  assert.match(formatPaidActionCost(24, 'USD'), /\$24\.00/);
});
