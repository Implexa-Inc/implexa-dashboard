import test from 'node:test';import assert from 'node:assert/strict';import {createHash,webcrypto} from 'node:crypto';
import {render} from '../../../../lib/test/render.ts';
const U=(n:number)=>`80000000-0000-4000-8000-${String(n).padStart(12,'0')}`,H='a'.repeat(64);
const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=','base64'),image=`data:image/png;base64,${bytes.toString('base64')}`;
const c={id:U(1),agentFamilyId:U(2),producingVersionId:U(3),shareDigest:H,excerpt:'Smooth the transition so it explains the connection.',evidence:{evidenceId:U(4),sha256:createHash('sha256').update(bytes).digest('hex'),sizeBytes:bytes.length,width:1,height:1,mediaType:'image/png',timeMs:100},createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString(),storedAt:new Date().toISOString(),withdrawnAt:null,dismissedAt:null,referenceOnly:true};
test('a customer frame is reviewed before drafting and trainer approval prepares inert guidance through the existing ledger',async()=>{
 const actions:any[]=[],saved:string[]=[],fields={chosen:'A transition between diagrams.',why:'Make the change explain the relationship.',process:'Applies when scenes build on one idea.',desiredBehavior:'Unfold the transition smoothly with the narration.'};
 const props={slug:'video-craft',ownerId:U(9),sessionId:U(10),versionId:U(3),disabled:false,onStart:async()=>{},onSaved:()=>saved.push('review'),onOwnExample:()=>saved.push('own')};
 const r=await render('../training/[slug]/customer-training-inbox.tsx',props,{fetch:(async(_url:any,init:any={})=>{
  if(!init.method)return {ok:true,json:async()=>({ok:true,contractVersion:'customer-training-inbox.v1',items:[c]})};
  const body=JSON.parse(init.body);actions.push({body,key:init.headers['Idempotency-Key']});
  return {ok:true,json:async()=>body.action==='read'?{ok:true,contribution:c,image}:body.action==='draft'?{ok:true,contractVersion:'customer-contribution-draft.v1',id:c.id,shareDigest:H,status:'suggested',fields,scopeSuggestion:{property:'motion_rhythm',relation:'rejected'}}:{ok:true,contractVersion:'customer-contribution-teaching.v1',recordId:U(20),recordDigest:H}};
 }) as typeof fetch});Object.defineProperty(r.window,'crypto',{value:webcrypto});
 try{
  assert.equal(actions.length,0);await r.click(r.getByText('Review suggestion →'));assert.deepEqual(actions.map(x=>x.body.action),['read']);assert.equal(r.document.querySelector('img')?.getAttribute('src'),image);
  await r.click(r.getByText('Suggest a reusable lesson'));assert.deepEqual(actions.map(x=>x.body.action),['read','draft']);assert.equal(saved.length,0);
  await r.click(r.getByText('Review as training'));assert.deepEqual(actions.map(x=>x.body.action),['read','draft','prepare']);assert.deepEqual(saved,['review']);
  const prepared=actions[2].body;assert.equal(prepared.content.instruction,[fields.why,fields.process,fields.desiredBehavior].join(' '));assert.equal(prepared.content.instruction.includes(c.excerpt),false);assert.equal(prepared.content.contractVersion,'agent-text-teaching.v1');assert.equal(prepared.image,undefined);assert.equal(prepared.ownerId,undefined);
  assert.match(r.text(),/Teaching suggestion saved/);assert.equal(r.queryByText('Review as training'),null);
 }finally{r.cleanup();}
});
test('choosing a trainer-owned example dismisses only the customer suggestion and opens teaching without admission',async()=>{
 const actions:string[]=[],own:string[]=[];
 const r=await render('../training/[slug]/customer-training-inbox.tsx',{slug:'video-craft',ownerId:U(9),sessionId:U(10),versionId:U(3),disabled:false,onStart:async()=>{},onSaved:()=>{},onOwnExample:()=>own.push('open')},{fetch:(async(_url:any,init:any={})=>{if(!init.method)return {ok:true,json:async()=>({ok:true,contractVersion:'customer-training-inbox.v1',items:[c]})};const body=JSON.parse(init.body);actions.push(body.action);return {ok:true,json:async()=>({ok:true,contribution:c,image})};}) as typeof fetch});Object.defineProperty(r.window,'crypto',{value:webcrypto});
 try{await r.click(r.getByText('Review suggestion →'));await r.click(r.getByText('Teach with my own example instead'));assert.deepEqual(actions,['read','dismiss']);assert.deepEqual(own,['open']);assert.equal(r.queryByText(c.excerpt),null);}finally{r.cleanup();}
});

