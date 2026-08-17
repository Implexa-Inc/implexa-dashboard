// node --test lib/agent-detail.test.ts
//
// The envelope reader behind /workflows/[slug]. What must hold:
//   - HONESTY: 'ready' / 'not_found' / 'unavailable' stay distinct — a dead
//     backend must never render as a missing agent (the old page collapsed
//     both into notFound; the new page keeps its schedule-only fallback for
//     both, but the reader itself must not lie).
//   - the mapped sections go through the SAME mappers the legacy reads used,
//     so the Runs tab's resolver-row filter and the checklist defaults are
//     identical to the pre-envelope page.
//   - exactly ONE fetch, bearer-authed, cache: 'no-store'.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getAgentDetail } from './agent-detail.ts';

const ENVELOPE = {
  ok: true,
  slug: 'daily-brief',
  workflow: {
    id: 'wf-1',
    source: 'generated',
    slug: 'daily-brief',
    name: 'Daily Brief',
    description: 'Morning digest. Extra sentence that should not ride the why.',
    primary_outcome: 'A morning digest in your inbox.',
    steps: [],
    versions: [{ version: 2, summary: null, source: 'revise', at: '2026-08-01T00:00:00Z' }],
    workflow_version_id: 'wv-2',
    input_contract: { version: 1, fields: [] },
    input_contract_digest: 'a'.repeat(64),
    run_input_version_source: 'installed',
    update_available: null,
    activity: { run_count: 4, apply_count: 0, scheduled_count: 1, last_run_at: null },
  },
  checklist: { ok: true, slug: 'daily-brief', name: 'Daily Brief', state: 'active', canActivate: true, stepsLeft: 0, steps: [], pendingQuestions: 2 },
  connections: {
    warnings: [
      { agent_slug: 'daily-brief', agent_name: 'Daily Brief', label: 'Gmail', account: 'gmail.com', domain: 'gmail.com', reason: 'never verified', detected_at: '2026-08-12T00:00:00Z' },
    ],
    needs: [], requiresBrowser: false, ok: false,
  },
  grade: { hasGrade: true, rate: 0.87, label: 'reliable', runs: 20, confidence: 0.66 },
  gradeVisibility: 'private',
  judgePolicy: 'observe',
  schedules: [
    { id: 'sch-1', skill_slug: 'daily-brief', schedule_nl: 'every morning', cron_expression: '0 9 * * *', status: 'active', last_run_at: null, run_count: 4, destination: { type: 'dashboard' }, claude_task_id: null, trigger_type: 'cron', fire_at: null },
  ],
  runs: {
    items: [
      { id: 'r1', skill_slug: 'daily-brief', source: 'scheduled', status: 'completed', ran_at: '2026-08-11T00:00:00Z', output_markdown: 'the digest', review_status: 'pending' },
      { id: 'r2', skill_slug: 'daily-brief', source: 'scheduled', status: 'completed', ran_at: '2026-08-10T00:00:00Z', output_markdown: 'Resolver row opened during continue', review_status: 'reviewed' },
    ],
    recommendations: { r1: [{ slug: 'next-agent', reason: 'pairs well' }] },
    judgments: { r1: { id: 'j1', verdict: 'delivered', summary: 'looks right', next_action: null } },
  },
  lifecycle: { requests: [{ status: 'pending', kind: 'run', created_at: '2026-08-11T23:00:00Z' }], runningRun: false },
  unavailable: [],
  timings: { total: 120 },
};

function fetchStub(status: number, body?: unknown) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

test('ready: one bearer-authed no-store fetch; sections map through the shared mappers', async () => {
  const { impl, calls } = fetchStub(200, ENVELOPE);
  const out = await getAgentDetail('daily-brief', 'jwt-123', { fetchImpl: impl });
  assert.equal(out.status, 'ready');
  assert.equal(calls.length, 1, 'exactly one request supplies the page');
  assert.match(calls[0].url, /\/api\/v2\/me\/agents\/daily-brief\/detail$/);
  assert.equal((calls[0].init.headers as Record<string, string>).authorization, 'Bearer jwt-123');
  assert.equal(calls[0].init.cache, 'no-store');

  if (out.status !== 'ready') return;
  const d = out.detail;
  assert.equal(d.workflow.slug, 'daily-brief');
  assert.equal(d.workflow.workflow_version_id, 'wv-2', 'installed version authority survives the mapping');
  assert.equal(d.checklist?.state, 'active');
  assert.equal(d.checklist?.pendingQuestions, 2);
  assert.equal(d.connectionWarnings.length, 1);
  assert.equal(d.connectionWarnings[0].agent_slug, 'daily-brief');
  assert.equal(d.grade?.rate, 0.87);
  assert.equal(d.judgePolicy, 'observe');
  assert.equal(d.routines.length, 1);
  assert.equal(d.lifecycle?.requests.length, 1);
  assert.equal(d.lifecycle?.runningRun, false);
});

