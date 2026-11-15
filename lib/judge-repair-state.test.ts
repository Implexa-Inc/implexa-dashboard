import { test } from 'node:test';
import assert from 'node:assert/strict';
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
    return {select(columns:string){assert.equal(columns,'at');return this;},
      eq(key:string,value:unknown){chosen=chosen.filter(r=>r[key]===value);return this;},
      order(key:string){chosen.sort((a,b)=>String(b[key]).localeCompare(String(a[key])));return this;},
      limit(n:number){chosen=chosen.slice(0,n);return this;},async maybeSingle(){return {data:chosen[0]||null,error};}};
  }} as any;
}
const clockRequest={id:'review',created_at:'2020-01-01T00:00:00Z',bootstrap_retry_epoch:1,started_at:null as string|null};
const queued={request_id:'review',user_id:'owner',event:'queued',actor:'control_plane_retry',at:'2020-01-02T12:00:00Z'};

test('ordinary and legacy reviews keep their original age without another database read',async()=>{
  const noRead={from(){throw Error('unexpected read');}} as any;
  for(const epoch of [undefined,null,0,'0']) {
    assert.equal(await readJudgeReviewAge(noRead,'owner',{...clockRequest,bootstrap_retry_epoch:epoch}),clockRequest.created_at);
  }
  assert.equal(await readJudgeReviewAge(noRead,'owner',{created_at:null}),null,'legacy missing timestamp behavior is preserved');
  assert.equal(await readJudgeReviewAge(noRead,'owner',{created_at:'broken'}),'broken','existing malformed-time handling remains in the banner');
});

test('a successful retry resets the age to its owner-bound queue event, then its actual process start',async()=>{
  const db=clockDatabase([queued,{...queued,actor:'heartbeat',at:'2020-01-02T14:00:00Z'},
    {...queued,user_id:'foreign',at:'2020-01-02T15:00:00Z'}, {...queued,request_id:'another',at:'2020-01-02T16:00:00Z'}]);
  assert.equal(await readJudgeReviewAge(db,'owner',clockRequest),queued.at);
  const started={...clockRequest,started_at:'2020-01-02T12:02:00Z',claimed_at:'2020-01-02T12:01:00Z',updated_at:'2020-01-02T14:00:00Z'};
  assert.equal(await readJudgeReviewAge(db,'owner',started),started.started_at,'claims and heartbeat updates cannot extend the clock');
  const oldAge=Date.parse('2020-01-02T12:05:00Z')-Date.parse(clockRequest.created_at);
  const newAge=Date.parse('2020-01-02T12:05:00Z')-Date.parse((await readJudgeReviewAge(db,'owner',started))!);
  assert.ok(oldAge>20*60*1000 && newAge<20*60*1000,'the retained request is old but the recovered review is fresh');
  assert.ok(Date.parse('2020-01-02T12:23:00Z')-Date.parse(started.started_at)>20*60*1000,'the existing ceiling still catches an old recovered review');
});

test('missing, unreadable, malformed or contradictory retry history never invents a fresh review time',async()=>{
  for(const change of [{bootstrap_retry_epoch:-1},{bootstrap_retry_epoch:'garbage'},{bootstrap_retry_epoch:1.5},
    {created_at:null},{created_at:'broken'},{started_at:'broken'},{started_at:'2020-01-02T11:59:00Z'},
    {started_at:'2999-01-01T00:00:00Z'}]) {
    await assert.rejects(readJudgeReviewAge(clockDatabase([queued]),'owner',{...clockRequest,...change}),/age_unavailable/);
  }
  for(const event of [{...queued,at:'broken'},{...queued,at:'2019-01-01T00:00:00Z'},
    {...queued,at:'2999-01-01T00:00:00Z'},{...queued,user_id:'foreign'},{...queued,event:'running'}]) {
    await assert.rejects(readJudgeReviewAge(clockDatabase([event]),'owner',clockRequest),/age_unavailable/);
  }
  await assert.rejects(readJudgeReviewAge(clockDatabase([]),'owner',clockRequest),/age_unavailable/);
  await assert.rejects(readJudgeReviewAge(clockDatabase([queued],new Error('offline')),'owner',clockRequest),/age_unavailable/);
});
