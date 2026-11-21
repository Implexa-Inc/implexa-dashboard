import {test} from 'node:test';
import assert from 'node:assert/strict';
import {render} from '../lib/test/render.ts';

const emptyNeeds={needGrant:[],missed:[],signIns:[],stalled:[],attentionItems:[],homeAttention:[],pendingReviews:0,homeCount:0,total:0,partial:false,truncated:false,unavailableSources:[]};
const queue={items:[],truncated:false,total:0,visibleCount:0,sources:{review_endpoint:'ready'},live:true};
const base={view:'activity',needs:emptyNeeds,queue,names:{},reviewDetails:{},warning:null};
const live={runId:'running-id',requestId:'running-request',scheduledSkillId:null,skillSlug:'video-agent',source:'manual',status:'running',since:'2026-11-21T12:00:00Z',headline:'A real run title',currentStepIndex:2,totalSteps:6,currentStepLabel:'Choosing visuals'};
const fetchSummary=(async()=>Response.json({rows:[],nextCursor:null})) as typeof fetch;

async function flush(r:Awaited<ReturnType<typeof render>>){await r.act(async()=>{await new Promise(resolve=>setTimeout(resolve,20));});}

test('Work composes one counted list with source-specific actions and the original Stop confirmation',async()=>{
 const judge={attentionId:'judge-id',sourceType:'judge_block',sourceId:'judgment',runId:'running-id',agentSlug:'video-agent',agentName:'Video agent',whatHappened:'A decision is needed',requiredAction:'provide_information',actionDetail:'Choose the next treatment',primaryAction:{kind:'provide_information',targetType:'judge_block',targetId:'judgment',label:'Provide information'},reasons:[],createdAt:null,seenAt:null,resolvedAt:null};
 const r=await render('../work/_components/work-feed.tsx',{...base,needs:{...emptyNeeds,needGrant:[{slug:'grant-agent',name:'Grant agent',reason:'Connect this account'}],homeAttention:[judge]}},{exportName:'WorkList',fetch:fetchSummary,backend:path=>path.startsWith('/api/v2/scheduled-skills/live')?{items:[live]}:{ok:true}});
 try{
  await flush(r);
  assert.equal(r.document.querySelectorAll('[aria-label="Work items"] .work-item-row').length,2,'Judge/live aliases are one row; setup remains a separate action');
  assert.equal(r.document.querySelectorAll('[aria-label="Work items"] .work-row-title').length,2);
  assert.ok(r.document.querySelector('a[href="/workflows/grant-agent/activate"]'));
  assert.ok(r.queryByText('Provide information'));
  const stop=r.document.querySelector('button[aria-label="Stop this run"]');assert.ok(stop,'deduplication retains the live Stop control');
  await r.click(stop!);
  assert.ok(r.queryByText('Stop this run?'));
  assert.equal(r.calls.backend.filter(call=>call.path.endsWith('/cancel')).length,0,'opening the dialog does not stop anything');
  const active=r.document.querySelector('[aria-label="Work filters"] a[aria-current="page"]');
  assert.match(active?.textContent||'',/Active\s*2/);
  assert.ok(r.document.querySelector('a[href="/work?view=running"]'));
 }finally{r.cleanup();}
});

test('Work review rows deduplicate root/latest live aliases and preserve their controls',async()=>{
 const item={rootRunId:'root-id',latestRunId:'running-id',slug:'video-agent',reason:'new_result',holdKind:null,judgeVerdict:null,unresolvedIssueCount:2,versionCount:2,lineageAvailable:true,latestAt:null};
 const r=await render('../work/_components/work-feed.tsx',{...base,view:'review',queue:{...queue,items:[item]},names:{'video-agent':'Video agent'},reviewDetails:{'root-id':'2 versions · 2 open issues'}},{exportName:'WorkList',fetch:fetchSummary,backend:path=>path.startsWith('/api/v2/scheduled-skills/live')?{items:[live]}:{ok:true}});
 try{
  await flush(r);
  assert.equal(r.document.querySelectorAll('[aria-label="Work items"] .work-item-row').length,1);
  assert.ok(r.document.querySelector('a[href="/review/running-id"]'));
  assert.ok(r.document.querySelector('button[aria-label="Stop this run"]'));
  assert.match(r.text(),/2 versions · 2 open issues/);
 }finally{r.cleanup();}
});

test('Work never claims all-clear while live work is loading or unreadable',async()=>{
 let release:(value:unknown)=>void=()=>{};
 const pending=new Promise(resolve=>{release=resolve;});
 const r=await render('../work/_components/work-feed.tsx',base,{exportName:'WorkList',fetch:fetchSummary,backend:path=>path.startsWith('/api/v2/scheduled-skills/live')?pending:{ok:true}});
 try{
  assert.equal(!!r.queryByText('No active agent runs right now'),false);
  await r.act(async()=>{release({items:[]});});await flush(r);
  assert.ok(r.queryByText('No active agent runs right now'));
 }finally{r.cleanup();}
 const failed=await render('../work/_components/work-feed.tsx',{...base,view:'needs',needs:{...emptyNeeds,partial:true}},{exportName:'WorkList',fetch:fetchSummary,backend:()=>{throw new Error('offline');}});
 try{
  await flush(failed);
  assert.equal(!!failed.queryByText('Nothing needs you right now'),false);
  assert.match(failed.text(),/Live status is unavailable/);
  assert.match(failed.text(),/Some actions may be missing/);
 }finally{failed.cleanup();}
});

