import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const RUN = '11111111-1111-4111-8111-111111111111';
const ARTIFACT = '22222222-2222-4222-8222-222222222222';
const url = `https://dashboard.test/api/agent-training/run-review?slug=video-studio&runId=${RUN}`;
const code = buildSync({ entryPoints: [fileURLToPath(new URL('./route.ts', import.meta.url))], bundle: true,
  platform: 'node', format: 'cjs', write: false, supported: { 'dynamic-import': false },
  external: ['next/server', '@/lib/supabase/server', '@/lib/workflow-catalog'],
  alias: Object.fromEntries(['review', 'training-review-routing', 'trainer-questions']
    .map(name => [`@/lib/${name}`, fileURLToPath(new URL(`../../../../lib/${name}.ts`, import.meta.url))])) }).outputFiles[0].text;

function packet() {
  return { ok: true,
    run: { id: RUN, slug: 'video-studio', runState: 'delivered', status: 'completed', reviewStatus: null, holdKind: null, startedAt: null },
    lineage: { rootRunId: RUN, versions: [{ runId: RUN, label: 'Original', runState: 'delivered', startedAt: null }] },
    artifacts: [{ id: ARTIFACT, runId: RUN, relativePath: 'run-outputs/video.mp4', role: 'final_output',
      status: 'validated', sha256: 'a'.repeat(64), sizeBytes: 100, mtime: null, validatedAt: null }],
    historicalCandidates: [], judgment: null, verification: { receipts: [] },
    production: null, session: null, reviewArtifacts: [], issues: [],
    sources: Object.fromEntries(['run','lineage','artifacts','judgment','verification','production','session','issues',
      'reviewer_resolutions','review_artifacts','historical_candidates'].map(key => [key, 'ready'])),
  };
}
function reader({ signedIn = true, owned = true, rosterUnavailable = false, status = 200,
  body = packet(), offline = false } = {}) {
  const calls: Array<{ url: string; init: any }> = [], rosterTokens: string[] = [];
  const module = { exports: {} as any };
  runInNewContext(code, { module, exports: module.exports, process: { env: {} }, URL, AbortSignal,
    require: (name: string) => name === 'next/server'
      ? { NextResponse: { json: (value: unknown, init: any = {}) => ({ value, status: init.status || 200, headers: init.headers }) } }
      : name === '@/lib/supabase/server'
        ? { createClient: () => ({ auth: { getSession: async () => ({ data: { session: signedIn ? { access_token: 'server-session' } : null } }) } }) }
        : name === '@/lib/workflow-catalog'
          ? { readMyWorkflows: async (token: string) => { rosterTokens.push(token); return rosterUnavailable
            ? { status: 'unavailable', reason: 'network' }
            : { status: 'ready', workflows: owned ? [{ slug: 'video-studio', source: 'generated', name: 'Video Studio' }] : [] }; } }
          : assert.fail(`Unexpected import ${name}`),
    fetch: async (url: string, init: any) => { calls.push({ url, init }); if (offline) throw Error('private transport detail');
      return { ok: status === 200, status, json: async () => body }; },
  });
  return { GET: module.exports.GET, calls, rosterTokens };
}

test('embedded review uses the canonical parser and server session, returning only ReviewRoom data', async () => {
  const p = reader(), response = await p.GET(new Request(url, { headers: { Authorization: 'Bearer forged' } }));
  assert.equal(response.status, 200);
  assert.equal(response.value.contractVersion, 'training-run-review.v1');
  assert.equal(response.value.review.trainingSlug, 'video-studio');
  assert.equal(response.value.review.agentName, 'Video Studio');
  assert.equal(response.value.review.runId, RUN);
  assert.equal(response.value.review.artifacts[0].id, ARTIFACT);
  assert.equal(response.value.review.currentVersionLabel, 'Original');
  assert.equal(response.value.review.isApprovalHold, false);
  assert.equal(response.value.review.judgment, undefined);
  assert.equal(response.value.review.managerProof, undefined);
  assert.equal(response.headers['Cache-Control'], 'no-store');
  assert.equal(p.calls.length, 1);
  assert.equal(p.calls[0].url, `https://core.implexa.ai/api/v2/review/runs/${RUN}`);
  assert.equal(p.calls[0].init.headers.authorization, 'Bearer server-session');
  assert.equal(p.calls[0].init.cache, 'no-store');
  assert.deepEqual(p.rosterTokens, ['server-session']);
});

test('embedded review refuses wrong agent, nonowner and action-approval sources', async () => {
  for (const p of [reader({ owned: false }), reader({ body: { ...packet(), run: { ...packet().run, slug: 'another-agent' } } }),
    reader({ body: { ...packet(), run: { ...packet().run, holdKind: 'approval_before_action' } } })]) {
    const response = await p.GET(new Request(url));
    assert.equal(response.status, 404);
    assert.equal(response.value.reason, 'training_review_not_found');
    assert.equal(response.value.review, undefined);
  }
});

test('embedded review distinguishes absent work from unavailable reads without leaking packets', async () => {
  const missing = await reader({ status: 404 }).GET(new Request(url));
  assert.equal(missing.status, 404);
  assert.equal(missing.value.reason, 'training_review_not_found');
  for (const p of [reader({ offline: true }), reader({ rosterUnavailable: true }),
    reader({ body: { ...packet(), artifacts: [{ ...packet().artifacts[0], runId: 'different-run' }] } })]) {
    const response = await p.GET(new Request(url));
    assert.equal(response.status, 503);
    assert.equal(response.value.reason, 'training_review_unavailable');
    assert.equal(response.value.review, undefined);
    assert.doesNotMatch(JSON.stringify(response), /private transport detail/);
  }
});

test('embedded review authenticates and rejects forged or ambiguous query scope before reading', async () => {
  const anonymous = reader({ signedIn: false });
  assert.equal((await anonymous.GET(new Request(url))).status, 401);
  assert.equal(anonymous.calls.length, 0);
  for (const query of [`slug=video-studio&runId=${RUN}&ownerId=foreign`, `slug=../other&runId=${RUN}`,
    `slug=video-studio&runId=invalid`, `slug=video-studio&slug=another&runId=${RUN}`]) {
    const p = reader();
    assert.equal((await p.GET(new Request(`https://dashboard.test/api/agent-training/run-review?${query}`))).status, 400);
    assert.equal(p.calls.length, 0);
    assert.equal(p.rosterTokens.length, 0);
  }
});
