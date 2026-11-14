import test from 'node:test';import assert from 'node:assert/strict';import {render} from '../../../../lib/test/render.ts';
test('admin reviews exact submitted digest and decisions remain separate from execution and publication',async()=>{
 const calls:any[]=[];const entry={id:'submission',name:'Studio',studioName:'Trainer',revision:5,versionId:'version'};
 const selected={...entry,payloadDigest:'d'.repeat(64),canApprove:true,review:null,listing:{...entry,category:'Video',input:'Raw video',output:'Edited video',servicePriceCents:5000,pricePeriod:'per_run',tools:[]},samples:[{artifactId:'artifact',filename:'video.mp4',sha256:'a'.repeat(64),sizeBytes:100}]};
 const r=await render('../admin/marketplace/review.tsx',{}, {fetch:(async(url:string,init:any={})=>{calls.push({url,init});return {ok:true,json:async()=>init.method==='POST'?{ok:true,reviewId:'review',decision:JSON.parse(init.body).decision}:url.includes('?id=')?{ok:true,submission:selected}:{ok:true,submissions:[entry]}};}) as typeof fetch});
 try{
  await r.click(r.getByText('Studio'));assert.match(r.text(),/video.mp4/);assert.match(r.text(),/Playback is not hosted yet/);
  await r.click(r.getByText('Approve beta listing'));const b=JSON.parse(calls.find(c=>c.init.method==='POST').init.body);
  assert.equal(b.submissionId,'submission');assert.equal(b.payloadDigest,'d'.repeat(64));assert.equal(b.expectedReviewId,null);assert.equal(b.decision,'approved');assert.match(r.text(),/Approved for the beta marketplace/);
  await r.click(r.getByText('Keep off marketplace'));assert.equal(JSON.parse(calls.filter(c=>c.init.method==='POST')[1].init.body).decision,'revoked');
  assert.equal(calls.some(c=>/generate|publication|install|allowance/.test(c.url)),false);
 }finally{r.cleanup();}
});
