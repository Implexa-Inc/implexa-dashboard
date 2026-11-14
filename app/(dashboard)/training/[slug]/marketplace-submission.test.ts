import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {render,type Rendered} from '../../../../lib/test/render.ts';
const V='12000000-0000-4000-8000-000000000001';
function fixture(){return {ok:true,contractVersion:'marketplace-submission.v1',agent:{id:'family',versionId:V,name:'Studio'},bindingDigest:'b'.repeat(64),canSubmit:true,
 tools:[{id:'runway',name:'Runway',required:false,provider:'runway',canInclude:true,accessMode:'api'}],engines:['codex'],
 samples:[{id:'sample',runId:'run',sha256:'a'.repeat(64),relativePath:'video.mp4',role:'final_output',status:'validated',sizeBytes:100,mtime:null,validatedAt:'2026-11-13',date:'2026-11-13'}],
 defaults:{name:'Video studio',studioName:'My studio',category:'Video production',input:'Raw video',output:'Finished video',servicePriceCents:5000,pricePeriod:'per_run',sampleIds:[],sampleReleaseConsent:false,tools:[{id:'runway',mode:'customer_connects',credits:60,markupPercent:0}]},
 draft:null,runwayPrice:{creditsPerClip:60,centsPerCredit:1,currency:'USD',model:'gen4.5',durationSeconds:5,sourceUrl:'https://docs.dev.runwayml.com/guides/pricing/',checkedAt:'2026-11-13',validUntil:'2099-11-20'}};}
async function setup(t:any,options:{canSubmit?:boolean;postFailure?:boolean}={}){
 const calls:any[]=[];const c=fixture();if(options.canSubmit!==undefined)c.canSubmit=options.canSubmit;
 const props={slug:'studio',versionId:V};
 const r=await render('../training/[slug]/marketplace-submission.tsx',props,{fetch:(async(url:string,init:any={})=>{
  calls.push({url,init});if(init.method==='POST')return {ok:!options.postFailure,json:async()=>options.postFailure?{ok:false,reason:'listing_revision_changed'}:JSON.parse(init.body).action==='suggest'?{ok:true,bindingDigest:c.bindingDigest,copy:{name:'AI video wording',category:'Video',input:'Your raw video',output:'A finished edit'}}:{ok:true,submission:{revision:JSON.parse(init.body).expectedRevision+1,state:'submitted'}}};
  return {ok:true,json:async()=>c};
 }) as typeof fetch});t.after(()=>r.cleanup());return {r,calls,props};
}
async function input(r:Rendered,el:HTMLInputElement|HTMLSelectElement,value:string){
 await r.act(()=>{const proto=el.tagName==='SELECT'?r.window.HTMLSelectElement.prototype:r.window.HTMLInputElement.prototype;
 Object.getOwnPropertyDescriptor(proto,'value')!.set!.call(el,value);el.dispatchEvent(new r.window.Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));});
}
test('the Training card loads nothing and opening pre-fills a private draft without writes',async t=>{
 const {r,calls}=await setup(t);assert.equal(calls.length,0);await r.click(r.getByText('Prepare marketplace listing'));
 assert.equal(calls.length,1);assert.equal((r.document.querySelector('input') as HTMLInputElement).value,'Video studio');
 assert.equal((r.getByText('Submit for review') as HTMLButtonElement).disabled,true);assert.equal(calls.some(c=>c.init.method==='POST'),false);
});
test('included tool calculator shows 100 credits plus 20 percent as 1.20, separately from service price',async t=>{
 const {r,calls}=await setup(t);await r.click(r.getByText('Prepare marketplace listing'));
 await input(r,r.document.querySelector('[aria-label="Runway access"]') as HTMLSelectElement,'included');
 const numbers=r.document.querySelectorAll('input[type="number"]');await input(r,numbers[1] as HTMLInputElement,'100');await input(r,numbers[2] as HTMLInputElement,'20');
 assert.match(r.text(),/\$1\.20/);assert.match(r.text(),/Funding setup required/);await r.click(r.getByText('Preview listing'));assert.match(r.text(),/\$50\.00/);assert.match(r.text(),/\$1\.20 per run/);
 assert.equal(calls.some(c=>c.init.method==='POST'),false);
});
test('sample consent gates a single version-pinned review submission, not publication',async t=>{
 const {r,calls}=await setup(t);await r.click(r.getByText('Prepare marketplace listing'));
 const checks=Array.from(r.document.querySelectorAll('input[type="checkbox"]'));await r.click(checks[0]);await r.click(checks.at(-1)!);
 await r.click(r.getByText('Submit for review'));const posts=calls.filter(c=>c.init.method==='POST');assert.equal(posts.length,1);
 const b=JSON.parse(posts[0].init.body);assert.equal(b.action,'submit');assert.equal(b.expectedRevision,0);assert.equal(b.bindingDigest,'b'.repeat(64));assert.equal(b.listing.sampleReleaseConsent,true);
 assert.match(r.text(),/Publication is a separate step/);assert.equal(calls.some(c=>/publication|sponsored|generate|credential/.test(c.url)),false);
});
test('an untested version can save a draft but cannot submit',async t=>{
 const {r,calls}=await setup(t,{canSubmit:false});await r.click(r.getByText('Prepare marketplace listing'));assert.match(r.text(),/Test and publish this version/);
 await r.click(r.getByText('Save draft'));assert.equal(JSON.parse(calls.find(c=>c.init.method==='POST').init.body).action,'save');
});
test('conflict retains edits and switching versions closes the prior offer',async t=>{
 const {r,props}=await setup(t,{postFailure:true});await r.click(r.getByText('Prepare marketplace listing'));
 await r.click(r.getByText('Save draft'));assert.match(r.text(),/saved elsewhere/);assert.equal((r.document.querySelector('input') as HTMLInputElement).value,'Video studio');
 await r.rerender({...props,versionId:'12000000-0000-4000-8000-000000000002'});assert.equal(r.document.querySelector('[role="dialog"]'),null);
});
test('AI suggests editable wording without saving, changing price or granting a tool',async t=>{
 const {r,calls}=await setup(t);await r.click(r.getByText('Prepare marketplace listing'));await r.click(r.getByText('✨ Suggest wording with AI'));
 assert.equal((r.document.querySelector('input') as HTMLInputElement).value,'AI video wording');assert.equal((r.document.querySelector('input[type="number"]') as HTMLInputElement).value,'50');
 assert.equal((r.document.querySelector('[aria-label="Runway access"]') as HTMLSelectElement).value,'customer_connects');
 assert.deepEqual(calls.filter(c=>c.init.method==='POST').map(c=>JSON.parse(c.init.body)),[{action:'suggest',bindingDigest:'b'.repeat(64)}]);
 assert.match(r.text(),/Review it before saving/);
});
test('invalid tool prices stay unavailable in both editor and preview',async t=>{
 const {r}=await setup(t);await r.click(r.getByText('Prepare marketplace listing'));await input(r,r.document.querySelector('[aria-label="Runway access"]') as HTMLSelectElement,'included');
 const number=r.document.querySelectorAll('input[type="number"]')[1] as HTMLInputElement;await input(r,number,'0');assert.match(r.text(),/Unavailable/);
 await r.click(r.getByText('Preview listing'));assert.match(r.text(),/price unavailable/);assert.doesNotMatch(r.text(),/\$0\.00 per run|NaN/);
});

