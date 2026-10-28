import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readHumanReview } from './human-review-read.ts';

function fixture(runDecision: unknown = null, association: unknown = null, linkedDecision: unknown = null, fail = '') {
  const reads: Array<{ table: string; filters: Record<string, unknown> }> = [];
  const client = { from(table: string) {
    const filters: Record<string, unknown> = {};
    const q = { select() { return q; }, eq(k: string, v: unknown) { filters[k] = v; return q; },
      order() { return q; }, limit() { return q; }, async maybeSingle() {
        reads.push({ table, filters });
        const path = table === 'run_learning_outcome_associations' ? 'association' : filters.id ? 'linked' : 'run';
        if (fail === `${path}-throw`) throw Error('unavailable');
        if (fail === path) return { data: null, error: Error('unavailable') };
        return { data: path === 'association' ? association : path === 'linked' ? linkedDecision : runDecision, error: null };
      } };
    return q;
  } };
  return { client: client as unknown as Parameters<typeof readHumanReview>[0], reads };
}

test('no human decision stays unrecorded even when delivery succeeded; no unassociated event becomes attempt evidence', async () => {
  const f = fixture();
  assert.deepEqual(await readHumanReview(f.client, 'owner', 'run', 'attempt'), { humanReview: 'not_recorded', associatedHumanReview: 'not_associated' });
  const accepted = fixture({ decision: 'accepted' });
  assert.deepEqual(await readHumanReview(accepted.client, 'owner', 'run', 'attempt'), { humanReview: 'accepted', associatedHumanReview: 'not_associated' });
});

test('attempt uses its linked event instead of the run latest decision, with owner/run/context scopes', async () => {
  const f = fixture({ decision: 'requested_changes' }, { acceptance_event_id: 'linked-event' }, { decision: 'accepted' });
  assert.deepEqual(await readHumanReview(f.client, 'owner', 'run', 'attempt'), { humanReview: 'changes_requested', associatedHumanReview: 'accepted' });
  assert.ok(f.reads.some(r => r.table === 'run_learning_outcome_associations' && r.filters.owner_id === 'owner' && r.filters.attempt_context_id === 'attempt'));
  assert.ok(f.reads.some(r => r.table === 'run_acceptance_events' && r.filters.id === 'linked-event' && r.filters.user_id === 'owner' && r.filters.run_id === 'run'));
});

test('read failures, broken associations and unknown decisions are unavailable, never pending or accepted', async () => {
  for (const fail of ['run', 'run-throw', 'association', 'association-throw', 'linked', 'linked-throw']) {
    const f = fixture({ decision: 'accepted' }, { acceptance_event_id: 'linked-event' }, { decision: 'accepted' }, fail);
    const result = await readHumanReview(f.client, 'owner', 'run', 'attempt');
    assert.equal(fail.startsWith('run') ? result.humanReview : result.associatedHumanReview, 'unavailable');
  }
  for (const association of [{}, { acceptance_event_id: 'missing' }]) {
    const f = fixture({ decision: 'unexpected' }, association, null);
    assert.deepEqual(await readHumanReview(f.client, 'owner', 'run', 'attempt'), { humanReview: 'unavailable', associatedHumanReview: 'unavailable' });
  }
  const f = fixture(null, { acceptance_event_id: 'linked-event' }, { decision: 'requested_changes' });
  assert.equal((await readHumanReview(f.client, 'owner', 'run', 'attempt')).associatedHumanReview, 'changes_requested');
});