test('live work renders while server sources are pending; later streamed actions fill the same list',async()=>{
 const r=await render('../../../test/fixtures/work-streaming.tsx',{}, {fetch:fetchSummary,backend:path=>path.startsWith('/api/v2/scheduled-skills/live')?{items:[live]}:{ok:true}});
 try{
  await flush(r);
  assert.match(r.text(),/A real run title/,'live progress does not wait for a slow server action or review source');
  assert.match(r.text(),/Step 2 of 6 · Choosing visuals/);
  assert.equal(r.document.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow'),'1');
  assert.match(r.text(),/Checking actions and reviews/);
  assert.doesNotMatch(r.text(),/Some work couldn’t be checked|No active agent runs/,'loading is not a failed or empty read');
  const props={needs:{...emptyNeeds,needGrant:[{slug:'grant-agent',name:'Grant agent',reason:'Connect this account'}]},review:{queue,names:{},reviewDetails:{},warning:null}};
  await r.rerender(props);await flush(r);
  assert.equal(r.document.querySelectorAll('[aria-label="Work items"] .work-item-row').length,2);
  assert.match(r.text(),/A real run title/);
  assert.ok(r.document.querySelector('a[href="/workflows/grant-agent/activate"]'));
  assert.doesNotMatch(r.text(),/Checking actions and reviews/);
  assert.equal(r.calls.backend.filter(call=>call.path.startsWith('/api/v2/scheduled-skills/live')).length,1,'streaming a source does not mount another live poller');
 }finally{r.cleanup();}
});

test('Needs-you rows sort newest first, use plain needs copy and retain bounded stalled work once',async()=>{
 const judge={attentionId:'old',sourceType:'judge_block',sourceId:'judgment',runId:'old-judge',agentSlug:'old-video-agent',agentName:'old-video-agent',whatHappened:'Internal verification detail with TOOL_KEY and frozen proof',requiredAction:'provide_information',actionDetail:'Raw internal detail',primaryAction:{kind:'provide_information',targetType:'judge_block',targetId:'judgment',label:'Provide information'},reasons:[],createdAt:'2026-11-20T12:00:00Z',seenAt:null,resolvedAt:null};
 const needs={...emptyNeeds,homeAttention:[judge],stalled:[{id:'new-stall',slug:'new-video-agent',name:'new-video-agent',at:'2026-11-21T12:00:00Z'},{id:'running-id',slug:'video-agent',name:'Video agent',at:'2026-11-21T12:00:00Z'}]};
 const r=await render('../work/_components/work-feed.tsx',{...base,view:'needs',needs},{exportName:'WorkList',fetch:fetchSummary,backend:path=>path.startsWith('/api/v2/scheduled-skills/live')?{items:[{...live,status:'needs_attention',since:'2026-11-21T13:00:00Z'}]}:{ok:true}});
 try{
  await flush(r);
  const titles=Array.from(r.document.querySelectorAll('[aria-label="Work items"] .work-row-title')).map(node=>node.textContent);
  assert.deepEqual(titles,['A real run title','New Video Agent','Old Video Agent']);
  assert.equal(titles.filter(title=>title==='New Video Agent').length,1);
  assert.ok(r.document.querySelector('a[href="/runs/new-stall"]'));
  const subs=Array.from(r.document.querySelectorAll('.work-row-sub')).map(node=>node.textContent).join(' ');
  assert.doesNotMatch(subs,/TOOL_KEY|frozen proof|Raw internal detail/);
  assert.match(subs,/needs information/);
  assert.match(r.document.querySelector('.work-row-details')?.textContent||'',/Internal verification detail|This run stopped/);
  const inputAction=Array.from(r.document.querySelectorAll('button')).find(node=>node.textContent==='Provide information');
  assert.ok(inputAction?.className.includes('btn-primary'));
 }finally{r.cleanup();}
});

test('row times are compact relative labels or short dates, with the precise timestamp retained',async()=>{
 const iso=new Date(Date.now()-10*60_000).toISOString();
 const r=await render('local-time.tsx',{iso});
 try{
  await flush(r);assert.match(r.text(),/10 min ago/);assert.equal(r.document.querySelector('time')?.dateTime,iso);
  await r.rerender({iso:'2025-04-03T12:00:00Z'});await flush(r);assert.equal(r.text(),'Apr 3');
 }finally{r.cleanup();}
});

test('the already-loaded caller names are shared with review and recent-result rows',async()=>{
 const r=await render('../work/_components/work-feed.tsx',{...base,needs:{...emptyNeeds,agentNames:{'private-video-agent':'My private studio'}}},{exportName:'WorkList',fetch:(async()=>Response.json({rows:[{id:'delivered',skill_slug:'private-video-agent',status:'completed',ran_at:'2026-11-21T12:00:00Z'}],nextCursor:null})) as typeof fetch,backend:()=>({items:[]})});
 try{
  await flush(r);
  const recent=r.document.querySelector('[aria-label="Recently delivered"] .work-row-title');assert.equal(recent?.textContent,'My private studio');
 }finally{r.cleanup();}
});
