// node --test "app/(dashboard)/_components/agent-actions-external-poll.test.ts"
// (Node 22.6+ strips the types natively)
//
// REGRESSION GUARD — the agent detail page's "Run now" button must discover a
// run queued on a DIFFERENT surface, not just follow one it already knew about.
//
// What broke (2026-07-18): <RunContinueBox/> on /runs/[id] queues a kind='continue'
// run-request. The agent page's <AgentActions/> has an "externally-observed
// in-flight run" poll specifically meant to catch this (its own comment: "queued/
// running came from the SERVER... Track it via the live feed instead"). But that
// poll effect was gated `if (state !== 'queued' && state !== 'running') return;`
// — so it only ever RAN if `state` was already queued/running. Since `state`
// starts at 'idle' whenever the server-computed `inFlight` prop was null (i.e.
// whenever nothing was queued yet AT PAGE LOAD), the poll never started, so it
// could never discover a run that got queued afterward from a different page.
// Founder hit this directly: queued a continue from the run page's pop-up, closed
// it, came back to the agent page (still mounted the whole time) — button still
// said "Run now".
//
// Fix: the poll now runs unconditionally from mount (empty dependency array), so
// it can DISCOVER an external run, not just follow one already known. This file
// pins the source structure directly (this codebase's established pattern for a
// .tsx file with no JSX-shaped test path — see runs/[id]/continue-affordance.test.ts).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render } from '../../../lib/test/render.ts';

const src = readFileSync(join(import.meta.dirname, 'agent-actions.tsx'), 'utf8');

function externalPollEffectBody() {
  const anchor = 'Externally-observed in-flight run:';
  const start = src.indexOf(anchor);
  assert.ok(start !== -1, 'the externally-observed in-flight run effect and its comment must still exist');
  const end = src.indexOf('\n  }, [', start);
  assert.ok(end !== -1, 'could not find the end of the external-poll useEffect');
  const depsEnd = src.indexOf(');', end);
  return src.slice(start, depsEnd + 2);
}

test('the external-poll effect runs unconditionally from mount, not gated on state already being queued/running', () => {
  const body = externalPollEffectBody();
  // The regression: an early return keyed on `state` at the TOP of the effect
  // (before the interval is even created) means it never starts polling from idle.
  assert.doesNotMatch(
    body,
    /^\s*if \(state !== 'queued' && state !== 'running'\) return;/m,
    'must not early-return on state before creating the interval — that is exactly what stopped it discovering an externally-queued run',
  );
  // The effect must depend on mount only (`[]`), not on `state` — depending on
  // `state` would tear the interval down and lose its `misses` counter on every
  // status flip, and (before this fix) is what let the top-of-effect gate above
  // suppress it from ever starting while idle.
  assert.match(body, /\}, \[\]\);\s*$/, 'the external-poll effect must have an empty dependency array (runs once, from mount)');
});

test('the external-poll effect reads current state via stateRef, not a stale closure, when deciding to reset to idle', () => {
  const body = externalPollEffectBody();
  assert.match(
    body,
    /stateRef\.current === 'queued' \|\| stateRef\.current === 'running'/,
    'the reset-to-idle branch must check stateRef.current (kept fresh by a separate effect), not `state` captured in the mount-once closure',
  );
});

test('a run-request started from THIS component still defers to its own dedicated poll', () => {
  const body = externalPollEffectBody();
  // Two guards must survive: one at effect setup (skip entirely if a request was
  // already in flight from this exact component when it mounted) and one INSIDE
  // the interval tick (so a request started here mid-poll doesn't get double-tracked).
  assert.match(body, /if \(requestId\.current\) return;\s*\/\/ user-initiated runs use the poll above/,
    'effect-setup guard must survive');
  const tickGuardCount = (body.match(/if \(requestId\.current\) return;/g) || []).length;
  assert.equal(tickGuardCount, 2, 'the requestId guard must appear both at effect setup AND inside each interval tick');
});

