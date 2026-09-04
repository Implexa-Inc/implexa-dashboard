import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { render } from '../../../lib/test/render.ts';

const RUN = '84d424d3-c57a-48cc-9e3d-6709252ef84b';
const props = { runId: RUN, runState: 'stalled', cancelRequestedAt: null };
const button = (r: Awaited<ReturnType<typeof render>>, text: string) => {
  const found = [...r.document.querySelectorAll('button')].find(b => b.textContent === text);
  assert.ok(found, `missing button ${text}`);
  return found;
};

for (const runState of ['stalled', 'running']) {
  test(`${runState}: explicit confirmation posts exactly the viewed run and does not claim closure`, async () => {
    const r = await render('run-stop-control.tsx', { ...props, runState }, {
      backend: () => ({ ok: true, requested: true, alreadyTerminal: false }),
    });
    try {
      assert.equal(r.calls.backend.length, 0);
      await r.click(button(r, 'Stop run'));
      assert.equal(r.calls.backend.length, 0, 'opening confirmation is read-only');
      await r.click(button(r, 'Confirm stop'));
      assert.equal(r.calls.backend.length, 1);
      assert.equal(r.calls.backend[0].path, `/api/v2/runs/${RUN}/cancel`);
      assert.deepEqual(JSON.parse(JSON.stringify(r.calls.backend[0].init)), { jwt: 'test-jwt', method: 'POST' });
      assert.match(r.text(), /Stop requested.*Waiting for the owning executor or Desktop to confirm closure/);
      assert.equal(r.document.querySelectorAll('button').length, 0);
      assert.doesNotMatch(r.text(), /successfully cancelled|completed|Mark as done/);
      await r.rerender({ ...props, runState: 'failed' });
      assert.equal(r.text().trim(), '', 'terminal server state removes cancellation control');
      assert.equal(r.calls.backend.length, 1);
    } finally { r.cleanup(); }
  });
}

for (const runState of ['failed', 'completed', 'queued', null, 'unknown']) {
  test(`no Stop for ${runState}`, async () => {
    const r = await render('run-stop-control.tsx', { ...props, runState });
    try { assert.equal(r.text().trim(), ''); assert.equal(r.calls.backend.length, 0); }
    finally { r.cleanup(); }
  });
}

test('existing persisted Stop survives reload without sending it again', async () => {
  const r = await render('run-stop-control.tsx', { ...props, cancelRequestedAt: '2026-09-04T22:10:00Z' });
  try {
    assert.match(r.text(), /Stop requested/);
    assert.equal(r.document.querySelectorAll('button').length, 0);
    assert.equal(r.calls.backend.length, 0);
  } finally { r.cleanup(); }
});

test('Keep open cancels the confirmation without a request', async () => {
  const r = await render('run-stop-control.tsx', props);
  try {
    await r.click(button(r, 'Stop run'));
    await r.click(button(r, 'Keep open'));
    button(r, 'Stop run');
    assert.equal(r.calls.backend.length, 0);
  } finally { r.cleanup(); }
});

for (const reply of [null, {}, { ok: true }, { ok: false, requested: true }, 'throw']) {
  test(`unconfirmed response ${JSON.stringify(reply)} is not a claimed cancellation`, async () => {
    const r = await render('run-stop-control.tsx', props, { backend: () => {
      if (reply === 'throw') throw new Error('network');
      return reply;
    } });
    try {
      await r.click(button(r, 'Stop run'));
      await r.click(button(r, 'Confirm stop'));
      assert.match(r.document.querySelector('[role="alert"]')?.textContent || '', /Could not confirm/);
      assert.doesNotMatch(r.text(), /Stop requested/);
      assert.equal(r.calls.backend.length, 1);
    } finally { r.cleanup(); }
  });
}

test('completion racing Stop refreshes actual result, not cancelled/successful', async () => {
  const r = await render('run-stop-control.tsx', props, { backend: () => ({ ok: true, requested: false, alreadyTerminal: true }) });
  try {
    await r.click(button(r, 'Stop run'));
    await r.click(button(r, 'Confirm stop'));
    assert.match(r.text(), /already ended/);
    assert.doesNotMatch(r.text(), /Stop requested|successful|cancelled/);
    assert.equal(r.calls.backend.length, 1);
  } finally { r.cleanup(); }
});

test('double activation while the authenticated request is pending sends only once', async () => {
  let finish!: (value: unknown) => void;
  const response = new Promise(resolve => { finish = resolve; });
  const r = await render('run-stop-control.tsx', props, { backend: () => response });
  try {
    await r.click(button(r, 'Stop run'));
    const confirm = button(r, 'Confirm stop');
    await r.act(() => {
      confirm.dispatchEvent(new r.window.MouseEvent('click', { bubbles: true }));
      confirm.dispatchEvent(new r.window.MouseEvent('click', { bubbles: true }));
    });
    assert.equal(r.calls.backend.length, 1);
    assert.doesNotMatch(r.text(), /Stop requested/);
    await r.act(() => finish({ ok: true, requested: true, alreadyRequested: true }));
    assert.match(r.text(), /Stop requested/);
    assert.equal(r.calls.backend.length, 1);
  } finally { r.cleanup(); }
});

test('terminal refresh while confirmation is open removes the action without posting', async () => {
  const r = await render('run-stop-control.tsx', props);
  try {
    await r.click(button(r, 'Stop run'));
    await r.rerender({ ...props, runState: 'completed' });
    assert.equal(r.text().trim(), '');
    assert.equal(r.calls.backend.length, 0);
  } finally { r.cleanup(); }
});

test('detail page wires actual row identity/state independent of fresh-card or heartbeat gates', () => {
  const page = readFileSync(new URL('../runs/[id]/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /import RunStopControl from '..\/..\/_components\/run-stop-control'/);
  assert.match(page, /<RunStopControl key=\{r.id\} runId=\{r.id\} runState=\{r.run_state \?\? null\} cancelRequestedAt=\{run\?\.cancel_requested_at\} \/>/);
  assert.match(page, /stalled_at, cancel_requested_at'/);
});
