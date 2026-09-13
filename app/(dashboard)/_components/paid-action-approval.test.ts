import test from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../../../lib/test/render.ts';
import type { PaidActionApprovalSummary } from '../../../lib/paid-action-approval.ts';

const RUN = '10000000-0000-4000-8000-000000000001';
const SUMMARY: PaidActionApprovalSummary = {
  contractVersion: 'paid-action-approval-summary.v3',
  approvalIntentId: '10000000-0000-4000-8000-000000000002',
  requestManifestArtifactId: '10000000-0000-4000-8000-000000000003',
  requestManifestDigest: 'a'.repeat(64), provider: 'higgsfield', operation: 'kling3_0.video_generation',
  projectCheckpointId: '10000000-0000-4000-8000-000000000007',
  projectCheckpointDigest: 'e'.repeat(64),
  requestCount: 2, estimatedCost: 24, currency: 'credits',
  inputs: [
    { semanticKey: 'project_bundle', displayName: 'project-bundle.zip', artifactId: '10000000-0000-4000-8000-000000000004', sha256: 'b'.repeat(64) },
    { semanticKey: 'presenter_video', displayName: 'veed edited .mp4', artifactId: '10000000-0000-4000-8000-000000000005', sha256: 'c'.repeat(64) },
  ],
  requests: [
    { requestId: 'kling-01', sceneId: 'scene-12', prompt: 'Aerial route across the East Bay.', sourceRange: { startFrame: 120, endFrame: 271 }, model: 'kling3_0', resolution: '1920x1080', durationSeconds: 5, estimatedCost: 12, intendedUse: 'Full-screen B-roll at scene 12 with presenter bottom-right.', outputRelativePath: 'public/media/illustration-01.mp4' },
    { requestId: 'kling-02', sceneId: 'scene-19', prompt: 'Residential street approaching the property.', sourceRange: { startFrame: 800, endFrame: 951 }, model: 'kling3_0', resolution: '1920x1080', durationSeconds: 5, estimatedCost: 12, intendedUse: 'Full-screen B-roll at scene 19 before returning to presenter.', outputRelativePath: 'public/media/illustration-02.mp4' },
  ],
};
const response = { ok: true, requestId: '10000000-0000-4000-8000-000000000006', approvalDigest: 'd'.repeat(64), summary: SUMMARY, idempotent: false };
const settle = (r: { act: (fn: () => unknown) => Promise<void> }) => r.act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });

test('renders every trusted input, identity, provider request, placement and cost before approval', async () => {
  const r = await render('paid-action-approval.tsx', { runId: RUN, view: { state: 'ready', summary: SUMMARY } });
  try {
    for (const text of ['project-bundle.zip', 'veed edited .mp4', SUMMARY.inputs[0].artifactId, SUMMARY.inputs[0].sha256,
      'Higgsfield', 'kling3_0.video_generation', 'scene-12', 'kling-01', 'Aerial route across the East Bay.', '[120, 271) · end exclusive', 'Kling 3.0', '1920x1080, 5s',
      'Full-screen B-roll at scene 12 with presenter bottom-right.', 'Saved to', 'public/media/illustration-01.mp4', '24 credits', SUMMARY.requestManifestArtifactId, SUMMARY.requestManifestDigest,
      SUMMARY.projectCheckpointId, SUMMARY.projectCheckpointDigest]) {
      assert.ok(r.queryByText(text), `missing ${text}`);
    }
    assert.ok(r.queryByText('Approve 2 Kling 3.0 generations — estimated 24 credits'));
  } finally { r.cleanup(); }
});

test('approves only the five frozen identities through the dedicated endpoint and navigates after exact acknowledgement', async () => {
  const r = await render('paid-action-approval.tsx', { runId: RUN, view: { state: 'ready', summary: SUMMARY } }, { backend: () => response });
  try {
    const button = r.getByText('Approve 2 Kling 3.0 generations — estimated 24 credits');
    await r.act(() => {
      button.dispatchEvent(new r.window.MouseEvent('click', { bubbles: true }));
      button.dispatchEvent(new r.window.MouseEvent('click', { bubbles: true }));
    });
    await settle(r);
    assert.equal(r.calls.backend.length, 1, 'double click cannot authorize twice');
    assert.equal(r.calls.backend[0].path, `/api/v2/runs/${RUN}/paid-action-approval`);
    assert.equal(JSON.stringify((r.calls.backend[0].init as { body: unknown }).body), JSON.stringify({
      approvalIntentId: SUMMARY.approvalIntentId,
      requestManifestArtifactId: SUMMARY.requestManifestArtifactId,
      requestManifestDigest: SUMMARY.requestManifestDigest,
      projectCheckpointId: SUMMARY.projectCheckpointId,
      projectCheckpointDigest: SUMMARY.projectCheckpointDigest,
    }));
    assert.deepEqual(r.calls.push, ['/workflows']);
  } finally { r.cleanup(); }
});

