import test from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../../../lib/test/render.ts';

const props = {
  runId: '77fd8675-1b02-4881-a59f-c43012d98d9f',
  agentName: 'Raw recording clean cut',
  reviewStatus: 'needs_input',
  holdKind: 'needs_input',
  hasShipStep: true,
  stepsState: [
    { index: 1, label: 'Approved plan', status: 'done' },
    { index: 2, label: 'Render', status: 'pending' },
  ],
  claudeTaskId: null,
  skillSlug: 'raw-recording-clean-cut',
};

test('a lost local capability gets one exact reconnect action instead of generic attachments', async () => {
  let reauthorizations = 0;
  const rendered = await render('run-actions.tsx', props, {
    bridge: {
      localInputReauthorizationState: async () => ({
        ok: true, applicable: true, required: reauthorizations === 0, label: 'C0360.MP4',
      }),
      reauthorizeRunInputs: async () => { reauthorizations += 1; return { ok: true, recovered: 1 }; },
      onRunInputProgress: () => () => {},
    },
  });
  try {
    const reconnect = rendered.getByText(/Reconnect C0360\.MP4 & continue/);
    assert.equal(rendered.queryByText(/^Send & continue$/), null);
    assert.match(rendered.text(), /does not upload or copy the source/i);
    await rendered.click(reconnect);
    assert.equal(reauthorizations, 1);
    assert.equal(rendered.calls.backend.length, 1);
    assert.equal(rendered.calls.backend[0].path, '/api/v2/me/run-requests');
    assert.deepEqual(JSON.parse(JSON.stringify(
      (rendered.calls.backend[0].init as { body: Record<string, unknown> }).body,
    )), {
      kind: 'continue',
      runId: props.runId,
      source: 'dashboard',
      note: 'The original typed local input has been reauthorized on Desktop. Preserve every completed step and the approved plan; continue from the first pending step.',
    });
  } finally { rendered.cleanup(); }
});

test('changed bytes fail locally and never enqueue a continuation', async () => {
  const rendered = await render('run-actions.tsx', props, {
    bridge: {
      localInputReauthorizationState: async () => ({
        ok: true, applicable: true, required: true, label: 'C0360.MP4',
      }),
      reauthorizeRunInputs: async () => ({ ok: false, error: 'input_digest_mismatch' }),
    },
  });
  try {
    await rendered.click(rendered.getByText(/Reconnect C0360\.MP4 & continue/));
    assert.match(rendered.text(), /not the original file/i);
    assert.equal(rendered.calls.backend.length, 0);
  } finally { rendered.cleanup(); }
});

test('a transient queue failure does not hash the large file a second time', async () => {
  let reauthorizations = 0;
  let queues = 0;
  const rendered = await render('run-actions.tsx', props, {
    bridge: {
      localInputReauthorizationState: async () => ({
        ok: true, applicable: true, required: reauthorizations === 0, label: 'C0360.MP4',
      }),
      reauthorizeRunInputs: async () => { reauthorizations += 1; return { ok: true, recovered: 1 }; },
    },
    backend: () => {
      queues += 1;
      if (queues === 1) throw new Error('temporary queue failure');
      return { ok: true };
    },
  });
  try {
    await rendered.click(rendered.getByText(/Reconnect C0360\.MP4 & continue/));
    assert.equal(reauthorizations, 1);
    assert.ok(rendered.queryByText(/^Continue from approved plan$/));
    await rendered.act(() => rendered.window.dispatchEvent(new rendered.window.Event('focus')));
    assert.ok(rendered.queryByText(/^Continue from approved plan$/),
      'a focus refresh must preserve the already-hashed session authority after a queue refusal');
    await rendered.click(rendered.getByText(/^Continue from approved plan$/));
    assert.equal(reauthorizations, 1, 'the verified 8GB file must not be read again');
    assert.equal(queues, 2);
  } finally { rendered.cleanup(); }
});

test('an already-live authority keeps the ordinary needs-input continuation surface', async () => {
  const rendered = await render('run-actions.tsx', props, {
    bridge: {
      localInputReauthorizationState: async () => ({ ok: true, applicable: true, required: false }),
    },
  });
  try {
    assert.ok(rendered.queryByText(/^Send & continue$/));
    assert.equal(rendered.queryByText(/Reconnect C0360\.MP4 & continue/), null);
  } finally { rendered.cleanup(); }
});

test('returning to a persisted run page rechecks process-local source authority', async () => {
  let probes = 0;
  const rendered = await render('run-actions.tsx', props, {
    bridge: {
      localInputReauthorizationState: async () => ({
        ok: true, applicable: true, required: probes++ > 0, label: 'C0360.MP4',
      }),
    },
  });
  try {
    assert.ok(rendered.queryByText(/^Send & continue$/));
    await rendered.act(() => rendered.window.dispatchEvent(new rendered.window.Event('focus')));
    assert.ok(rendered.queryByText(/Reconnect C0360\.MP4 & continue/));
    assert.equal(probes, 2);
  } finally { rendered.cleanup(); }
});
