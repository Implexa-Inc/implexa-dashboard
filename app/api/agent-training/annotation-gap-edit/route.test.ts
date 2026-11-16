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
  return {calls,POST:module.exports.POST,GET:module.exports.GET};
}
function req(body = '{}', query = `sessionId=${SESSION}`) { return new Request(`https://dashboard.test/api/agent-training/annotation-gap-edit?${query}`, {
  method: 'POST', headers: { Authorization: 'Bearer browser-forgery' }, body }); }
test('GET and reviewed queue forward to one existing owner-authenticated backend route',async()=>{
 const p=proxy();const response=await p.GET(new Request(`https://dashboard.test/api/agent-training/annotation-gap-edit?sessionId=${SESSION}&limit=20`));
 assert.equal(response.status,200);assert.match(p.calls[0].url,new RegExp(`/sessions/${SESSION}/annotation-gap-edit\\?limit=20$`));
 assert.equal(p.calls[0].init.headers.authorization,'Bearer server-session');assert.equal(response.headers['Cache-Control'],'no-store');
 const body={action:'queue',note:'A reviewed generic setup change.'};await p.POST(req(JSON.stringify(body)));
 assert.deepEqual(JSON.parse(p.calls[1].init.body),body);assert.equal(p.calls.length,2);
 await p.GET(new Request(`https://dashboard.test/api/agent-training/annotation-gap-edit?sessionId=${SESSION}&requestEventId=${SESSION}`));assert.match(p.calls[2].url,/requestEventId=/);
});
test('malformed scopes/cursors and oversized bodies are rejected before forwarding; failures do not retry',async()=>{
 for(const query of [`sessionId=${SESSION}&ownerId=other`,`sessionId=${SESSION}&sessionId=${SESSION}`,`sessionId=${SESSION}&afterId=${SESSION}`,`sessionId=${SESSION}&limit=51`,`sessionId=${SESSION}&requestEventId=bad`,`sessionId=${SESSION}&requestEventId=${SESSION}&afterCreatedAt=2026-11-15T00:00:00Z&afterId=${SESSION}`]){
  const p=proxy();assert.equal((await p.GET(new Request(`https://dashboard.test/api/agent-training/annotation-gap-edit?${query}`))).status,400);assert.equal(p.calls.length,0);
 }
 const unauth=proxy({signedIn:false});assert.equal((await unauth.POST(req())).status,401);assert.equal(unauth.calls.length,0);
 const large=proxy();assert.equal((await large.POST(req('x'.repeat(10001)))).status,413);assert.equal(large.calls.length,0);
 const offline=proxy({offline:true});const r=await offline.POST(req());assert.equal(r.status,503);assert.equal(offline.calls.length,1);assert.doesNotMatch(JSON.stringify(r),/private-provider-detail/);
});
