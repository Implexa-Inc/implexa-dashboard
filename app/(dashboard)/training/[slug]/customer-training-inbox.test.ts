import test from 'node:test';import assert from 'node:assert/strict';import {webcrypto} from 'node:crypto';
import {render} from '../../../../lib/test/render.ts';
const U=(n:number)=>`80000000-0000-4000-8000-${String(n).padStart(12,'0')}`,H='a'.repeat(64);
const c={id:U(1),shareDigest:H,createdAt:'2026-11-21T18:00:00Z',canSuggest:true,teaching:null};
const guidance={judgment:'Explain the visual relationship.',appliesWhen:'Applies when related scenes change.',instruction:'Unfold the transition smoothly with narration.'};
const proposal={ok:true,contractVersion:'customer-contribution-draft.v2',id:c.id,shareDigest:H,status:'suggested',guidance,scopeSuggestion:{property:'motion_rhythm',relation:'rejected'}};
const props={slug:'video-craft',ownerId:U(9),sessionId:U(10) as string|null,versionId:U(3),disabled:false,onStart:async()=>{},onSaved:()=>{},onOwnExample:()=>{}};
const response=(value:any)=>({ok:true,json:async()=>value});
const list=()=>response({ok:true,contractVersion:'customer-training-inbox.v2',items:[c]});

test('review automatically drafts general guidance without reading or displaying any customer material',async()=>{
 const actions:any[]=[],saved:string[]=[];
 const r=await render('../training/[slug]/customer-training-inbox.tsx',{...props,onSaved:()=>saved.push('review')},{fetch:(async(_url:any,init:any={})=>{
  if(!init.method)return list();const body=JSON.parse(init.body);actions.push(body);
  return response(body.action==='draft'?proposal:{ok:true,contractVersion:'customer-contribution-teaching.v1',recordId:U(20),recordDigest:H});
 }) as typeof fetch});Object.defineProperty(r.window,'crypto',{value:webcrypto});
 try{
  assert.equal(actions.length,0);await r.click(r.getByText('Review suggestion →'));assert.deepEqual(actions.map(x=>x.action),['draft']);assert.equal(r.document.querySelector('img'),null);assert.deepEqual(saved,[]);
  await r.click(r.getByText('Review as training'));assert.deepEqual(actions.map(x=>x.action),['draft','prepare']);assert.deepEqual(saved,['review']);
  const prepared=actions[1];assert.equal(prepared.content.instruction,Object.values(guidance).join(' '));assert.equal(prepared.content.contractVersion,'agent-text-teaching.v1');assert.equal(prepared.image,undefined);assert.equal(prepared.ownerId,undefined);
  assert.match(r.text(),/Teaching suggestion saved/);assert.equal(r.queryByText('Review as training'),null);
 }finally{r.cleanup();}
});
test('choosing an owned example dismisses the suggestion without admitting guidance',async()=>{
 const actions:string[]=[],own:string[]=[];
 const r=await render('../training/[slug]/customer-training-inbox.tsx',{...props,onOwnExample:()=>own.push('open')},{fetch:(async(_url:any,init:any={})=>{if(!init.method)return list();const body=JSON.parse(init.body);actions.push(body.action);return response(body.action==='draft'?proposal:{ok:true});}) as typeof fetch});
 try{await r.click(r.getByText('Review suggestion →'));await r.click(r.getByText('Teach with my own example instead'));assert.deepEqual(actions,['draft','dismiss']);assert.deepEqual(own,['open']);}finally{r.cleanup();}
});
test('changing version ignores an old in-flight generalization and releases the new view',async()=>{
 let resolveOld!:(value:any)=>void,drafts=0;
 const r=await render('../training/[slug]/customer-training-inbox.tsx',props,{fetch:(async(_url:any,init:any={})=>{if(!init.method)return list();drafts++;if(drafts===1)return new Promise(resolve=>{resolveOld=resolve;});return response(proposal);}) as typeof fetch});
 try{await r.click(r.getByText('Review suggestion →'));await r.rerender({...props,versionId:U(30)});await r.act(()=>resolveOld(response(proposal)));assert.equal(r.document.querySelector('textarea'),null);await r.click(r.getByText('Review suggestion →'));await r.act(async()=>{await Promise.resolve();});assert.equal(drafts,2);assert.ok(r.document.querySelector('textarea'),r.text());assert.equal((r.document.querySelector('textarea') as HTMLTextAreaElement).value,Object.values(guidance).join(' '));assert.equal(r.document.querySelector('img'),null);}finally{r.cleanup();}
});
test('starting the first session preserves general guidance without retaining customer material',async()=>{
 const actions:any[]=[],starts:string[]=[],saved:string[]=[];
 const p={...props,sessionId:null as string|null,onStart:async()=>{starts.push('start');},onSaved:()=>saved.push('review')};
 const r=await render('../training/[slug]/customer-training-inbox.tsx',p,{fetch:(async(_url:any,init:any={})=>{if(!init.method)return list();const body=JSON.parse(init.body);actions.push(body);return response(body.action==='draft'?proposal:{ok:true,contractVersion:'customer-contribution-teaching.v1',recordId:U(20),recordDigest:H});}) as typeof fetch});Object.defineProperty(r.window,'crypto',{value:webcrypto});
 try{await r.click(r.getByText('Review suggestion →'));const before=(r.document.querySelector('textarea') as HTMLTextAreaElement).value;await r.click(r.getByText('Continue to training'));assert.deepEqual(starts,['start']);await r.rerender({...p,sessionId:U(10)});assert.equal((r.document.querySelector('textarea') as HTMLTextAreaElement).value,before);assert.equal(r.document.querySelector('img'),null);await r.click(r.getByText('Review as training'));assert.deepEqual(actions.map(x=>x.action),['draft','prepare']);assert.equal(actions[1].sessionId,U(10));assert.deepEqual(saved,['review']);}finally{r.cleanup();}
});
test('a source-bearing or legacy inbox response is refused rather than rendered',async()=>{
 for(const contract of ['customer-training-inbox.v1','customer-training-inbox.v2']){
  const r=await render('../training/[slug]/customer-training-inbox.tsx',props,{fetch:(async()=>response({ok:true,contractVersion:contract,items:[{...c,excerpt:'PRIVATE-CUSTOMER-CANARY',image:'data:image/png;base64,private'}]})) as typeof fetch});
  try{assert.match(r.text(),/couldn’t load/);assert.doesNotMatch(r.text(),/PRIVATE-CUSTOMER-CANARY/);assert.equal(r.document.querySelector('img'),null);assert.equal(r.queryByText('Review suggestion →'),null);}finally{r.cleanup();}
 }
});
test('source-bearing model responses are refused and never enable teaching',async()=>{
 const r=await render('../training/[slug]/customer-training-inbox.tsx',props,{fetch:(async(_url:any,init:any={})=>!init.method?list():response({...proposal,image:'PRIVATE-CUSTOMER-CANARY'})) as typeof fetch});
 try{await r.click(r.getByText('Review suggestion →'));assert.match(r.text(),/could not be verified/);assert.doesNotMatch(r.text(),/PRIVATE-CUSTOMER-CANARY/);assert.equal(r.document.querySelector('img'),null);assert.equal(r.queryByText('Review as training'),null);}finally{r.cleanup();}
});
