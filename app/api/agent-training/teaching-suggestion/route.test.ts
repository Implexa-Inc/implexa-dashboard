import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
const SESSION = '11111111-1111-4111-8111-111111111111';
const code = buildSync({ entryPoints: [fileURLToPath(new URL('./route.ts', import.meta.url))], bundle: true,
  platform: 'node', format: 'cjs', write: false, external: ['next/server', '@/lib/supabase/server'],
  alias: { '@/lib/trainer-questions': fileURLToPath(new URL('../../../../lib/trainer-questions.ts', import.meta.url)) } }).outputFiles[0].text;
function proxy({ signedIn = true, status = 200, offline = false, timedOut = false, invalidReply = false } = {}) {
  const calls: any[] = [], module = { exports: {} as any };
  runInNewContext(code, { module, exports: module.exports, process: { env: {} }, URL, AbortSignal, TextDecoder, Uint8Array,
    require: (name: string) => name === 'next/server' ? { NextResponse: { json: (value: unknown, init: any = {}) => ({ value, status: init.status || 200, headers: init.headers }) } }
      : name === '@/lib/supabase/server' ? { createClient: () => ({ auth: { getSession: async () => ({ data: { session: signedIn ? { access_token: 'server-session' } : null } }) } }) }
        : assert.fail(`Unexpected import ${name}`),
    fetch: async (url: string, init: any) => { calls.push({ url, init }); if (offline) throw Error('private-provider-detail');
      if(timedOut)throw Object.assign(Error('private'),{name:'TimeoutError'});
      return { status, json: async () => {if(invalidReply)throw SyntaxError('private upstream body');return { ok: status === 200 };} }; } });
  return { calls, POST: module.exports.POST, maxDuration: module.exports.maxDuration };
}
function req(body = '{}', query = `sessionId=${SESSION}`) { return new Request(`https://dashboard.test/api/agent-training/teaching-suggestion?${query}`, {
  method: 'POST', headers: { Authorization: 'Bearer browser-forgery' }, body }); }
test('suggestion proxy uses only server authentication and one named route; response is not cached', async () => {
  const p = proxy(), r = await p.POST(req('{"consent":true}'));
  assert.equal(r.status,200); assert.equal(p.maxDuration,45); assert.equal(p.calls[0].url,`https://core.implexa.ai/api/v2/agent-training/sessions/${SESSION}/teaching-suggestion`);
  assert.equal(p.calls[0].init.headers.authorization,'Bearer server-session'); assert.equal(p.calls[0].init.cache,'no-store');
  assert.equal(r.headers['Cache-Control'],'no-store'); assert.equal(p.calls[0].init.body,'{"consent":true}');
});
test('proxy rejects unauthenticated requests, forged target and oversized streaming body before forwarding', async () => {
  const unauth = proxy({ signedIn:false }); assert.equal((await unauth.POST(req())).status,401); assert.equal(unauth.calls.length,0);
  for (const query of [`sessionId=${SESSION}&ownerId=foreign`,`sessionId=${SESSION}&url=https://foreign.test`,'sessionId=../../export']) {
    const p=proxy(); assert.equal((await p.POST(req('{}',query))).status,400); assert.equal(p.calls.length,0);
  }
  const big=proxy(); assert.equal((await big.POST(req('x'.repeat(3*1024*1024+1)))).status,413); assert.equal(big.calls.length,0);
});
test('proxy preserves unavailable and quota outcomes without retry or private error details', async () => {
  const quota=proxy({status:429}); assert.equal((await quota.POST(req())).status,429); assert.equal(quota.calls.length,1);
  const offline=proxy({offline:true}); const r=await offline.POST(req()); assert.equal(r.status,503); assert.equal(offline.calls.length,1);
  assert.equal(r.value.reason,'teaching_suggestion_backend_unreachable');
  assert.doesNotMatch(JSON.stringify(r),/private-provider-detail/);
  const timeout=proxy({timedOut:true});assert.equal((await timeout.POST(req())).value.reason,'teaching_suggestion_proxy_timeout');
  const invalid=proxy({invalidReply:true});assert.equal((await invalid.POST(req())).value.reason,'teaching_suggestion_proxy_response_invalid');
});
test('proxy propagates the browser request abort signal to the backend call', async () => {
  const p = proxy(), controller = new AbortController();
  const request = new Request(`https://dashboard.test/api/agent-training/teaching-suggestion?sessionId=${SESSION}`, {
    method: 'POST', body: '{}', signal: controller.signal });
  await p.POST(request); assert.equal(p.calls[0].init.signal.aborted, false);
  controller.abort(); assert.equal(p.calls[0].init.signal.aborted, true);
});

test('annotation proxy adds only the named owner-authenticated write and preserves its idempotency key',async()=>{
 const p=proxy();const request=new Request(`https://dashboard.test/api/agent-training/teaching-suggestion?sessionId=${SESSION}&operation=annotation`,{
  method:'POST',headers:{'Idempotency-Key':'same-annotation-key'},body:'{"action":"save"}'});
 assert.equal((await p.POST(request)).status,200);assert.equal(p.calls[0].url,`https://core.implexa.ai/api/v2/agent-training/sessions/${SESSION}/demo-annotation`);
 assert.equal(p.calls[0].init.headers.authorization,'Bearer server-session');assert.equal(p.calls[0].init.headers['Idempotency-Key'],'same-annotation-key');
 const denied=proxy();assert.equal((await denied.POST(req('{"action":"save"}',`sessionId=${SESSION}&operation=annotation`))).status,400);assert.equal(denied.calls.length,0);
 const arbitrary=proxy();assert.equal((await arbitrary.POST(req('{}',`sessionId=${SESSION}&operation=export`))).status,400);assert.equal(arbitrary.calls.length,0);
});
