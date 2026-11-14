import test from 'node:test';import assert from 'node:assert/strict';import {render} from '../../../../lib/test/render.ts';
test('admin reviews exact submitted digest and decisions remain separate from execution and publication',async()=>{
 const calls:any[]=[];const entry={id:'submission',name:'Studio',studioName:'Trainer',revision:5,versionId:'version'};
 const selected={...entry,payloadDigest:'d'.repeat(64),canApprove:true,latestSubmitted:true,review:null,effectiveReview:null,targetReview:null,listing:{...entry,category:'Video',input:'Raw video',output:'Edited video',servicePriceCents:5000,pricePeriod:'per_run',tools:[]},samples:[{artifactId:'artifact',filename:'video.mp4',sha256:'a'.repeat(64),sizeBytes:100}]};
 const r=await render('../admin/marketplace/review.tsx',{}, {fetch:(async(url:string,init:any={})=>{calls.push({url,init});return {ok:true,json:async()=>init.method==='POST'?{ok:true,reviewId:'review',decision:JSON.parse(init.body).decision}:url.includes('?id=')?{ok:true,submission:selected}:{ok:true,submissions:[entry]}};}) as typeof fetch});
 try{
  await r.click(r.getByText('Studio'));assert.match(r.text(),/video.mp4/);assert.match(r.text(),/Playback is not hosted yet/);
  await r.click(r.getByText('Approve beta listing'));const b=JSON.parse(calls.find(c=>c.init.method==='POST').init.body);
  assert.equal(b.submissionId,'submission');assert.equal(b.payloadDigest,'d'.repeat(64));assert.equal(b.expectedReviewId,null);assert.equal(b.decision,'approved');assert.match(r.text(),/Approved for the beta marketplace/);
  await r.click(r.getByText('Remove approved listing'));assert.equal(JSON.parse(calls.filter(c=>c.init.method==='POST')[1].init.body).decision,'revoked');
  assert.equal(calls.some(c=>/generate|publication|install|allowance/.test(c.url)),false);
 }finally{r.cleanup();}
});

test('rejecting the newest proposal leaves the earlier effective listing and cannot reject an older target',async()=>{
 const base={id:'new',name:'Proposed studio',studioName:'Trainer',revision:6,versionId:'version',payloadDigest:'d'.repeat(64),canApprove:true,latestSubmitted:true,
 review:{id:'prior',submission_id:'old',decision:'approved'},effectiveReview:{id:'prior',submission_id:'old',decision:'approved'},targetReview:null,
 listing:{name:'Proposed studio',studioName:'Trainer',category:'Video',input:'Raw',output:'Edit',servicePriceCents:5000,pricePeriod:'per_run',tools:[]},samples:[]};
 const calls:any[]=[];
 const r=await render('../admin/marketplace/review.tsx',{}, {fetch:(async(url:string,init:any={})=>{calls.push({url,init});return {ok:true,json:async()=>init.method==='POST'?{ok:true,reviewId:'reject',decision:'rejected'}:url.includes('?id=')?{ok:true,submission:base}:{ok:true,submissions:[base]}};}) as typeof fetch});
 try{await r.click(r.getByText('Proposed studio'));await r.click(r.getByText('Reject proposed listing'));
  assert.equal(JSON.parse(calls.find(c=>c.init.method==='POST').init.body).expectedReviewId,'prior');assert.match(r.text(),/earlier approved listing is unchanged/);
  assert.equal((r.getByText('Reject proposed listing') as HTMLButtonElement).disabled,true);
  assert.equal((r.getByText('Approve beta listing') as HTMLButtonElement).disabled,true);
 }finally{r.cleanup();}
});

test('restricted listing wording can be rejected without displaying its private content',async()=>{
 const s={id:'bad',name:'Restricted content',studioName:'Review to reject',revision:7,listing:null,samples:[],canApprove:false,latestSubmitted:true,targetReview:null,review:null};
 const r=await render('../admin/marketplace/review.tsx',{}, {fetch:(async(url:string)=>({ok:true,json:async()=>url.includes('?id=')?{ok:true,submission:s}:{ok:true,submissions:[s]}})) as typeof fetch});
 try{await r.click(r.getByText('Restricted content'));assert.match(r.text(),/wording is hidden/);assert.equal((r.getByText('Approve beta listing') as HTMLButtonElement).disabled,true);assert.equal((r.getByText('Reject proposed listing') as HTMLButtonElement).disabled,false);}finally{r.cleanup();}
});
