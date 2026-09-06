import test from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../../../lib/test/render.ts';

test('the files card invalidates a stale connected state when its window regains focus', async () => {
  let probes = 0;
  const rendered = await render('verified-artifacts.tsx', {
    artifacts: [],
    runId: '77fd8675-1b02-4881-a59f-c43012d98d9f',
  }, {
    bridge: {
      localInputReauthorizationState: async () => ({
        ok: true,
        applicable: true,
        required: probes++ > 0,
        label: 'C0360.MP4',
      }),
    },
  });
  try {
    assert.equal(rendered.queryByText(/Reconnect original source/), null);
    await rendered.act(() => rendered.window.dispatchEvent(new rendered.window.Event('focus')));
    assert.ok(rendered.queryByText(/Reconnect original source/));
    assert.match(rendered.text(), /C0360\.MP4/);
    assert.equal(probes, 2);
  } finally { rendered.cleanup(); }
});

test('an older focus probe cannot overwrite a successful full-hash reconnect', async () => {
  let probes = 0;
  let releaseProbe: ((value: { ok: true; applicable: true; required: true; label: string }) => void) | null = null;
  const rendered = await render('verified-artifacts.tsx', {
    artifacts: [],
    runId: '77fd8675-1b02-4881-a59f-c43012d98d9f',
  }, {
    bridge: {
      localInputReauthorizationState: async () => {
        probes += 1;
        if (probes === 1) return { ok: true, applicable: true, required: true, label: 'C0360.MP4' };
        return new Promise((resolve) => { releaseProbe = resolve; });
      },
      reauthorizeRunInputs: async () => ({ ok: true, recovered: 1 }),
    },
  });
  try {
    const reconnect = rendered.getByText(/Reconnect original source/);
    rendered.window.dispatchEvent(new rendered.window.Event('focus'));
    await rendered.click(reconnect);
    assert.equal(rendered.queryByText(/Reconnect original source/), null);
    await rendered.act(() => releaseProbe?.({ ok: true, applicable: true, required: true, label: 'C0360.MP4' }));
    assert.equal(rendered.queryByText(/Reconnect original source/), null,
      'a probe started before reconnect completion must not restore the stale warning');
  } finally { rendered.cleanup(); }
});
