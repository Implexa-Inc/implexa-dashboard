import test from 'node:test';
import assert from 'node:assert/strict';
import {render} from '../../../../lib/test/render.ts';
const id=(n:number)=>`80000000-0000-4000-8000-${String(n).padStart(12,'0')}`,H='a'.repeat(64);
const item={id:id(10),kind:'lesson',source:'record',sessionId:id(4),versionId:id(3),digest:H,createdAt:'2026-11-21T12:00:00Z'};
const agent={id:id(2),slug:'studio',name:'Studio',description:null,versionId:id(3),decisions:[item],decisionsComplete:true,liveLessons:0,lastTaughtAt:null,listing:'not_listed'};
test('decision counts and Review target come from the same exact identity list',async()=>{
 const chosen:any[]=[];const r=await render('../training/[slug]/training-decisions.tsx',{agent,loading:false,error:false,changes:null,questions:null,onReview:(item:any)=>chosen.push(item),onRetry:()=>{}});
 try{assert.equal(r.document.querySelectorAll('.training-decision-card').length,1);assert.match(r.text(),/Needs your decision 1/);assert.equal(chosen.length,0);await r.click(r.getByText('Review'));assert.deepEqual(JSON.parse(JSON.stringify(chosen)),[item]);}finally{r.cleanup();}
});
test('unknown decisions stay unavailable rather than appearing as an empty successful queue',async()=>{
 const props={agent:null,loading:false,error:true,changes:null,questions:null,onReview:()=>{},onRetry:()=>{}};
 const r=await render('../training/[slug]/training-decisions.tsx',props);
 try{assert.match(r.text(),/Suggestions couldn’t load/);assert.doesNotMatch(r.text(),/Nothing is waiting/);await r.rerender({...props,error:false,agent:{...agent,decisions:[],decisionsComplete:false}} as any);assert.match(r.text(),/Needs your decision 0\+/);assert.match(r.text(),/there may be more/);assert.doesNotMatch(r.text(),/Nothing is waiting/);}finally{r.cleanup();}
});
