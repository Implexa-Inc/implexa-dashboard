import test from 'node:test';
import assert from 'node:assert/strict';
import { loadReviewAmendmentTarget } from './review-amendment-target.ts';
import type { SupabaseClient } from '@supabase/supabase-js';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function fixture() {
  const request = { id: id(4), user_id: id(1), organization_id: id(9), run_id: id(2), kind: 'continue',
    source: 'review_room', origin_review_session_id: id(5) };
  const session = { id: id(5), user_id: id(1), organization_id: id(9), run_id: id(3), selected_artifact_id: id(6) };
  const tables: Record<string, unknown[]> = { run_requests: [request], run_review_sessions: [session] };
  const calls: unknown[] = [];
  const db = { from(table: string) {
    calls.push(table);
    const q = { select: () => q, eq: (key: string, value: string) => { calls.push([key, value]); return q; },
      limit: async () => ({ data: tables[table], error: null }) };
    return q;
  } } as unknown as Pick<SupabaseClient, 'from'>;
  return { request, session, tables, calls, db, run: () => loadReviewAmendmentTarget(db, id(1), id(2), id(3)) };
}
test('exact child request navigates to original adopted artifact, not child or newest same-agent run', async () => {
  const f = fixture();
  assert.deepEqual(await f.run(), { state: 'ready', href: `/review/${id(3)}?artifact=${id(6)}` });
  assert.ok(f.calls.some(call => JSON.stringify(call) === JSON.stringify(['run_id', id(2)])));
  assert.ok(f.calls.some(call => JSON.stringify(call) === JSON.stringify(['id', id(5)])));
});
test('ordinary root and non-Review continuation retain ordinary actions', async () => {
  const f = fixture();
  assert.equal(await loadReviewAmendmentTarget(f.db, id(1), id(2), null), null);
  assert.equal(f.calls.length, 0);
  f.tables.run_requests = []; assert.equal(await f.run(), null);
});
for (const mutation of ['owner','parent','session','org','ambiguous','missing','bad artifact','unreadable']) {
  test(`Review navigation fails closed: ${mutation}`, async () => {
    const f = fixture();
    if (mutation === 'owner') f.session.user_id = id(99);
    if (mutation === 'parent') f.session.run_id = id(99);
    if (mutation === 'session') f.session.id = id(99);
    if (mutation === 'org') f.session.organization_id = id(99);
    if (mutation === 'ambiguous') f.tables.run_requests.push({ ...f.request });
    if (mutation === 'missing') f.tables.run_review_sessions = [];
    if (mutation === 'bad artifact') f.session.selected_artifact_id = 'https://wrong.example';
    if (mutation === 'unreadable') delete f.tables.run_review_sessions;
    assert.deepEqual(await f.run(), { state: 'unavailable' });
  });
}