test('runs map exactly like loadInboxItems did: resolver rows dropped, recs + judgments attached, name/why from THIS workflow', async () => {
  const { impl } = fetchStub(200, ENVELOPE);
  const out = await getAgentDetail('daily-brief', 'jwt-123', { fetchImpl: impl });
  assert.equal(out.status, 'ready');
  if (out.status !== 'ready') return;
  const runs = out.detail.runs;
  assert.equal(runs.length, 1, 'the "Resolver row opened…" bookkeeping row must be dropped');
  assert.equal(runs[0].id, 'r1');
  assert.equal(runs[0].name, 'Daily Brief');
  assert.equal(runs[0].why, 'A morning digest in your inbox.');
  assert.equal(runs[0].pending, true);
  assert.equal(runs[0].recommendations?.length, 1);
  assert.equal(runs[0].judgment?.verdict, 'delivered');
});

test('HONESTY: 404 is not_found, 5xx is unavailable, a network failure is unavailable — never conflated', async () => {
  assert.deepEqual(await getAgentDetail('x', 't', { fetchImpl: fetchStub(404).impl }), { status: 'not_found' });
  assert.deepEqual(await getAgentDetail('x', 't', { fetchImpl: fetchStub(503).impl }), { status: 'unavailable' });
  const throwing = (async () => { throw new Error('network down'); }) as unknown as typeof fetch;
  assert.deepEqual(await getAgentDetail('x', 't', { fetchImpl: throwing }), { status: 'unavailable' });
});

test('a 200 with a hollow body (no workflow) is unavailable, not an empty page', async () => {
  const { impl } = fetchStub(200, { ok: true });
  assert.deepEqual(await getAgentDetail('x', 't', { fetchImpl: impl }), { status: 'unavailable' });
});

test('a DEGRADED section is reported as unknown — its empty value must never be read as an answer', async () => {
  // This test previously asserted the opposite ("null checklist → the Activate
  // path, as before", "no connections read → no banner, as before"), which
  // pinned the fail-open: an unreadable check rendered as a passed one. The
  // values are unchanged — they are the calm defaults — but they are no longer
  // the whole story, and isUnavailable is what callers must branch on.
  const { impl } = fetchStub(200, {
    ...ENVELOPE,
    checklist: null,
    connections: null,
    grade: null,
    judgePolicy: null,
    lifecycle: null,
    runs: { items: [], recommendations: {}, judgments: {} },
    unavailable: ['activation', 'connections', 'grade', 'judge_policy', 'lifecycle'],
  });
  const out = await getAgentDetail('daily-brief', 'jwt-123', { fetchImpl: impl });
  assert.equal(out.status, 'ready');
  if (out.status !== 'ready') return;
  const d = out.detail;
  for (const section of ['activation', 'connections', 'grade', 'judge_policy', 'lifecycle'] as const) {
    assert.equal(d.isUnavailable(section), true, `${section} must report as unavailable, not merely empty`);
  }
  assert.equal(d.checklist, null, 'the value is still the calm default…');
  assert.equal(d.isUnavailable('activation'), true, '…but callers can tell it apart from "no checklist"');
  assert.deepEqual(d.connectionWarnings, [], 'no warnings…');
  assert.equal(d.isUnavailable('connections'), true, '…is NOT a clean bill of health here');
});

test('a section that is genuinely empty is NOT reported unavailable', async () => {
  // The other half of the discrimination: a healthy agent with no warnings and
  // no grade yet must not light up the unavailable notice.
  const { impl } = fetchStub(200, {
    ...ENVELOPE,
    connections: { warnings: [], needs: [], requiresBrowser: false, ok: true },
    grade: null,
    unavailable: [],
  });
  const out = await getAgentDetail('daily-brief', 'jwt-123', { fetchImpl: impl });
  assert.equal(out.status, 'ready');
  if (out.status !== 'ready') return;
  assert.deepEqual(out.detail.connectionWarnings, []);
  assert.equal(out.detail.isUnavailable('connections'), false);
  assert.equal(out.detail.grade, null);
  assert.equal(out.detail.isUnavailable('grade'), false);
});

test('a malformed unavailable list cannot smuggle a section in as "available"', async () => {
  const { impl } = fetchStub(200, { ...ENVELOPE, unavailable: ['activation', 42, null, 'connections'] });
  const out = await getAgentDetail('daily-brief', 'jwt-123', { fetchImpl: impl });
  assert.equal(out.status, 'ready');
  if (out.status !== 'ready') return;
  assert.equal(out.detail.isUnavailable('activation'), true);
  assert.equal(out.detail.isUnavailable('connections'), true);
  assert.deepEqual(out.detail.unavailable, ['activation', 'connections'], 'non-strings dropped, real names kept');
});

test('?source= rides the query string', async () => {
  const { impl, calls } = fetchStub(200, ENVELOPE);
  await getAgentDetail('daily-brief', 'jwt-123', { source: 'community', fetchImpl: impl });
  assert.match(calls[0].url, /\?source=community$/);
});
