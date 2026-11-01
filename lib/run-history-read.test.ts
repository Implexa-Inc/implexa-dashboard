import test from 'node:test';
import assert from 'node:assert/strict';
import {selectRuns} from './run-state.ts';
function client(responses:any[]){let reads=0;return {from:()=>{const q:any={select:()=>q,order:()=>q,limit:()=>q,then:(resolve:any)=>Promise.resolve(responses[Math.min(reads++,responses.length-1)]).then(resolve)};return q;}} as any;}
test('activity can distinguish a primary history failure while existing callers keep their compatibility behavior',async()=>{
 const denied={error:{code:'42501'},data:null};
 await assert.rejects(selectRuns(client([denied]),{throwOnError:true}),/run_history_unavailable/);
 assert.deepEqual(await selectRuns(client([denied])),[]);
});
test('activity preserves the missing-column fallback and refuses if that fallback also fails',async()=>{
 const missing={error:{code:'42703'},data:null},empty={error:null,data:[]};
 assert.deepEqual(await selectRuns(client([missing,empty]),{throwOnError:true}),[]);
 await assert.rejects(selectRuns(client([missing,{error:{code:'42501'},data:null}]),{throwOnError:true}),/run_history_unavailable/);
});
