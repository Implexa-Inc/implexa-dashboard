import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { buildSync } from 'esbuild';

type ResumeLookup = (slug: string, jwt: string) => Promise<unknown>;

function loadGetAgentResume(): ResumeLookup {
  const built = buildSync({
    entryPoints: [join(import.meta.dirname, 'agent-discovery.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
    tsconfig: join(import.meta.dirname, '..', 'tsconfig.json'),
  }).outputFiles[0].text;
  const module = { exports: {} as { getAgentResume?: ResumeLookup } };
  new Function('module', 'exports', 'require', built)(module, module.exports, createRequire(import.meta.url));
  assert.equal(typeof module.exports.getAgentResume, 'function');
  return module.exports.getAgentResume!;
}

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

test('detail lookup distinguishes authoritative absence from outages and malformed success', async (t) => {
  const getAgentResume = loadGetAgentResume();
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  globalThis.fetch = async () => response(404, { error: 'not found' });
  assert.deepEqual(await getAgentResume('ordinary-workflow', 'jwt'), { status: 'not_marketplace' });

  globalThis.fetch = async () => response(503, { error: 'readiness unavailable' });
  assert.deepEqual(await getAgentResume('marketplace-agent', 'jwt'), { status: 'unavailable', reason: 'readiness unavailable' });

  globalThis.fetch = async () => { throw new Error('network down'); };
  assert.deepEqual(await getAgentResume('marketplace-agent', 'jwt'), { status: 'unavailable', reason: 'network down' });

  globalThis.fetch = async () => response(200, { ok: true });
  assert.deepEqual(await getAgentResume('marketplace-agent', 'jwt'), { status: 'unavailable', reason: 'Agent resume response was incomplete.' });
});

test('one agent page distinguishes public fallback from an unread acquisition authority', async () => {
  const {agentPageReadMode}=await import('./agent-detail.ts');
  const ready=(owner:boolean)=>({status:'ready',detail:{canInspectOwnLearningInfluence:owner}} as any);
  assert.deepEqual(agentPageReadMode(ready(false),{status:'unavailable',reason:'outage'}),{mode:'detail',discoveryUnavailable:true});
  assert.deepEqual(agentPageReadMode(ready(true),{status:'unavailable',reason:'outage'}),{mode:'detail',discoveryUnavailable:true});
  assert.deepEqual(agentPageReadMode({status:'not_found'},{status:'unavailable',reason:'outage'}),{mode:'unavailable'});
  assert.deepEqual(agentPageReadMode({status:'unavailable'},{status:'found',agent:{id:'public'} as any}),{mode:'public',agent:{id:'public'}});
  assert.deepEqual(agentPageReadMode({status:'not_found'},{status:'not_marketplace'}),{mode:'schedule'});
});
