import test from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../../../lib/test/render.ts';

const base = {
  id: '721eea3c-7e89-4a33-bac7-77558797903b',
  kind: 'approve_render',
  label: 'Approve clean-cut render',
  summary: 'Render the approved plan.',
  preset_prompt: null,
  readiness: 'ready',
  blocker: null,
  confidence: 1,
  status: 'acting',
  request_id: '5ac97306-e1b5-4ed4-89e7-a05902f75373',
};

test('an active linked approval request remains queued and cannot be duplicated', async () => {
  const rendered = await render('run-action-items.tsx', {
    runId: '77fd8675-1b02-4881-a59f-c43012d98d9f',
    actions: [{ ...base, linked_request_status: 'consumed', linked_request_lifecycle: 'running' }],
  });
  try {
    assert.match(rendered.text(), /Queued/);
    assert.equal(rendered.queryByText(/^Retry approval$/), null);
  } finally { rendered.cleanup(); }
});

test('a terminal fallback-blocked approval exposes the protected retry action', async () => {
  let calls = 0;
  const rendered = await render('run-action-items.tsx', {
    runId: '77fd8675-1b02-4881-a59f-c43012d98d9f',
    actions: [{ ...base, linked_request_status: 'done', linked_request_lifecycle: 'fallback_blocked' }],
  }, {
    backend: () => { calls += 1; return { ok: true, fulfillment: 'agent_run' }; },
  });
  try {
    assert.doesNotMatch(rendered.text(), /runs hands-off\. Watch it in Active Agents/);
    assert.ok(rendered.queryByText(/^Retry approval$/));
    assert.match(rendered.text(), /stopped safely before completing/i);
    await rendered.click(rendered.getByText(/^Retry approval$/));
    assert.equal(calls, 1);
    assert.match(rendered.text(), /Queued/);
  } finally { rendered.cleanup(); }
});

test('a falsely completed fallback-blocked approval remains recoverable', async () => {
  let calls = 0;
  const rendered = await render('run-action-items.tsx', {
    runId: '77fd8675-1b02-4881-a59f-c43012d98d9f',
    actions: [{
      ...base, status: 'done', linked_request_status: 'done',
      linked_request_lifecycle: 'fallback_blocked',
    }],
  }, {
    backend: () => { calls += 1; return { ok: true, fulfillment: 'agent_run' }; },
  });
  try {
    assert.ok(rendered.queryByText(/^Retry approval$/));
    assert.equal(rendered.queryByText(/— done$/), null);
    await rendered.click(rendered.getByText(/^Retry approval$/));
    assert.equal(calls, 1);
    assert.match(rendered.text(), /Queued/);
  } finally { rendered.cleanup(); }
});

test('a stale broker settlement keeps its completed approval recoverable', async () => {
  let calls = 0;
  const rendered = await render('run-action-items.tsx', {
    runId: '77fd8675-1b02-4881-a59f-c43012d98d9f',
    actions: [{
      ...base, status: 'done', linked_request_status: 'done',
      linked_request_lifecycle: 'failed',
      linked_request_failure_reason: 'input_revalidation_unavailable',
    }],
  }, {
    backend: () => { calls += 1; return { ok: true, fulfillment: 'agent_run' }; },
  });
  try {
    assert.ok(rendered.queryByText(/^Retry approval$/));
    assert.equal(rendered.queryByText(/— done$/), null);
    await rendered.click(rendered.getByText(/^Retry approval$/));
    assert.equal(calls, 1);
    assert.match(rendered.text(), /Queued/);
  } finally { rendered.cleanup(); }
});

test('an unrelated failed approval remains terminal', async () => {
  const rendered = await render('run-action-items.tsx', {
    runId: '77fd8675-1b02-4881-a59f-c43012d98d9f',
    actions: [{
      ...base, status: 'done', linked_request_status: 'done',
      linked_request_lifecycle: 'failed',
      linked_request_failure_reason: 'executor_failed',
    }],
  });
  try {
    assert.equal(rendered.queryByText(/^Retry approval$/), null);
    assert.match(rendered.text(), /— done$/);
  } finally { rendered.cleanup(); }
});

test('cancelled approval recovery remains terminal instead of inventing retry authority', async () => {
  const rendered = await render('run-action-items.tsx', {
    runId: '77fd8675-1b02-4881-a59f-c43012d98d9f',
    actions: [{ ...base, linked_request_status: 'cancelled', linked_request_lifecycle: 'cancelled' }],
  });
  try {
    assert.equal(rendered.queryByText(/^Retry approval$/), null);
    assert.match(rendered.text(), /Queued/);
  } finally { rendered.cleanup(); }
});