const VERSION = '33333333-3333-4333-8333-333333333333';
async function renderAnother(inFlight: 'running' | 'queued', duplicate = false, statusUnavailable = false,trainingTest:{testPreparationId:string;preparationDigest:string}|null=null,extra:Record<string,unknown>={}) {
  return render('agent-actions.tsx', {
    slug: 'video-agent', isActive: true, inFlight, statusUnavailable,trainingTest,
    workflowVersionId: VERSION, inputContractDigest: 'c'.repeat(64),
    inputContract: { version: 1, fields: [{ key: 'brief', label: 'Brief', kind: 'text',
      cardinality: 'one', required: true, order: 1 }] },...extra,
  }, { backend: path => {
    if (path.startsWith('/api/v2/agent-training/agents/')) {const value={ ok: true, home: {
      agent: { currentVersionId: VERSION },
      successorProjection: { contractVersion: 'agent-training-successor-projection.v1',
        activeVersionId: VERSION, eligiblePredecessor: null },
      managerTrainingRequirements: { contractVersion: 'manager-reference-training-readiness.v1',
        scope: 'workflow_version_quality_references', workflowVersionId: VERSION,
        classified: false, requiredPairs: [], fulfilledPairs: [], missingPairs: [],
        readiness: 'not_applicable', reason: null },
    } };const query=new URL(path,'https://fixture.invalid').searchParams;const selected=query.has('testPreparationId')?{testPreparationId:query.get('testPreparationId'),preparationDigest:query.get('preparationDigest')}:trainingTest;return selected?{ok:true,contractVersion:'prepared-agent-training-preflight.v1',agentFamilyId:'11111111-1111-4111-8111-111111111111',workflowVersionId:VERSION,
      managerTrainingRequirements:value.home.managerTrainingRequirements,trainingTest:selected}:value;}
    if (path.includes('/setup')) return { schema: [{ key: 'format', question: 'Format', kind: 'text', optional: true }],
      answers: { format: '16:9' }, note: '', runInputDefaults: { brief: 'same preserved input' } };
    if (path.includes('/run-precheck')) return { ok: true, fingerprint: 'same-fingerprint',
      duplicate: duplicate ? { message: 'The same input has an open run.', runId: 'existing-run' } : null };
    if (path === '/api/v2/me/run-admission') return { ok: true, admitted: true };
    if (path === '/api/v2/me/run-requests') return { ok: true, request: { id: 'fresh-request' } };
    return { ok: true };
  } });
}

test('a prepared Training test keeps the ordinary inputs and admission, and carries its exact binding at birth',async()=>{
 const binding={testPreparationId:'11111111-1111-4111-8111-111111111111',preparationDigest:'b'.repeat(64)};
 const r=await renderAnother('running',false,false,binding);
 try{await r.click(r.getByText('Run another…'));await r.click(r.getByText('Save & run'));
  const preflight=r.calls.backend.find(c=>c.path.startsWith('/api/v2/agent-training/agents/'));
  assert.ok(preflight?.path.includes(`testPreparationId=${binding.testPreparationId}`));assert.ok(preflight?.path.includes(`preparationDigest=${binding.preparationDigest}`));
  const posts=r.calls.backend.filter(c=>c.path==='/api/v2/me/run-requests');assert.equal(posts.length,1);
  const body=(posts[0].init as any).body;assert.deepEqual(JSON.parse(JSON.stringify(body.trainingTest)),binding);
  assert.deepEqual(JSON.parse(JSON.stringify(body.inputBindings)),{brief:'same preserved input'});
  assert.equal(body.workflowVersionId,VERSION);assert.ok(r.calls.backend.some(c=>c.path==='/api/v2/me/run-admission'));
 }finally{r.cleanup();}
});

for (const status of ['running', 'queued'] as const) {
  test(`a separately observed ${status} run permits one new normal, version-bound submission`, async () => {
    const r = await renderAnother(status);
    try {
      await r.click(r.getByText('Run another…'));
      assert.match(r.text(), /does not stop, retry or change that run/);
      assert.ok(r.getByText('View existing runs'));
      await r.click(r.getByText('Save & run'));
      const paths = r.calls.backend.map(c => c.path);
      const pre = paths.findIndex(p => p.includes('/run-precheck'));
      const admission = paths.indexOf('/api/v2/me/run-admission');
      const created = paths.indexOf('/api/v2/me/run-requests');
      assert.ok(pre >= 0 && admission > pre && created > admission);
      const posts = r.calls.backend.filter(c => c.path === '/api/v2/me/run-requests');
      assert.equal(posts.length, 1);
      const body = (posts[0].init as { body: Record<string, unknown> }).body;
      assert.equal(body.workflowVersionId, VERSION);
      assert.equal(body.inputContractDigest, 'c'.repeat(64));
      assert.deepEqual(JSON.parse(JSON.stringify(body.inputBindings)), { brief: 'same preserved input' });
      assert.equal(body.force, undefined);
      assert.equal(r.queryByText('Run another…'), null, 'its own queued request remains locked');
      assert.ok(!paths.some(p => /cancel|stop/.test(p)), 'the first request is untouched');
    } finally { r.cleanup(); }
  });
}

