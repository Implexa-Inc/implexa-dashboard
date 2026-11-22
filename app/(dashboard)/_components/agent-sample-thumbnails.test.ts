import test from 'node:test';import assert from 'node:assert/strict';import {render} from '../../../lib/test/render.ts';
const id=(n:number)=>`89000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const cover=(n:number)=>({id:id(n),kind:'uploaded',name:'Trainer-provided example',mediaType:'image/jpeg',width:320,height:180,durationMs:0,provenance:'trainer_uploaded'});
function props(count=1,start=1){const agents=Array.from({length:count},(_,i)=>({id:id(start+i),slug:'agent-'+(start+i),name:'Agent '+(start+i),description:'A synthetic service',versionId:id(999),decisions:[],decisionsComplete:true,liveLessons:0,lastTaughtAt:null,listing:'not_listed'}));return {owned:agents.map(a=>({...a,source:'generated',updated_at:null})),summary:{ok:true,contractVersion:'training-coach-decisions.v1',complete:true,agents}};}
test('Coach artwork is independent and batched at fifty families, never one request per row',async t=>{
 const calls:any[]=[];const r=await render('training-agent-picker.tsx',props(51),{fetch:(async(url:string,init:any)=>{const families=new URL(url,'https://fixture.invalid').searchParams.get('familyIds')!.split(',');calls.push({url,familyIds:families});return {ok:true,json:async()=>({ok:true,items:families.map((familyId:string)=>({familyId,cover:familyId===id(1)?cover(501):null}))})};}) as typeof fetch});t.after(()=>r.cleanup());
 assert.equal(calls.length,2);assert.deepEqual(calls.map(c=>c.familyIds.length),[50,1]);assert.ok(calls.every(c=>c.url.includes('action=covers&familyIds=')));assert.equal(r.document.querySelectorAll('img[alt="Trainer-provided example"]').length,1);assert.ok(r.queryByText('All agents you train'));assert.ok(r.document.querySelector('a[href="/training/agent-1"]'));
});
test('a delayed cover batch cannot overwrite a newer collection identity',async t=>{
 let release!:(value:any)=>void;const first=new Promise(resolve=>release=resolve),calls:any[]=[];
 const r=await render('training-agent-picker.tsx',props(),{fetch:(async(url:string)=>{const families=new URL(url,'https://fixture.invalid').searchParams.get('familyIds')!.split(',');calls.push(families);if(families[0]===id(1))return first;return {ok:true,json:async()=>({ok:true,items:[{familyId:id(2),cover:cover(502)}]})};}) as typeof fetch});t.after(()=>r.cleanup());
 await r.rerender(props(1,2));await r.act(async()=>{release({ok:true,json:async()=>({ok:true,items:[{familyId:id(1),cover:cover(501)}]})});await new Promise(resolve=>setTimeout(resolve,0));});
 assert.equal(calls.length,2);const image=r.document.querySelector('img')!;assert.ok(image);assert.match(image.getAttribute('src')!,new RegExp(id(502)));assert.doesNotMatch(image.getAttribute('src')!,new RegExp(id(501)));
});
