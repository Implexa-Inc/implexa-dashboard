import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render } from './test/render.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packet = JSON.parse(readFileSync(resolve(root, 'fixtures/reviewer-resolution-packet.json'), 'utf8'));
const props = () => ({
  runId: packet.run.id, agentSlug: packet.run.slug, agentName: 'Fixture agent',
  artifacts: packet.artifacts, production: null, issues: structuredClone(packet.issues),
  session: structuredClone(packet.session), sources: packet.sources, isApprovalHold: false,
  initialArtifactId: packet.artifacts[0].id,
});
const resolution = (issueId: string) => ({
  id: crypto.randomUUID(), issueId, reviewSessionId: packet.session.id, reviewSubmissionId: null,
  resolvedAt: '2026-08-12T02:00:00.000Z',
  actor: { kind: 'reviewer_dashboard_user', userId: 'b8178000-0000-4000-8000-000000000001', provenance: { source: 'dashboard', action: 'mark_resolved' } },
});

function jsonResponse(body: unknown, status = 200) {
  return { status, json: async () => body } as Response;
}
const buttons = (room: Awaited<ReturnType<typeof render>>, label: string) =>
  Array.from(room.document.querySelectorAll('button')).filter((button) => button.textContent?.trim() === label);

test('real ReviewRoom renders active actions, collapsed history, Add more, and exact composition copy', async () => {
  const room = await render('review-room.tsx', props());
  try {
    assert.equal(buttons(room, 'Mark as resolved').length, 2);
    assert.ok(room.queryByText('Mark all as resolved'));
    const details = room.document.querySelector('details');
    assert.ok(details); assert.equal(details.open, false);
    assert.match(details.textContent || '', /Resolved \(1\).*Reviewer-resolved history/);
    assert.ok(room.queryByText('Add more feedback'));
    assert.ok(room.queryByText('Send 1 unresolved + 1 new change'));
  } finally { room.cleanup(); }
});

test('Add more feedback stays enabled when the room has zero prior issues', async () => {
  const empty = props();
  empty.issues = [];
  const room = await render('review-room.tsx', empty);
  try {
    const add = room.getByText('Add more feedback') as HTMLButtonElement;
    assert.equal(add.disabled, false);
    assert.equal(buttons(room, 'Mark as resolved').length, 0);
  } finally { room.cleanup(); }
});

test('individual resolve removes only that identity from active composition and preserves collapsed history', async () => {
  const room = await render('review-room.tsx', props());
  try {
    (room.window as unknown as { fetch: typeof fetch }).fetch = async (_url, init) => {
      const b = JSON.parse(String(init?.body)); const rr = resolution(b.issueIds[0]);
      return jsonResponse({ ok: true, resolutions: [rr] });
    };
    await room.click(buttons(room, 'Mark as resolved')[0]);
    assert.equal(buttons(room, 'Mark as resolved').length, 1);
    assert.equal(room.queryByText('Mark all as resolved'), null);
    assert.ok(room.queryByText('Send 0 unresolved + 1 new change'));
    assert.match(room.document.querySelector('details')?.textContent || '', /Resolved \(2\)/);
  } finally { room.cleanup(); }
});

test('Mark all is atomic in the UI and all-resolved renders a clean reviewed state, never retry', async () => {
  const room = await render('review-room.tsx', props());
  try {
    (room.window as unknown as { fetch: typeof fetch }).fetch = async (_url, init) => {
      const b = JSON.parse(String(init?.body));
      return jsonResponse({ ok: true, resolutions: b.issueIds.map(resolution) });
    };
    await room.click(room.getByText('Mark all as resolved'));
    assert.ok(room.queryByText('Review complete'));
    assert.match(room.text(), /All feedback is marked resolved/);
    assert.equal(room.queryByText('Ready to retry'), null);
    assert.ok(room.queryByText('Add more feedback'));
  } finally { room.cleanup(); }
});

