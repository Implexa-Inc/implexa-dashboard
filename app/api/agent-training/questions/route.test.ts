import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const SESSION = '11111111-1111-4111-8111-111111111111';
const QUESTION = '22222222-2222-4222-8222-222222222222';
const RECORD = '33333333-3333-4333-8333-333333333333';
const body = { questionReceiptId: QUESTION, questionReceiptDigest: 'a'.repeat(64), recordId: RECORD,
  expectedRecordDigest: 'b'.repeat(64), rawAnswer: 'Keep the raw trainer wording private.', expectedActiveVersionId: SESSION };
const code = buildSync({ entryPoints: [fileURLToPath(new URL('./route.ts', import.meta.url))], bundle: true,
  platform: 'node', format: 'cjs', write: false, external: ['next/server', '@/lib/supabase/server'],
  alias: { '@/lib/trainer-questions': fileURLToPath(new URL('../../../../lib/trainer-questions.ts', import.meta.url)) } }).outputFiles[0].text;
function proxy({ signedIn = true, status = 200, unavailable = false } = {}) {
  const calls: Array<{ url: string; init: any }> = []; const module = { exports: {} as any };
  runInNewContext(code, { module, exports: module.exports, process: { env: {} }, URL, URLSearchParams, AbortSignal, TextEncoder,
    require: (name: string) => name === 'next/server' ? { NextResponse: { json: (value: unknown, init: any = {}) => ({ value, status: init.status || 200, headers: init.headers }) } }
      : name === '@/lib/supabase/server' ? { createClient: () => ({ auth: { getSession: async () => ({ data: { session: signedIn ? { access_token: 'server-session' } : null } }) } }) }
        : assert.fail(`Unexpected import ${name}`),
    fetch: async (url: string, init: any) => { calls.push({ url, init }); if (unavailable) throw Error('offline'); return { status, json: async () => ({ ok: status === 200, reason: status === 200 ? null : 'question_answer_conflict' }) }; },
  });
  return { calls, GET: module.exports.GET, POST: module.exports.POST };
}

test('question proxy uses the server session and only its named bounded read/link paths', async () => {
  const p = proxy();
  const get = await p.GET(new Request('https://dashboard.test/api/agent-training/questions?slug=video-craft&limit=20'));
  assert.equal(get.status, 200); assert.equal(p.calls[0].url, 'https://core.implexa.ai/api/v2/agent-training/agents/video-craft/questions?limit=20');
  assert.equal(p.calls[0].init.headers.authorization, 'Bearer server-session'); assert.equal(p.calls[0].init.cache, 'no-store');
  const post = await p.POST(new Request(`https://dashboard.test/api/agent-training/questions?sessionId=${SESSION}`, {
    method: 'POST', headers: { Authorization: 'Bearer browser-supplied', 'Idempotency-Key': `question-answer:${QUESTION}:${RECORD}` }, body: JSON.stringify(body) }));
  assert.equal(post.status, 200); assert.equal(p.calls[1].url, `https://core.implexa.ai/api/v2/agent-training/sessions/${SESSION}/question-answers`);
  assert.equal(p.calls[1].init.headers.authorization, 'Bearer server-session');
  assert.equal(p.calls[1].init.headers['Idempotency-Key'], `question-answer:${QUESTION}:${RECORD}`);
  assert.deepEqual(JSON.parse(p.calls[1].init.body), body);
});

test('question proxy denies unauthenticated calls, forged scope, malformed identities and unbounded cursors', async () => {
  const noAuth = proxy({ signedIn: false });
  assert.equal((await noAuth.GET(new Request('https://dashboard.test/api/agent-training/questions?slug=video-craft'))).status, 401);
  assert.equal(noAuth.calls.length, 0);
  for (const query of ['slug=video-craft&ownerId=foreign', 'slug=../export', 'slug=video-craft&limit=21',
    'slug=video-craft&afterCreatedAt=2026-10-27T00:00:00Z', 'slug=video-craft&afterId=']) {
    const p = proxy(); assert.equal((await p.GET(new Request(`https://dashboard.test/api/agent-training/questions?${query}`))).status, 400); assert.equal(p.calls.length, 0);
  }
  for (const patch of [{ ownerId: SESSION }, { recordId: [RECORD] }, { expectedRecordDigest: 'invalid' }]) {
    const p = proxy(); const response = await p.POST(new Request(`https://dashboard.test/api/agent-training/questions?sessionId=${SESSION}`, {
      method: 'POST', headers: { 'Idempotency-Key': 'stable-operation' }, body: JSON.stringify({ ...body, ...patch }) }));
    assert.equal(response.status, 400); assert.equal(p.calls.length, 0);
  }
});

test('question proxy preserves conflicts and reports transport unavailability without claiming a mutation', async () => {
  const conflict = proxy({ status: 409 });
  assert.equal((await conflict.POST(new Request(`https://dashboard.test/api/agent-training/questions?sessionId=${SESSION}`, {
    method: 'POST', headers: { 'Idempotency-Key': 'stable-operation' }, body: JSON.stringify(body) }))).status, 409);
  const offline = proxy({ unavailable: true });
  const response = await offline.GET(new Request('https://dashboard.test/api/agent-training/questions?slug=video-craft'));
  assert.equal(response.status, 503); assert.equal(response.value.reason, 'trainer_questions_unavailable');
});
