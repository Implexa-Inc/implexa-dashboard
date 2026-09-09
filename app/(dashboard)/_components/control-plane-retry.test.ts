import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../../../lib/test/render.ts';

const REQUEST = '414249d0-3715-4493-a45c-1f070724b502';
const PATH = `/api/v2/me/run-requests/${REQUEST}/control-plane-retry`;
const GRANT = '5b1f6c2e-2c1b-4b1e-9a3e-1f1f1f1f1f1f';
const VERSION = 'c3350000-0000-4000-8000-000000000010';
const CLAIM = /No work or provider action started/;
const ELIGIBLE = { ok: true, eligible: true, alreadyQueued: false, grantId: GRANT, workflowVersionId: VERSION, drainRetryEpoch: 2,
  inputBindingsDigest: 'b'.repeat(64), failureCode: 'child_exited_before_attachment',
  // server-owned authority that must never be echoed back
  failedLaunchAttemptId: '70230697-2bc9-4fbc-9a76-827e601ccd52', failedFencingEpoch: 4, intentDigest: 'c'.repeat(64) };
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
  return opts.post ? opts.post(init) : { ok: true, requeued: true, alreadyQueued: false, drainRetryEpoch: 3, grantId: GRANT };
};

test('eligible: the claim, the explicit distinction, confirmation, then POST with the grant only and the JWT', async () => {
  const r = await render('control-plane-retry.tsx', { requestId: REQUEST }, { backend: backend({}) });
  try {
    await settle(r);
    assert.equal(r.calls.backend.length, 1, 'one eligibility read');
    assert.equal(r.calls.backend[0].path, PATH);
    assert.deepEqual(JSON.parse(JSON.stringify(r.calls.backend[0].init)), { jwt: 'test-jwt' });
    assert.match(r.text(), /Retry safely — no work started previously/);
    assert.match(r.text(), CLAIM, 'affirmative eligibility may carry the claim');
    assert.match(r.text(), /Retry safely: same request and frozen inputs/);
    assert.match(r.text(), /Run again: creates a new request/);
    await r.click(button(r, 'Retry safely'));
    assert.equal(r.calls.backend.length, 1, 'opening the confirmation sends nothing');
    await r.click(button(r, 'Queue the same request'));
    await settle(r);
    assert.equal(r.calls.backend.length, 2);
    assert.equal(r.calls.backend[1].path, PATH);
    assert.deepEqual(JSON.parse(JSON.stringify(r.calls.backend[1].init)), { jwt: 'test-jwt', method: 'POST', body: { grantId: GRANT } });
    assert.doesNotMatch(JSON.stringify(r.calls.backend[1].init), /70230697|failedFencingEpoch|launchAttempt|fencingEpoch|proof|expected|digest|workflowVersion/i);
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
    await r.act(async () => { confirm.click(); confirm.click(); });
    await settle(r);
    assert.equal(posts, 1, 'a second activation while in flight sends nothing');
    assert.equal(r.calls.backend.filter((c) => (c.init as { method?: string })?.method === 'POST').length, 1);
  } finally { r.cleanup(); }
});

