import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const page = readFileSync(join(process.cwd(), 'app', '(dashboard)', 'runs', '[id]', 'page.tsx'), 'utf8');
const component = readFileSync(join(process.cwd(), 'app', '(dashboard)', '_components', 'control-plane-retry.tsx'), 'utf8');
test('run page ignores the retired source context during owner handoff and selects the live destination',async()=>{
  const start=page.indexOf('  let executionContext:'),end=page.indexOf('  // A path written in output_markdown',start);
  assert.ok(start>=0&&end>start);
  const block=page.slice(start,end).replace(/let executionContext:.*? = null;/,'let executionContext = null;');
  const read=new Function('supabase','r',`return (async()=>{${block};return executionContext;})()`);
  let rows=[{executor:'codex',thread_id:'source',superseded_at:'2030-01-01'}];
  const db={from(table:string){assert.equal(table,'run_execution_contexts');let live=false;return {
    select(){return this;},eq(){return this;},is(key:string,value:null){assert.equal(key,'superseded_at');assert.equal(value,null);live=true;return this;},
    async maybeSingle(){const found=rows.filter(r=>!live||r.superseded_at==null);if(found.length>1)throw Error('ambiguous context');return {data:found[0]||null};}};}};
  assert.equal(await read(db,{id:'run'}),null,'retired source must not appear live before destination opens');
  rows.push({executor:'codex',thread_id:'destination',superseded_at:null as unknown as string});
  assert.equal((await read(db,{id:'run'})).thread_id,'destination');
});

