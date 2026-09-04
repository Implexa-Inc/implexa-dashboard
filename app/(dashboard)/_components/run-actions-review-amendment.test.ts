import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { render } from '../../../lib/test/render.ts';

const props = { runId: 'a26ceaec-f722-46cf-acc6-171c503c7c69', agentName: 'Clean cut',
  reviewStatus: 'needs_input', holdKind: 'needs_input', hasShipStep: true };
const href = '/review/50b541e5-a784-4539-9b54-6ee86a14ef81?artifact=929fb720-f2e0-4630-903a-3f2135a68bf7';

for (const reviewStatus of ['needs_input','pending']) test(`held Review ${reviewStatus} offers amendment navigation, not a generic retry`, async () => {
  let probes = 0;
  const rendered = await render('run-actions.tsx', { ...props, reviewStatus, reviewAmendment: { state: 'ready', href } }, {
    bridge: { localInputReauthorizationState: async () => { probes++; return { ok: true, applicable: true, required: true }; } },
  });
  try {
    assert.equal(rendered.getByText(/^Update feedback in Review Room$/).getAttribute('href'), href);
    assert.equal(rendered.queryByText(/^Send & continue$/), null);
    assert.equal(rendered.queryByText(/^Approve & finish$/), null);
    assert.equal(rendered.document.querySelector('textarea'), null);
    assert.match(rendered.text(), /Opening Review Room does not start a run/);
    assert.equal(rendered.calls.backend.length, 0);
    assert.equal(probes, 0);
  } finally { rendered.cleanup(); }
});

test('unavailable exact Review origin does not guess a parent or expose a retry', async () => {
  const rendered = await render('run-actions.tsx', { ...props, reviewAmendment: { state: 'unavailable' } });
  try {
    assert.ok(rendered.queryByText(/^Reload run details$/));
    assert.equal(rendered.document.querySelector('a'), null);
    assert.equal(rendered.queryByText(/^Send & continue$/), null);
    await rendered.click(rendered.getByText(/^Reload run details$/));
    assert.equal(rendered.calls.backend.length, 0);
  } finally { rendered.cleanup(); }
});

test('ordinary needs-input run retains its existing continuation controls', async () => {
  const rendered = await render('run-actions.tsx', props);
  try {
    assert.ok(rendered.queryByText(/^Send & continue$/));
    assert.equal(rendered.queryByText(/^Update feedback in Review Room$/), null);
  } finally { rendered.cleanup(); }
});

test('run detail passes the exact authenticated origin resolver into the rendered action surface', () => {
  const page = readFileSync(new URL('../runs/[id]/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /loadReviewAmendmentTarget\(supabase, session\.user\.id, r\.id, r\.continued_from_run_id \?\? null\)/);
  assert.match(page, /reviewAmendment=\{reviewAmendment\}/);
});
