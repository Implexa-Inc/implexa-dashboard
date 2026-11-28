import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import './support/tsx-register.mjs';

// Execute the production route with Auth/read-model fixtures. Cache behavior is
// the framework's API boundary; it deliberately does no identity checking itself.
const fixture = {
  session: { access_token: 'victim-token', user: { id: 'victim' } } as { access_token: string; user: { id: string } } | null,
  verifiedId: 'victim' as string | null,
  ownsAgent: true,
  ownerReads: 0,
  fullAttentionReads: 0,
  activityReads: 0,
  cache: new Map<string, unknown>(),
};
(globalThis as any).__shellRoute = fixture;
const modules: Record<string, string> = {
  '@/lib/supabase/server': `export function createClient(){return {auth:{getSession:async()=>({data:{session:globalThis.__shellRoute.session}}),getUser:async()=>({data:{user:globalThis.__shellRoute.verifiedId?{id:globalThis.__shellRoute.verifiedId}:null},error:null})}}}`,
  '@/lib/needs-you': `export async function loadNeedsYou(){globalThis.__shellRoute.fullAttentionReads++;return {needGrant:[],missed:[],signIns:[],homeAttention:[],attentionItems:Array.from({length:73},(_,i)=>({attentionId:'old'+i,runId:'old'+i})),stalled:[],total:73,partial:false,truncated:false,unavailableSources:[]}}`,
  '@/lib/attention': `export async function getAttention(){globalThis.__shellRoute.activityReads++;return {items:[{sourceType:'judge_block',attentionId:'judge-one',runId:'judge-run'}],live:true,unavailableSources:[]}}`,
  '@/lib/live-feed-server': `export async function getLiveFeed(){return {status:'ready',items:[{runId:'queued',status:'queued'},{runId:'done',status:'finished'}]}}`,
  '@/lib/workflow-catalog': `export async function readMyWorkflows(){globalThis.__shellRoute.ownerReads++;return {status:'ready',workflows:globalThis.__shellRoute.ownsAgent?[{slug:'private-example',name:'Private example',source:'generated'}]:[]}}`,
  'next/cache': `export function unstable_cache(fn,keys){return async()=>{const cache=globalThis.__shellRoute.cache,key=JSON.stringify(keys);if(cache.has(key))return cache.get(key);const result=await fn();cache.set(key,result);return result;}}`,
};
registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL?.includes('/app/api/shell-navigation/route.ts') && modules[specifier]) {
    return { url: `data:text/javascript,${encodeURIComponent(modules[specifier])}`, shortCircuit: true };
  }
  return next(specifier, context);
} });
const { GET } = await import('../app/api/shell-navigation/route.ts');
const getFull = () => GET(new Request('https://test.invalid/api/shell-navigation'));

test('shell cache uses verified identity and contains only a boolean, never a private roster', async () => {
  const victim = await getFull();
  assert.equal((await victim.json()).canTrain, true);
  assert.deepEqual([...fixture.cache.values()], [true]);

  // Forged cookie's embedded user id names victim; Auth verifies attacker.
  fixture.session = { access_token: 'attacker-token', user: { id: 'victim' } };
  fixture.verifiedId = 'attacker';
  fixture.ownsAgent = false;
  const attacker = await getFull();
  const body = await attacker.json();
  assert.equal(body.canTrain, false, 'must not read the victim cache entry');
  assert.equal(body.work.count, 0, 'historical holds absent from Work do not count');
});

test('negative owner answers are not cached, so a first built agent appears on the next read', async () => {
  fixture.cache.clear(); fixture.ownerReads = 0;
  fixture.session = { access_token: 'new-user-token', user: { id: 'new-user' } };
  fixture.verifiedId = 'new-user'; fixture.ownsAgent = false;
  assert.equal((await (await getFull()).json()).canTrain, false);
  assert.equal(fixture.cache.size, 0);
  fixture.ownsAgent = true;
  assert.equal((await (await getFull()).json()).canTrain, true);
  assert.equal(fixture.ownerReads, 2);
});

test('unverified and signed-out requests never reach the private owner cache', async () => {
  const reads = fixture.ownerReads;
  fixture.verifiedId = null;
  assert.equal((await getFull()).status, 401);
  fixture.session = null;
  assert.equal((await getFull()).status, 401);
  assert.equal(fixture.ownerReads, reads);
});

test('Agents sidebar only reads activity and returns a lower bound without another roster read', async () => {
  fixture.session = { access_token: 'owner-token', user: { id: 'owner' } };
  fixture.verifiedId = 'owner';
  const reads = [fixture.fullAttentionReads, fixture.ownerReads, fixture.activityReads];
  const response = await GET(new Request('https://test.invalid/api/shell-navigation?scope=activity'));
  const body = await response.json();
  assert.equal(body.canTrain, null);
  assert.deepEqual(body.work, { count: 1, complete: false });
  assert.deepEqual([fixture.fullAttentionReads, fixture.ownerReads, fixture.activityReads], [reads[0], reads[1], reads[2] + 1]);
});
