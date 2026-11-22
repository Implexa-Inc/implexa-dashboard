import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';
import {runInNewContext} from 'node:vm';
import {fileURLToPath} from 'node:url';

function reader(fetchImpl:(url:string,init:any)=>Promise<unknown>){
 const deadlines:number[]=[],module={exports:{} as any};
 const code=buildSync({entryPoints:[fileURLToPath(new URL('./training-coach-server.ts',import.meta.url))],bundle:true,write:false,platform:'node',format:'cjs',external:['server-only']}).outputFiles[0].text;
 runInNewContext(code,{module,exports:module.exports,require:(name:string)=>{assert.equal(name,'server-only');return{};},process:{env:{NEXT_PUBLIC_IMPLEXA_API_URL:'https://fixture.invalid'}},fetch:fetchImpl,AbortSignal:{timeout:(ms:number)=>{deadlines.push(ms);return new AbortController().signal;}}});
 return {read:module.exports.readTrainingCoach,deadlines};
}

test('Coach response margin covers the backend background budget and retains private family binding',async()=>{
 const calls:any[]=[],family='80000000-0000-4000-8000-000000000001';
 const r=reader(async(url,init)=>{calls.push({url,init});return{ok:true,json:async()=>({ok:true,contractVersion:'training-coach-decisions.v1',agents:[],complete:true})};});
 const result=await r.read('synthetic-session',family);
 assert.equal(result.status,'ready');assert.deepEqual(r.deadlines,[5000]);
 assert.equal(calls[0].url,`https://fixture.invalid/api/v2/agent-training/coach?familyId=${family}`);
 assert.equal(calls[0].init.headers.authorization,'Bearer synthetic-session');assert.equal(calls[0].init.cache,'no-store');
});

test('a refused, malformed or timed-out background read stays unavailable, never an empty roster',async()=>{
 for(const response of [{ok:false,json:async()=>({})},{ok:true,json:async()=>({agents:[]})},null]){
  let count=0;const r=reader(async()=>{count++;if(response===null)throw Object.assign(new Error('timeout'),{name:'TimeoutError'});return response;});
  assert.equal((await r.read('synthetic-session')).status,'unavailable');assert.equal(count,1,'no retry or alternate roster dependency');
 }
});