test('unresolved + new submit shows and sends the exact server-composed count with no client issue rewrite', async () => {
  const room = await render('review-room.tsx', props());
  const calls: Record<string, unknown>[] = [];
  try {
    (room.window as unknown as { fetch: typeof fetch }).fetch = async (_url, init) => {
      const b = JSON.parse(String(init?.body)); calls.push(b);
      return jsonResponse({ ok: true, requestId: 'b8178000-0000-4000-8000-000000000099', issueCount: 2,
        submissionId: 'b8178000-0000-4000-8000-000000000098', submissionDigest: 'd'.repeat(64),
        session: { ...packet.session, state: 'submitted', submittedIssueIds: packet.issues.slice(0, 2).map((i: { id: string }) => i.id) } });
    };
    await room.click(room.getByText('Send 1 unresolved + 1 new change'));
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], { action: 'submit', sessionId: packet.session.id, revisionNote: '' });
    assert.match(room.text(), /2 changes were sent as one revision/);
  } finally { room.cleanup(); }
});

test('unknown-terminal queued card keeps actions/copy and retries the immutable prior revision only', async () => {
  const queued = props();
  queued.session = { ...queued.session, state: 'submitted', submittedRequestId: 'b8178000-0000-4000-8000-000000000040', submittedIssueIds: queued.issues.slice(0, 2).map((i: { id: string }) => i.id) };
  queued.issues = queued.issues.filter((i: { reviewerResolution: unknown }) => !i.reviewerResolution);
  const room = await render('review-room.tsx', queued, { backend: () => ({ ok: true, state: 'unverifiable', attempt: null }) });
  try {
    assert.match(room.text(), /Couldn’t verify the previous revision/);
    assert.match(room.text(), /If the revisions were not applied in the previous run, you can retry this revision\./);
    assert.ok(room.queryByText('Retry revision'));
    assert.ok(room.queryByText('Mark as resolved'));
    assert.ok(room.queryByText('Mark all as resolved'));
    assert.ok(room.queryByText('Add more feedback'));
    await room.click(room.getByText('Retry revision'));
    const retry = room.calls.backend.find((call) => call.path.endsWith('/recover-review-continuation'));
    assert.ok(retry);
    const init = retry.init as { body?: Record<string, unknown> };
    assert.equal(init.body?.note, undefined);
    assert.equal(init.body?.issueIds, undefined);
  } finally { room.cleanup(); }
});

test('double click is single-flight; rerender adopts durable resolution and a newer draft session', async () => {
  const room = await render('review-room.tsx', props());
  let calls = 0; let finish!: (value: Response) => void;
  try {
    (room.window as unknown as { fetch: typeof fetch }).fetch = async (_url, init) => {
      calls += 1; const b = JSON.parse(String(init?.body));
      return new Promise<Response>((resolvePromise) => { finish = (value) => resolvePromise(value); })
        .then((value) => value || jsonResponse({ ok: true, resolutions: [resolution(b.issueIds[0])] }));
    };
    const button = buttons(room, 'Mark as resolved')[0];
    await room.act(() => {
      button.dispatchEvent(new room.window.MouseEvent('click', { bubbles: true }));
      button.dispatchEvent(new room.window.MouseEvent('click', { bubbles: true }));
    });
    assert.equal(calls, 1);
    finish(jsonResponse({ ok: true, resolutions: [resolution(packet.issues[0].id)] }));
    await room.act(async () => { await Promise.resolve(); });

    const incoming = props();
    incoming.issues[0].reviewerResolution = resolution(incoming.issues[0].id);
    incoming.session = { ...incoming.session, id: 'b8178000-0000-4000-8000-000000000077', state: 'draft' };
    await room.rerender(incoming);
    assert.ok(room.queryByText('Send 0 unresolved + 1 new change'));
    assert.match(room.document.querySelector('details')?.textContent || '', /Resolved \(2\)/);
  } finally { room.cleanup(); }
});