test('another run still requires the existing duplicate confirmation before force', async () => {
  const r = await renderAnother('running', true);
  try {
    await r.click(r.getByText('Run another…'));
    await r.click(r.getByText('Save & run'));
    assert.equal(r.calls.backend.filter(c => c.path === '/api/v2/me/run-requests').length, 0);
    await r.click(r.getByText('Run again anyway'));
    const posts = r.calls.backend.filter(c => c.path === '/api/v2/me/run-requests');
    assert.equal(posts.length, 1);
    const body = (posts[0].init as { body: Record<string, unknown> }).body;
    assert.equal(body.force, true);
    assert.equal(body.inputFingerprint, 'same-fingerprint');
    assert.equal(body.workflowVersionId, VERSION);
    assert.deepEqual(JSON.parse(JSON.stringify(body.inputBindings)), { brief: 'same preserved input' });
    assert.equal(r.calls.backend.filter(c => c.path.includes('/run-precheck')).length, 1);
    assert.ok(r.calls.backend.some(c => c.path === '/api/v2/me/run-admission'));
    assert.ok(!r.calls.backend.some(c => /cancel|stop/.test(c.path)));
  } finally { r.cleanup(); }
});

test('unreadable lifecycle state still withholds Run another', async () => {
  const r = await renderAnother('running', false, true);
  try { assert.equal(r.queryByText('Run another…'), null); assert.ok(r.getByText('Status unavailable')); }
  finally { r.cleanup(); }
});


test('Training opens the same Run dialog in place and cannot switch a prepared binding under it',async()=>{
 const binding={testPreparationId:'11111111-1111-4111-8111-111111111111',preparationDigest:'b'.repeat(64)};let queued=0;
 const props={slug:'video-agent',isActive:true,workflowVersionId:VERSION,inputContractDigest:'c'.repeat(64),inputContract:{version:1,fields:[{key:'brief',label:'Brief',kind:'text',cardinality:'one',required:true,order:1}]},presentation:'training',onQueued:()=>queued++,trainingChoices:{pending:true,canTest:true,delivered:false,savedAvailable:true,busy:false,onPending:()=>{},onSaved:()=>{}}};
 const r=await renderAnother('running',false,false,null,props);
 try{
  assert.ok(r.getByText('Run with new training (pending)'));assert.ok(r.getByText('Run with latest saved learnings'));
  assert.equal(r.calls.backend.some(c=>c.path.includes('/agent-training/agents/')),false,'rendering starts nothing');
  await r.rerender({...props,runRequest:{nonce:'pending',binding}});
  assert.ok(r.getByText('Save & run'));assert.equal(r.calls.push.length,0);
  await r.rerender({...props,runRequest:{nonce:'switch-under-open-dialog',binding:null}});
  await r.click(r.getByText('Save & run'));
  const posts=r.calls.backend.filter(c=>c.path==='/api/v2/me/run-requests');assert.equal(posts.length,1);
  assert.deepEqual(JSON.parse(JSON.stringify((posts[0].init as any).body.trainingTest)),binding);
  assert.equal(r.calls.push.length,0,'queue confirmation stays on Training');assert.equal(queued,1);
 }finally{r.cleanup();}
});

test('controlled Training open cannot bypass unavailable, inactive, updating or required-setup gates',async()=>{
 for(const gate of [{statusUnavailable:true},{isActive:false},{revisePending:true},{blockingQuestions:1}]){
  const r=await renderAnother('running',false,false,null,{presentation:'training',...gate,runRequest:{nonce:'explicit',binding:null}});
  try{assert.equal(r.calls.backend.some(c=>c.path.includes('/agent-training/agents/')),false);assert.equal(r.document.querySelector('[role=dialog]'),null);assert.equal(r.calls.push.length,0);}finally{r.cleanup();}
 }
});

test('Training run choices reflect only the supplied serving state and saved mode clears a cancelled candidate',async()=>{
 const binding={testPreparationId:'11111111-1111-4111-8111-111111111111',preparationDigest:'b'.repeat(64)};
 const props={slug:'video-agent',isActive:true,workflowVersionId:VERSION,inputContractDigest:'c'.repeat(64),inputContract:{version:1,fields:[{key:'brief',label:'Brief',kind:'text',cardinality:'one',required:true,order:1}]},presentation:'training',trainingChoices:{pending:false,canTest:true,delivered:false,savedAvailable:true,busy:false,onPending:()=>{},onSaved:()=>{}}};
 const r=await renderAnother('running',false,false,null,props);
 try{
  assert.equal(r.queryByText('Run with new training (pending)'),null);assert.ok(r.getByText('Run with latest saved learnings'));
  await r.rerender({...props,runRequest:{nonce:'candidate',binding}});await r.click(r.document.querySelector('[role=dialog] [aria-label=Close]')!);
  await r.rerender({...props,runRequest:{nonce:'saved',binding:null}});await r.click(r.getByText('Save & run'));
  const posts=r.calls.backend.filter(c=>c.path==='/api/v2/me/run-requests');assert.equal(posts.length,1);assert.equal((posts[0].init as any).body.trainingTest,undefined);
  const reads=r.calls.backend.filter(c=>c.path.includes('/agent-training/agents/'));assert.equal(reads.length,2);assert.equal(reads[1].path.includes('testPreparationId'),false);
 }finally{r.cleanup();}
});