test('renders every item in an eight-generation batch with its exact consent details', async () => {
  const requests = Array.from({ length: 8 }, (_, index) => ({
    ...SUMMARY.requests[index % SUMMARY.requests.length],
    requestId: `kling-${String(index + 1).padStart(2, '0')}`,
    sceneId: `scene-${index + 10}`,
    prompt: `Exact visual prompt ${index + 1}`,
    sourceRange: { startFrame: index * 151, endFrame: (index + 1) * 151 },
    estimatedCost: 0.004,
    intendedUse: `Exact placement ${index + 1}`,
    outputRelativePath: `public/media/illustration-${String(index + 1).padStart(2, '0')}.mp4`,
  }));
  const summary: PaidActionApprovalSummary = { ...SUMMARY, requestCount: 8, estimatedCost: 0.032, currency: 'USD', requests };
  const r = await render('paid-action-approval.tsx', { runId: RUN, view: { state: 'ready', summary } });
  try {
    for (const [index, request] of requests.entries()) {
      for (const detail of [request.requestId, request.sceneId, request.prompt, request.intendedUse,
        request.outputRelativePath, `[${request.sourceRange.startFrame}, ${request.sourceRange.endFrame}) · end exclusive`]) {
        assert.ok(r.queryByText(detail), `request ${index + 1} missing ${detail}`);
      }
    }
    assert.ok(r.queryByText('Approve 8 Kling 3.0 generations — estimated $0.032'));
    assert.equal(r.queryAllByText(/^\$0\.004$/).length, 8);
  } finally { r.cleanup(); }
});

test('a drifted checkpoint acknowledgement fails closed and never navigates', async () => {
  const r = await render('paid-action-approval.tsx', { runId: RUN, view: { state: 'ready', summary: SUMMARY } }, {
    backend: () => ({ ...response, summary: { ...SUMMARY, projectCheckpointDigest: 'f'.repeat(64) } }),
  });
  try {
    await r.click(r.getByText('Approve 2 Kling 3.0 generations — estimated 24 credits'));
    await settle(r);
    assert.match(r.document.querySelector('[role="alert"]')?.textContent || '', /could not verify whether this approval was recorded/);
    assert.deepEqual(r.calls.push, []);
  } finally { r.cleanup(); }
});

test('a mismatched response fails closed, authorizes no navigation, and retries the same exact identity', async () => {
  let attempts = 0;
  const backend = () => {
    attempts += 1;
    return attempts === 1 ? { ...response, summary: {
      ...SUMMARY, requests: [{ ...SUMMARY.requests[0], prompt: 'A changed but structurally valid prompt.' }, SUMMARY.requests[1]],
    } } : response;
  };
  const r = await render('paid-action-approval.tsx', { runId: RUN, view: { state: 'ready', summary: SUMMARY } }, { backend });
  try {
    await r.click(r.getByText('Approve 2 Kling 3.0 generations — estimated 24 credits'));
    await settle(r);
    assert.match(r.document.querySelector('[role="alert"]')?.textContent || '', /could not verify whether this approval was recorded/);
    assert.deepEqual(r.calls.push, []);
    await r.click(r.getByText('Approve 2 Kling 3.0 generations — estimated 24 credits'));
    await settle(r);
    assert.equal(r.calls.backend.length, 2);
    assert.deepEqual(r.calls.backend[0].init, r.calls.backend[1].init, 'lost/invalid response retry preserves the exact identity');
    assert.deepEqual(r.calls.push, ['/workflows']);
  } finally { r.cleanup(); }
});

test('legacy and malformed summaries expose no approval or generic continuation', async () => {
  for (const view of [
    { state: 'agent_update_required', reason: 'paid_action_manifest_v3_required' },
    { state: 'unavailable', reason: 'malformed' },
  ]) {
    const r = await render('paid-action-approval.tsx', { runId: RUN, view });
    try {
      assert.equal(r.document.querySelector('button'), null);
      assert.equal(r.queryByText(/Continue the work/), null);
      assert.equal(r.queryByText(/Approve \d/), null);
      assert.match(r.text(), view.state === 'agent_update_required' ? /Agent update required/ : /Approval details unavailable/);
    } finally { r.cleanup(); }
  }
});
