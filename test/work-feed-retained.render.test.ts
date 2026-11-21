import test from 'node:test';import assert from 'node:assert/strict';import {render} from '../lib/test/render.ts';
const needs={needGrant:[],missed:[],signIns:[],stalled:[],attentionItems:[],homeAttention:[],pendingReviews:0,homeCount:0,total:0,partial:true,truncated:false,unavailableSources:['connections']};
const queue={items:[],truncated:false,total:0,visibleCount:0,sources:{review_endpoint:'ready'},live:true};
const props={view:'needs',needs,queue,names:{},reviewDetails:{},warning:null};
const flush=async(r:any)=>r.act(()=>new Promise(resolve=>setTimeout(resolve,20)));
test('partial Work tabs and the shell keep the same session lower bound until a complete read replaces it',async()=>{
 const r=await render('../../../test/fixtures/work-retained-count.tsx',{...props,seed:{count:20,complete:false}},{backend:()=>({items:[]}),fetch:(async(path:any)=>Response.json(String(path).includes('/api/runs/summary')?{rows:[],nextCursor:null}:{ok:true,canTrain:true,work:{count:2,complete:false}})) as any});
 try{
  await flush(r);const tab=()=>r.document.querySelector('nav[aria-label="Work filters"] a[href="/work?view=needs"]')?.textContent;
  assert.match(tab()||'',/20\+/);assert.ok(r.document.querySelector('[aria-label="At least 20 need you"]'));
  await r.rerender({...props,seed:undefined});await flush(r);assert.match(tab()||'',/20\+/);
  await r.rerender({...props,seed:undefined,needs:{...needs,partial:false,unavailableSources:[]}});await flush(r);
  assert.match(tab()||'',/Needs you\s*0/);assert.equal(r.document.querySelector('[aria-label="At least 20 need you"]'),null);
 }finally{r.cleanup();}
});