test('actual published producer exposes historical funding separately and requires renewed sample consent',async t=>{
 const actual=JSON.parse(readFileSync(new URL('../../../../lib/__fixtures__/marketplace-submission-producer.v1.json',import.meta.url),'utf8')).context;
 const calls:any[]=[];const saved={...actual.defaults,sampleIds:[actual.samples[0].id],sampleReleaseConsent:true};
 actual.draft={id:'draft',revision:2,state:'draft',version_id:actual.agent.versionId,payload:{listing:saved,bindingDigest:actual.bindingDigest}};
 actual.submission={id:'submitted',revision:1,state:'submitted',version_id:actual.agent.versionId};
 const r=await render('../training/[slug]/marketplace-submission.tsx',{slug:'fixture',versionId:actual.agent.versionId},{fetch:(async(url:string,init:any={})=>{calls.push({url,init});return {ok:true,json:async()=>actual};}) as typeof fetch});t.after(()=>r.cleanup());
 await r.click(r.getByText('Prepare marketplace listing'));assert.match(r.text(),/Revision 1 is submitted/);assert.match(r.text(),/Later edits are drafts/);
 const funded=actual.tools.find((t:any)=>t.origin==='funded_pilot_reference');const select=r.document.querySelector(`[aria-label="${funded.name} access"]`) as HTMLSelectElement;
 assert.equal(select.value,'not_offered');assert.equal(Array.from(select.options).some(o=>o.value==='customer_connects'),false);
 const consent=Array.from(r.document.querySelectorAll('input[type="checkbox"]')).at(-1) as HTMLInputElement;assert.equal(consent.checked,false);
 assert.equal((r.getByText('Submit for review') as HTMLButtonElement).disabled,true);await r.click(consent);assert.equal(consent.checked,true);
 const sample=r.document.querySelector('input[type="checkbox"]')!;await r.click(sample);assert.equal(consent.checked,false);
 assert.equal(calls.some(c=>c.init.method==='POST'),false);
});

test('listing metadata works in the web app without a local recording bridge or version prop',async t=>{
 const c=fixture();const r=await render('../training/[slug]/marketplace-submission.tsx',{slug:'studio',versionId:null},{fetch:(async()=>({ok:true,json:async()=>c})) as typeof fetch});t.after(()=>r.cleanup());
 const open=r.getByText('Prepare marketplace listing') as HTMLButtonElement;assert.equal(open.disabled,false);await r.click(open);assert.equal((r.document.querySelector('input') as HTMLInputElement).value,'Video studio');
});

test('owner can retract the approved beta listing without changing publication, training or sample consent',async()=>{
 const c:any=fixture();c.submission={id:'submission',revision:5};c.review={status:'ready',id:'review',submissionId:'submission',decision:'approved'};
 const calls:any[]=[];const r=await render('../training/[slug]/marketplace-submission.tsx',{slug:'studio',versionId:V},{fetch:(async(url:string,init:any={})=>{calls.push({url,init});return {ok:true,json:async()=>init.method==='POST'?{ok:true,reviewId:'retracted',decision:'owner_retracted'}:c};}) as typeof fetch});
 try{await r.click(r.getByText('Prepare marketplace listing'));assert.match(r.text(),/approved for the beta marketplace/);await r.click(r.getByText('Remove beta listing'));
  const posts=calls.filter(x=>x.init.method==='POST');assert.equal(posts.length,1);assert.deepEqual(JSON.parse(posts[0].init.body),{action:'retract',submissionId:'submission',expectedReviewId:'review'});assert.match(r.text(),/Removed from the beta marketplace/);assert.equal(calls.some(x=>/publication|generate|training-changes/.test(x.url)),false);
 }finally{r.cleanup();}
});