for (const reply of [null, {}, { ok: true }, { requeued: true }, { ok: false, requeued: false, reason: 'control_plane_retry_grant_stale' },
  { ok: false, requeued: false, reason: 'external_action_recorded' }, 'throw']) {
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

test('a refusal after the click that says work may have occurred removes the claim on re-read', async () => {
  let reads = 0;
  const r = await render('control-plane-retry.tsx', { requestId: REQUEST }, { backend: (path: string, init: unknown) => {
    const method = (init as { method?: string })?.method || 'GET';
    if (method === 'POST') return { ok: false, requeued: false, reason: 'external_action_recorded' };
    reads += 1;
    return reads === 1 ? ELIGIBLE : { ok: false, eligible: false, reason: 'external_action_recorded' };
  } });
  try {
    await settle(r);
    assert.match(r.text(), CLAIM);
    await r.click(button(r, 'Retry safely'));
    await r.click(button(r, 'Queue the same request'));
    await settle(r);
    assert.doesNotMatch(r.text(), CLAIM, 'the claim disappears once the server says an external action may have occurred');
    assert.match(r.text(), /work or an external action may have occurred/);
    assert.equal(r.document.querySelectorAll('button').length, 0);
  } finally { r.cleanup(); }
});

test('already queued on the server renders the queued receipt and no button', async () => {
  const r = await render('control-plane-retry.tsx', { requestId: REQUEST }, { backend: backend({ eligibility: { ok: true, eligible: true, alreadyQueued: true } }) });
  try {
    await settle(r);
    assert.match(r.text(), /Queued again safely/);
    assert.equal(r.document.querySelectorAll('button').length, 0);
  } finally { r.cleanup(); }
});

// NEGATIVE RENDERING: for every refused or uncertain evidence state, the no-work
// claim must not appear anywhere on the page, and nothing can be posted.
const WORK_MAY_HAVE_OCCURRED = ['consequential_work_recorded', 'external_action_recorded', 'artifact_recorded', 'review_mutation_recorded',
  'attempt_not_terminal', 'attempt_runtime_unverified', 'attempt_outcome_ambiguous', 'attempt_authority_unknown',
  'not_control_plane_attachment_failure', 'surfaced_attempt_mismatch'];
for (const reason of WORK_MAY_HAVE_OCCURRED) {
  test(`${reason}: disabled, says work may have occurred, never claims no work, Run again stays separate`, async () => {
    const r = await render('control-plane-retry.tsx', { requestId: REQUEST }, { backend: backend({ eligibility: { ok: false, eligible: false, reason } }) });
    try {
      await settle(r);
      assert.doesNotMatch(r.text(), CLAIM, `no-work claim leaked for ${reason}`);
      assert.match(r.text(), /Retry safely is unavailable because work or an external action may have occurred:/);
      assert.match(r.text(), /Run again: creates a new request/);
      assert.equal(r.document.querySelectorAll('button').length, 0);
      assert.equal(r.calls.backend.length, 1);
    } finally { r.cleanup(); }
  });
}
const PROMISE_NOT_KEEPABLE = ['workflow_version_unpinned', 'workflow_version_unavailable', 'workflow_version_foreign', 'workflow_version_not_applied',
  'input_contract_identity_mismatch', 'continuation_parent_unavailable', 'bootstrap_retry_cap_reached', 'control_plane_retry_already_advanced'];
for (const reason of PROMISE_NOT_KEEPABLE) {
  test(`${reason}: disabled with its explanation, never claims no work, nothing can be posted`, async () => {
    const r = await render('control-plane-retry.tsx', { requestId: REQUEST }, { backend: backend({ eligibility: { ok: false, eligible: false, reason } }) });
    try {
      await settle(r);
      assert.doesNotMatch(r.text(), CLAIM, `no-work claim leaked for ${reason}`);
      assert.match(r.text(), /Retry safely is unavailable: /);
      assert.doesNotMatch(r.text(), /work or an external action may have occurred/);
      assert.match(r.text(), /Run again: creates a new request/);
      assert.equal(r.document.querySelectorAll('button').length, 0);
      assert.equal(r.calls.backend.length, 1);
    } finally { r.cleanup(); }
  });
}
for (const eligibility of [{ ok: false, eligible: false, reason: 'request_not_found' }, { ok: false, eligible: false, reason: 'request_still_pending' },
  { ok: false, eligible: false, reason: 'request_cancelled' }, { ok: false, eligible: false, reason: 'unknown_future_reason' },
  { eligible: true, alreadyQueued: false, grantId: GRANT, workflowVersionId: VERSION },
  { ok: true, eligible: true, alreadyQueued: false, workflowVersionId: VERSION },
  { ok: true, eligible: true, alreadyQueued: false, grantId: GRANT, workflowVersionId: null }, 'throw']) {
  test(`${JSON.stringify(eligibility)} renders nothing — and therefore no claim`, async () => {
    const r = await render('control-plane-retry.tsx', { requestId: REQUEST }, { backend: () => { if (eligibility === 'throw') throw new Error('down'); return eligibility; } });
    try { await settle(r); assert.equal(r.text().trim(), ''); assert.equal(r.calls.backend.length, 1); } finally { r.cleanup(); }
  });
}
