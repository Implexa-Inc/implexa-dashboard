import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformSync } from 'esbuild';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { judgeRepairState, readJudgeReviewAge } from './judge-repair-state.ts';

test('repair lifecycle distinguishes queued, running, and the exact repaired child', () => {
  assert.deepEqual(judgeRepairState({ verdict: 'repair', repairRound: 0, requestStatus: 'pending' }),
    { phase: 'queued', nextRound: 1, repairedRunId: null });
  assert.deepEqual(judgeRepairState({ verdict: 'repair', repairRound: 0, requestStatus: 'consumed' }),
    { phase: 'running', nextRound: 1, repairedRunId: null });
  assert.deepEqual(judgeRepairState({ verdict: 'repair', repairRound: 0, requestStatus: 'done', requestRunId: 'child', currentRunId: 'parent' }),
    { phase: 'completed', nextRound: 1, repairedRunId: 'child' });
});

test('missing queue state and convergence limit stay visible instead of pretending work is running', () => {
  assert.equal(judgeRepairState({ verdict: 'repair', repairRound: 0 }).phase, 'queue_failed');
  assert.equal(judgeRepairState({ verdict: 'repair', repairRound: 2, requestStatus: 'pending' }).phase, 'limit_reached');
  assert.equal(judgeRepairState({ verdict: 'blocked', repairRound: 0, requestStatus: 'pending' }).phase, 'none');
});


function clockDatabase(rows: Record<string, unknown>[], error: Error | null = null) {
  return {from(table: string) {
    assert.equal(table,'run_request_events');
    let chosen=[...rows];
    return {select(columns:string){assert.equal(columns,'at, attempt');return this;},
      eq(key:string,value:unknown){chosen=chosen.filter(r=>r[key]===value);return this;},
      order(key:string){chosen.sort((a,b)=>Number(b[key])-Number(a[key]));return this;},
      limit(n:number){chosen=chosen.slice(0,n);return this;},then(resolve:any,reject:any){return Promise.resolve({data:chosen,error}).then(resolve,reject);}};
  }} as any;
}
const clockRequest={id:'review',created_at:'2020-01-01T00:00:00Z',bootstrap_retry_epoch:1,started_at:null as string|null};
const queued={request_id:'review',user_id:'owner',event:'queued',actor:'control_plane_retry',attempt:1,at:'2020-01-02T12:00:00Z'};

test('ordinary and legacy reviews keep their original age without another database read',async()=>{
  const noRead={from(){throw Error('unexpected read');}} as any;
  for(const epoch of [0,'0']) {
    assert.equal(await readJudgeReviewAge(noRead,'owner',{...clockRequest,bootstrap_retry_epoch:epoch}),clockRequest.created_at);
  }
  assert.equal(await readJudgeReviewAge(noRead,'owner',{created_at:null,bootstrap_retry_epoch:0}),null,'legacy missing timestamp behavior is preserved');
  assert.equal(await readJudgeReviewAge(noRead,'owner',{created_at:'broken',bootstrap_retry_epoch:0}),'broken','existing malformed-time handling remains in the banner');
});

test('a successful retry resets the age to its owner-bound queue event, keeps a fixed generation deadline',async()=>{
  const db=clockDatabase([queued,{...queued,actor:'heartbeat',at:'2020-01-02T14:00:00Z'},
    {...queued,user_id:'foreign',at:'2020-01-02T15:00:00Z'}, {...queued,request_id:'another',at:'2020-01-02T16:00:00Z'}]);
  assert.equal(await readJudgeReviewAge(db,'owner',clockRequest),queued.at);
  const started={...clockRequest,started_at:'2020-01-02T12:02:00Z',claimed_at:'2020-01-02T12:01:00Z',updated_at:'2020-01-02T14:00:00Z'};
  assert.equal(await readJudgeReviewAge(db,'owner',started),queued.at,'starts, claims and heartbeat updates cannot extend the clock');
  const oldAge=Date.parse('2020-01-02T12:05:00Z')-Date.parse(clockRequest.created_at);
  const newAge=Date.parse('2020-01-02T12:05:00Z')-Date.parse((await readJudgeReviewAge(db,'owner',started))!);
  assert.ok(oldAge>20*60*1000 && newAge<20*60*1000,'the retained request is old but the recovered review is fresh');
  assert.ok(Date.parse('2020-01-02T12:25:00Z')-Date.parse(queued.at)>20*60*1000,'the existing ceiling still catches an old recovered review');
});

