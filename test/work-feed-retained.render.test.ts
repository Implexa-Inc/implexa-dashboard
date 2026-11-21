import test from 'node:test';import assert from 'node:assert/strict';import {render} from '../lib/test/render.ts';
const needs={needGrant:[],missed:[],signIns:[],stalled:[],attentionItems:[],homeAttention:[],pendingReviews:0,homeCount:0,total:0,partial:true,truncated:false,unavailableSources:['connections']};
const queue={items:[],truncated:false,total:0,visibleCount:0,sources:{review_endpoint:'ready'},live:true};
const props={view:'needs',needs,queue,names:{},reviewDetails:{},warning:null};
const flush=async(r:any)=>r.act(()=>new Promise(resolve=>setTimeout(resolve,20)));
test('fresh partial Work rows can fall from 20 to 15 and update both tabs and the shell',async()=>{
 const actions=(count:number)=>Array.from({length:count},(_,i)=>({slug:`agent-${i}`,name:`Agent ${i}`}));
 const r=await render('../../../test/fixtures/work-retained-count.tsx',{...props,needs:{...needs,needGrant:actions(20)}},{backend:()=>({items:[]}),fetch:(async(path:any)=>Response.json(String(path).includes('/api/runs/summary')?{rows:[],nextCursor:null}:{ok:true,canTrain:true,work:{count:2,complete:false}})) as any});
 try{
  await flush(r);const tab=()=>r.document.querySelector('nav[aria-label="Work filters"] a[href="/work?view=needs"]')?.textContent;
  assert.match(tab()||'',/20\+/);assert.ok(r.document.querySelector('[aria-label="At least 20 need you"]'));
  await r.rerender({...props,needs:{...needs,needGrant:actions(15)}});await flush(r);
  assert.match(tab()||'',/15\+/);assert.ok(r.document.querySelector('[aria-label="At least 15 need you"]'));assert.equal(r.document.querySelector('[aria-label="At least 20 need you"]'),null);
  assert.equal(r.document.querySelectorAll('.work-rows .work-item-row').length,15);
  await r.rerender({...props});await flush(r);
  assert.equal(r.document.querySelector('[aria-label="At least 15 need you"]'),null);
  assert.equal(r.window.sessionStorage.getItem('tukido.work-attention:retained-review'),null,'fresh zero clears a stale hint even while one source stays partial');
 }finally{r.cleanup();}
});
