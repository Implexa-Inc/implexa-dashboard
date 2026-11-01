import test from 'node:test';
import assert from 'node:assert/strict';
import { readMyWorkflows } from './workflow-catalog.ts';

const card = {slug:'owned-video', name:'My video agent', is_scheduled:false};
const reply = (body: unknown, ok = true) => (async () => ({ok, json:async()=>body})) as typeof fetch;

test('Training reads the existing owner library, not activation checklists', async () => {
  const requests: {url:string; init:RequestInit}[] = [];
  const read = await readMyWorkflows('owner-session', {fetchImpl:(async (url, init) => {
    requests.push({url:String(url), init:init!});
    return {ok:true, json:async()=>({ok:true, workflows:[card]})};
  }) as typeof fetch});
  assert.deepEqual(read, {status:'ready', workflows:[card]});
  assert.equal(requests.length,1);
  assert.match(requests[0].url, /\/api\/v2\/me\/workflows$/);
  assert.deepEqual(requests[0].init.headers, {authorization:'Bearer owner-session'});
  assert.equal(requests[0].init.cache,'no-store');
});

test('a genuine empty owner library is ready, while failed lookups are unavailable', async () => {
  assert.deepEqual(await readMyWorkflows('token',{fetchImpl:reply({ok:true,workflows:[]})}),{status:'ready',workflows:[]});
  for (const [body, ok] of [[{ok:false,workflows:[]},true],[{},true],[{ok:true,workflows:[{name:'missing slug'}]},true],[null,false]] as const) {
    const read = await readMyWorkflows('token',{fetchImpl:reply(body,ok)});
    assert.equal(read.status,'unavailable');
  }
});

test('timeout, network, bad JSON and missing session retain their failure reasons', async () => {
  for (const [name,reason] of [['TimeoutError','timeout'],['AbortError','timeout'],['TypeError','network']] as const) {
    const fetchImpl = (async()=>{throw Object.assign(new Error('private upstream detail'),{name});}) as typeof fetch;
    assert.deepEqual(await readMyWorkflows('token',{fetchImpl}),{status:'unavailable',reason});
  }
  assert.deepEqual(await readMyWorkflows('token',{fetchImpl:(async()=>({ok:true,json:async()=>{throw Error('private payload');}})) as typeof fetch}),
    {status:'unavailable',reason:'malformed'});
  let fetched=false;
  assert.deepEqual(await readMyWorkflows(undefined,{getToken:async()=>null,fetchImpl:(async()=>{fetched=true;}) as unknown as typeof fetch}),
    {status:'unavailable',reason:'no_session'});
  assert.equal(fetched,false);
});