test('changing version while a frame read is pending releases the new view and ignores the old frame',async()=>{
 let resolveRead!:(value:any)=>void,reads=0;
 const props={slug:'video-craft',ownerId:U(9),sessionId:U(10),versionId:U(3),disabled:false,onStart:async()=>{},onSaved:()=>{},onOwnExample:()=>{}};
 const r=await render('../training/[slug]/customer-training-inbox.tsx',props,{fetch:(async(_url:any,init:any={})=>{
  if(!init.method)return {ok:true,json:async()=>({ok:true,contractVersion:'customer-training-inbox.v1',items:[c]})};
  reads++;if(reads===1)return new Promise(resolve=>{resolveRead=resolve;});
  return {ok:true,json:async()=>({ok:true,contribution:c,image})};
 }) as typeof fetch});Object.defineProperty(r.window,'crypto',{value:webcrypto});
 try{
  await r.click(r.getByText('Review suggestion →'));await r.rerender({...props,versionId:U(30)});
  await r.act(()=>resolveRead({ok:true,json:async()=>({ok:true,contribution:c,image})}));
  assert.equal((r.getByText('Review suggestion →') as HTMLButtonElement).disabled,false);assert.equal(r.document.querySelector('img'),null);
  await r.click(r.getByText('Review suggestion →'));assert.equal(reads,2);assert.equal(r.document.querySelector('img')?.getAttribute('src'),image);
 }finally{r.cleanup();}
});

test('starting the first Training session preserves the reviewed customer frame and edited guidance',async()=>{
 const actions:any[]=[],starts:string[]=[],saved:string[]=[],fields={chosen:'A transition.',why:'Explain a relationship.',process:'Unfold the connection.',desiredBehavior:'Keep the meaning clear.'};
 const props={slug:'video-craft',ownerId:U(9),sessionId:null as string|null,versionId:U(3),disabled:false,onStart:async()=>{starts.push('start');},onSaved:()=>saved.push('review'),onOwnExample:()=>{}};
 const r=await render('../training/[slug]/customer-training-inbox.tsx',props,{fetch:(async(_url:any,init:any={})=>{
  if(!init.method)return {ok:true,json:async()=>({ok:true,contractVersion:'customer-training-inbox.v1',items:[c]})};const body=JSON.parse(init.body);actions.push(body);
  return {ok:true,json:async()=>body.action==='read'?{ok:true,contribution:c,image}:body.action==='draft'?{ok:true,contractVersion:'customer-contribution-draft.v1',id:c.id,shareDigest:H,status:'suggested',fields,scopeSuggestion:{property:'motion_rhythm',relation:'rejected'}}:{ok:true,contractVersion:'customer-contribution-teaching.v1',recordId:U(20),recordDigest:H}};
 }) as typeof fetch});Object.defineProperty(r.window,'crypto',{value:webcrypto});
 try{
  await r.click(r.getByText('Review suggestion →'));await r.click(r.getByText('Suggest a reusable lesson'));
  const before=(r.document.querySelector('textarea') as HTMLTextAreaElement).value;
  await r.click(r.getByText('Continue to training'));assert.deepEqual(starts,['start']);await r.rerender({...props,sessionId:U(10)});
  assert.equal((r.document.querySelector('textarea') as HTMLTextAreaElement).value,before);assert.equal(r.document.querySelector('img')?.getAttribute('src'),image);
  await r.click(r.getByText('Review as training'));assert.deepEqual(actions.map(x=>x.action),['read','draft','prepare']);assert.equal(actions[2].sessionId,U(10));assert.deepEqual(saved,['review']);
 }finally{r.cleanup();}
});