test('the safe retry is mounted for the request this run was surfaced for, beside — never instead of — Run again', () => {
  assert.match(page, /import ControlPlaneRetry from '\.\.\/\.\.\/_components\/control-plane-retry';/);
  assert.match(page, /\.from\('run_requests'\)\s*\n\s*\.select\('id, status, lifecycle_state, needs_attention_reason'\)\s*\n\s*\.eq\('run_id', r\.id\)\s*\n\s*\.eq\('user_id', session\.user\.id\)\s*\n\s*\.eq\('status', 'done'\)\s*\n\s*\.in\('lifecycle_state', \['failed', 'fallback_blocked'\]\)/);
  assert.match(page, /\{controlPlaneRetryRequestId && !supersededByRelated && \(\s*\n\s*<ControlPlaneRetry requestId=\{controlPlaneRetryRequestId\} runId=\{params\.id\} \/>/);
  const retryAt = page.indexOf('<ControlPlaneRetry requestId=');
  const runAgainAt = page.indexOf('>Run again</Link>', retryAt);
  assert.ok(retryAt > 0 && runAgainAt > retryAt, 'Run again stays available on the same panel');
  assert.match(page, /<Link href=\{agentHref\} className="btn-outline text-sm px-4 py-2">Run again<\/Link>/,
    'Run again is still a navigation to a NEW request, never rewired to the safe retry');
});

test('the browser supplies request identity plus the opaque grant it read back, never server-owned authority', () => {
  assert.match(component, /\/api\/v2\/me\/run-requests\/\$\{encodeURIComponent\(requestId\)\}\/control-plane-retry/);
  assert.match(component, /body: \{ grantId: presentation\.grantId \},/);
  assert.doesNotMatch(component, /expected[A-Z]|failedLaunchAttemptId|failedFencingEpoch|parentProof|fencingEpoch:|inputBindingsDigest|intentDigest/);
  assert.match(component, /if \(!retryConfirmed\(result\)\) throw new Error\('unconfirmed'\);/);
  assert.match(component, /role="alert"/);
  assert.match(component, /RETRY_SAFELY_DISTINCTION/);
  assert.match(component, /RUN_AGAIN_DISTINCTION/);
});

test('the no-work claim is rendered only behind mayClaimNoWork and excludes paid recovery', () => {
  assert.match(component, /\{mayClaimNoWork\(presentation\) && !judgeReview && \(\s*\n\s*<p[^>]*>\{NO_WORK_CLAIM\}<\/p>/);
  assert.equal((component.match(/\bNO_WORK_CLAIM\b/g) || []).length, 2, 'imported once, rendered once, behind the guard');
  assert.doesNotMatch(component, /No work or provider action started/, 'the sentence lives in the classifier, not as loose copy');
  const lib = readFileSync(join(process.cwd(), 'lib', 'control-plane-retry.ts'), 'utf8');
  assert.match(lib, /return \(p\.state === 'available' \|\| p\.state === 'queued'\) && !p\.paidPrelaunch;/);
});


test('a settled missing-training hold shows Training without offering the bootstrap retry', async () => {
  const start=page.indexOf('  let controlPlaneRetryRequestId:'),end=page.indexOf('  const productionLineage =',start);
  assert.ok(start>=0&&end>start);
  const block=page.slice(start,end).replace(': string | null','').replace(' as string','');
  const read=new Function('supabase','r','session',`return (async()=>{${block};return {controlPlaneRetryRequestId,requiredTrainingHold};})()`);
  const owner='owner',run='run';
  for (const row of [
    {id:'request',lifecycle_state:'fallback_blocked',needs_attention_reason:'manager_required_reference_training_missing'},
    {id:'request',lifecycle_state:'fallback_blocked',needs_attention_reason:'other'},
    {id:'request',lifecycle_state:'failed',needs_attention_reason:'manager_required_reference_training_missing'},
    null,
  ]) {
    const filters: Record<string,unknown>={};
    const db={from(table:string){assert.equal(table,'run_requests');return {
      select(){return this;},eq(key:string,value:unknown){filters[key]=value;return this;},
      in(key:string,values:string[]){assert.equal(key,'lifecycle_state');assert.deepEqual(values,['failed','fallback_blocked']);return this;},
      order(){return this;},limit(n:number){assert.equal(n,1);return this;},async maybeSingle(){return {data:row};},
    };}};
    const result=await read(db,{id:run},{user:{id:owner}});
    assert.deepEqual(filters,{run_id:run,user_id:owner,status:'done'});
    assert.equal(result.requiredTrainingHold,row?.lifecycle_state==='fallback_blocked'&&row.needs_attention_reason==='manager_required_reference_training_missing');
    assert.equal(result.controlPlaneRetryRequestId,row?.lifecycle_state==='failed'?'request':null);
  }
  assert.match(page,/requiredTrainingHold && <div role="status"/);
  assert.match(page,/href=\{`\/training\/\$\{encodeURIComponent\(r\.skill_slug\)\}`\}/);
  assert.match(page,/Accept replacement training before starting a new run/);
});

test('the delivered page offers only its latest failed ordinary Judge for backend-checked recovery', async () => {
  const start = page.indexOf('  let judgeRequestStatus:'), end = page.indexOf('\n  let creativeGradeNotice:', start);
  assert.ok(start > 0 && end > start);
  const block = page.slice(start, end)
    .replace(/let judgeRequestStatus:.*? = null;/, 'let judgeRequestStatus = null;')
    .replace(/let judgeRequestCreatedAt:.*? = null;/, 'let judgeRequestCreatedAt = null;')
    .replace(/let failedJudgeRetry:.*? = null;/, 'let failedJudgeRetry = null;');
  const read = new Function('supabase', 'params', 'judgment', 'judgmentReadUnavailable', 'session', `return (async()=>{let judgmentPending=false;${block};return {judgmentPending,judgeRequestStatus,failedJudgeRetry,unavailable:judgmentReadUnavailable};})()`);
  const ownerSession={user:{id:'customer'}};
  const failed = {user_id:'customer',id:'judge-request',judge_target_run_id:'target',kind:'judge',source:'implexa-judge',manager_verification_request_id:null,
    status:'done',lifecycle_state:'failed',run_id:'judge-child',created_at:'2026-11-15T08:00:00Z'};
  let rows: any[] = [failed], reads = 0, queryError = false, queryErrorAtRead = Infinity;
  const db = {from(table: string) {
    assert.equal(table,'run_requests'); reads++;
    let chosen = [...rows];
    return {select(){return this;},eq(key:string,value:unknown){chosen=chosen.filter(r=>r[key]===value);return this;},
      is(key:string,value:null){chosen=chosen.filter(r=>r[key]===value);return this;},
      in(key:string,values:string[]){chosen=chosen.filter(r=>values.includes(r[key]));return this;},
      order(key:string){chosen.sort((a,b)=>b[key].localeCompare(a[key]));return this;},limit(n:number){chosen=chosen.slice(0,n);return this;},
      async maybeSingle(){return {data:chosen[0]||null,error:(queryError||reads===queryErrorAtRead)?new Error('offline'):null};}};
  }};
  const view = () => read(db,{id:'target'},null,false,ownerSession);
  assert.deepEqual(await view(),{judgmentPending:false,judgeRequestStatus:null,failedJudgeRetry:{requestId:'judge-request',runId:'judge-child'},unavailable:false});
  rows = [failed,{...failed,id:'newer',status:'pending',created_at:'2026-11-15T09:00:00Z'}];
  assert.deepEqual(await view(),{judgmentPending:true,judgeRequestStatus:'pending',failedJudgeRetry:null,unavailable:false},'new active review wins over old failure');
  rows=[failed,{...failed,id:'manager-qa',source:'manager_qa_verification',manager_verification_request_id:'proof',status:'pending',created_at:'2026-11-15T07:00:00Z'}];
  assert.deepEqual(await view(),{judgmentPending:true,judgeRequestStatus:'pending',failedJudgeRetry:null,unavailable:false},'active Manager QA must not be masked by a newer failed ordinary Judge');
  for (const change of [{user_id:'other'},{source:'other'},{kind:'recover'},{manager_verification_request_id:'manager-proof'},
    {lifecycle_state:'completed'},{run_id:null},{run_id:'target'}]) {
    rows=[{...failed,...change}]; assert.equal((await view()).failedJudgeRetry,null,JSON.stringify(change));
  }
  rows=[{...failed,status:'cancelled'}];
  assert.deepEqual(await view(),{judgmentPending:true,judgeRequestStatus:'cancelled',failedJudgeRetry:null,unavailable:false},'existing cancellation presentation retained');
  const before=reads;
  assert.equal((await read(db,{id:'target'},{id:'verdict'},false,ownerSession)).failedJudgeRetry,null);
  assert.equal(reads,before,'a recorded verdict must suppress recovery and the request query');
  queryError=true; rows=[failed];
  assert.deepEqual(await view(),{judgmentPending:false,judgeRequestStatus:null,failedJudgeRetry:null,unavailable:true},'failed read is unavailable, never a confirmed absence');
  queryError=false; queryErrorAtRead=reads+2;
  assert.deepEqual(await view(),{judgmentPending:false,judgeRequestStatus:null,failedJudgeRetry:null,unavailable:true},'ordinary recovery read errors are not an empty result either');
  const beforeUnavailable=reads;
  assert.equal((await read(db,{id:'target'},null,true,ownerSession)).failedJudgeRetry,null);
  assert.equal(reads,beforeUnavailable,'unknown verdict status cannot offer recovery');
  assert.match(page,/<ControlPlaneRetry requestId=\{failedJudgeRetry\.requestId\} runId=\{failedJudgeRetry\.runId\} \/>/,
    'reuse the existing owner grant and source-Mac check with the Judge child, never the video run');
  assert.match(page,/Your delivered work is unchanged\./);
});
