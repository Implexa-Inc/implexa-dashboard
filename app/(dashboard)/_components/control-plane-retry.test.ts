import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../../../lib/test/render.ts';

const REQUEST = '414249d0-3715-4493-a45c-1f070724b502';
const PATH = `/api/v2/me/run-requests/${REQUEST}/control-plane-retry`;
const DIGEST = 'b'.repeat(64);
const ELIGIBLE = { ok: true, eligible: true, alreadyQueued: false, drainRetryEpoch: 2, workflowVersionId: 'v-1',
  inputBindingsDigest: DIGEST, failureCode: 'child_exited_before_attachment',
  // server-owned authority that must never be echoed back
  failedLaunchAttemptId: '70230697-2bc9-4fbc-9a76-827e601ccd52', failedFencingEpoch: 4 };
const button = (r: Awaited<ReturnType<typeof render>>, text: string) => {
  const found = [...r.document.querySelectorAll('button')].find(b => b.textContent === text);
  assert.ok(found, `missing button ${text}`);
  return found;
};
const settle = async (r: Awaited<ReturnType<typeof render>>) => { await r.act(async () => { await new Promise(res => setTimeout(res, 20)); }); };
const backend = (opts: { eligibility?: unknown; post?: (init: unknown) => unknown }) => (path: string, init: unknown) => {
  const method = (init as { method?: string })?.method || 'GET';
  if (path !== PATH) throw new Error(`unexpected path ${path}`);
  if (method === 'GET') return opts.eligibility ?? ELIGIBLE;
  return opts.post ? opts.post(init) : { ok: true, requeued: true, alreadyQueued: false, drainRetryEpoch: 3 };
};

test('eligible: explicit distinction, confirmation, then POST with exactly the three pins and the JWT', async () => {
  const r = await render('control-plane-retry.tsx', { requestId: REQUEST }, { backend: backend({}) });
  try {
    await settle(r);
    assert.equal(r.calls.backend.length, 1, 'one eligibility read');
    assert.equal(r.calls.backend[0].path, PATH);
    assert.deepEqual(JSON.parse(JSON.stringify(r.calls.backend[0].init)), { jwt: 'test-jwt' });
    assert.match(r.text(), /Retry safely — no work started previously/);
    assert.match(r.text(), /Retry safely: same request and frozen inputs/);
    assert.match(r.text(), /Run again: creates a new request/);
    await r.click(button(r, 'Retry safely'));
    assert.equal(r.calls.backend.length, 1, 'opening the confirmation sends nothing');
    await r.click(button(r, 'Queue the same request'));
    await settle(r);
    assert.equal(r.calls.backend.length, 2);
    assert.equal(r.calls.backend[1].path, PATH);
    assert.deepEqual(JSON.parse(JSON.stringify(r.calls.backend[1].init)), {
      jwt: 'test-jwt', method: 'POST',
      body: { expectedDrainRetryEpoch: 2, expectedWorkflowVersionId: 'v-1', expectedInputBindingsDigest: DIGEST },
    });
    assert.doesNotMatch(JSON.stringify(r.calls.backend[1].init), /70230697|failedFencingEpoch|launchAttempt|fencingEpoch|proof/i);
    assert.match(r.text(), /Queued again safely — same request, frozen inputs/);
    assert.equal(r.document.querySelectorAll('button').length, 0);
  } finally { r.cleanup(); }
});

test('Keep it paused cancels without a request; double activation is single-flight', async () => {
  let posts = 0;
  const r = await render('control-plane-retry.tsx', { requestId: REQUEST }, { backend: backend({ post: () => { posts += 1; return new Promise(() => {}); } }) });
  try {
    await settle(r);
    await r.click(button(r, 'Retry safely'));
    await r.click(button(r, 'Keep it paused'));
    button(r, 'Retry safely');
    assert.equal(r.calls.backend.length, 1);
    await r.click(button(r, 'Retry safely'));
    const confirm = button(r, 'Queue the same request');
    // Two activations inside one act: React has not re-rendered (so the button
    // is not yet disabled) when the second click arrives. Only the in-flight
    // guard can stop the second POST.
    await r.act(async () => { confirm.click(); confirm.click(); });
    await settle(r);
    assert.equal(posts, 1, 'a second activation while in flight sends nothing');
    assert.equal(r.calls.backend.filter((c) => (c.init as { method?: string })?.method === 'POST').length, 1);
  } finally { r.cleanup(); }
});

for (const reply of [null, {}, { ok: true }, { requeued: true }, { ok: false, requeued: false, reason: 'control_plane_retry_generation_mismatch' }, 'throw']) {
  test(`unconfirmed reply ${JSON.stringify(reply)} is not a claimed queue and re-reads eligibility`, async () => {
    const r = await render('control-plane-retry.tsx', { requestId: REQUEST }, { backend: backend({ post: () => { if (reply === 'throw') throw new Error('network'); return reply; } }) });
    try {
      await settle(r);
      await r.click(button(r, 'Retry safely'));
      await r.click(button(r, 'Queue the same request'));
      await settle(r);
      assert.match(r.document.querySelector('[role="alert"]')?.textContent || '', /Could not queue the safe retry/);
      assert.doesNotMatch(r.text(), /Queued again safely/);
      assert.equal(r.calls.backend.length, 3, 'GET, POST, then GET again');
      assert.equal((r.calls.backend[2].init as { method?: string }).method ?? 'GET', 'GET');
    } finally { r.cleanup(); }
  });
}

test('already queued on the server renders the queued state and no button', async () => {
  const r = await render('control-plane-retry.tsx', { requestId: REQUEST }, { backend: backend({ eligibility: { ok: true, eligible: true, alreadyQueued: true } }) });
  try {
    await settle(r);
    assert.match(r.text(), /Queued again safely/);
    assert.equal(r.document.querySelectorAll('button').length, 0);
  } finally { r.cleanup(); }
});

for (const reason of ['artifact_recorded', 'external_action_recorded', 'consequential_work_recorded', 'review_mutation_recorded', 'workflow_version_unavailable', 'bootstrap_retry_cap_reached']) {
  test(`${reason}: the action is shown disabled with its explanation, and nothing can be posted`, async () => {
    const r = await render('control-plane-retry.tsx', { requestId: REQUEST }, { backend: backend({ eligibility: { ok: false, eligible: false, reason } }) });
    try {
      await settle(r);
      assert.match(r.text(), /Retry safely is unavailable:/);
      assert.match(r.text(), /Run again: creates a new request/);
      assert.equal(r.document.querySelectorAll('button').length, 0);
      assert.equal(r.calls.backend.length, 1);
    } finally { r.cleanup(); }
  });
}

for (const eligibility of [{ ok: false, eligible: false, reason: 'request_not_found' }, { ok: false, eligible: false, reason: 'not_control_plane_attachment_failure' },
  { ok: false, eligible: false, reason: 'request_still_pending' }, { eligible: true, alreadyQueued: false, drainRetryEpoch: 1, inputBindingsDigest: DIGEST }, 'throw']) {
  test(`${JSON.stringify(eligibility)} renders nothing`, async () => {
    const r = await render('control-plane-retry.tsx', { requestId: REQUEST }, { backend: (path: string) => { if (eligibility === 'throw') throw new Error('down'); return eligibility; } });
    try { await settle(r); assert.equal(r.text().trim(), ''); assert.equal(r.calls.backend.length, 1); } finally { r.cleanup(); }
  });
}