test('missing, unreadable, malformed or contradictory retry history never invents a fresh review time',async()=>{
  for(const change of [{bootstrap_retry_epoch:-1},{bootstrap_retry_epoch:'garbage'},{bootstrap_retry_epoch:1.5},
    {bootstrap_retry_epoch:undefined},{bootstrap_retry_epoch:null},{bootstrap_retry_epoch:'01'},{bootstrap_retry_epoch:'1.0'},
    {created_at:null},{created_at:'broken'},{id:undefined}]) {
    await assert.rejects(readJudgeReviewAge(clockDatabase([queued]),'owner',{...clockRequest,...change}),/age_unavailable/);
  }
  for(const event of [{...queued,at:'broken'},{...queued,at:'2019-01-01T00:00:00Z'},
    {...queued,at:'2999-01-01T00:00:00Z'},{...queued,user_id:'foreign'},{...queued,event:'running'}]) {
    await assert.rejects(readJudgeReviewAge(clockDatabase([event]),'owner',clockRequest),/age_unavailable/);
  }
  await assert.rejects(readJudgeReviewAge(clockDatabase([]),'owner',clockRequest),/age_unavailable/);
  await assert.rejects(readJudgeReviewAge(clockDatabase([queued],new Error('offline')),'owner',clockRequest),/age_unavailable/);
});


test('the actual pending banner stays fresh for a recovered review and retains cancellation and stall states',async(t)=>{
  const require=createRequire(import.meta.url);
  const source=readFileSync(new URL('../app/(dashboard)/_components/run-judgment-pending.tsx',import.meta.url),'utf8');
  const compiled=transformSync(source,{loader:'tsx',format:'cjs',jsx:'automatic'}).code;
  const mod={exports:{}} as any;
  new Function('require','module','exports',compiled)((name:string)=>name==='next/navigation'?{useRouter:()=>({refresh(){}})}:require(name),mod,mod.exports);
  const render=(createdAt:string|null,requestStatus='consumed')=>renderToStaticMarkup(React.createElement(mod.exports.RunJudgmentPending,{createdAt,requestStatus}));
  t.mock.method(Date,'now',()=>Date.parse('2020-01-02T12:05:00Z'));
  assert.match(render(clockRequest.created_at),/taking unusually long/,'old request birth reproduces the reported false stall');
  const db=clockDatabase([queued]);
  const queuedOrigin=await readJudgeReviewAge(db,'owner',clockRequest);
  assert.match(render(queuedOrigin,'pending'),/Judge is reviewing/);
  assert.doesNotMatch(render(queuedOrigin,'pending'),/taking unusually long/);
  const restamped={...clockRequest,started_at:'2020-01-02T12:24:00Z'};
  const startedOrigin=await readJudgeReviewAge(db,'owner',restamped);
  assert.match(render(startedOrigin),/Judge is reviewing/);
  t.mock.method(Date,'now',()=>Date.parse('2020-01-02T12:25:00Z'));
  assert.match(render(startedOrigin),/taking unusually long/,'recovered reviews remain subject to the same 20-minute ceiling');
  assert.match(render('broken','cancelled'),/review was cancelled/);
  assert.doesNotMatch(render('broken','cancelled'),/taking unusually long|Judge is reviewing/);
});


test('retry age requires complete generation history and does not reset on a later process stamp',async()=>{
  const request={...clockRequest,bootstrap_retry_epoch:2,started_at:'2020-01-02T12:24:00Z'};
  const second={...queued,attempt:2,at:'2020-01-02T12:01:00Z'};
  assert.equal(await readJudgeReviewAge(clockDatabase([queued,second]),'owner',request),second.at);
  for(const events of [[queued],[queued,second,{...second,attempt:3}],
    [queued,{...second,attempt:1}],[queued,{...second,at:'2020-01-01T23:00:00Z'}]]) {
    await assert.rejects(readJudgeReviewAge(clockDatabase(events),'owner',request),/age_unavailable/);
  }
});
