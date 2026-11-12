import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {render} from '../../../../lib/test/render.ts';
const saved=()=>JSON.parse(readFileSync(new URL('../../../../lib/__fixtures__/training-review-mark-record.v1.json',import.meta.url),'utf8'));
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,H='a'.repeat(64),component='../training/[slug]/saved-review-teaching.tsx';
const target=(over:any={})=>({recordId:id(1),recordDigest:H,summary:'An approved spatial-explanation lesson.',state:'human_accepted',included:true,admissionOrigin:'human_decision',category:'taste',sourceKind:'legacy_evidence',policyReceiptId:null,policyReceiptDigest:null,sourceEventId:null,sourceEventDigest:null,model:null,reviewMark:{acknowledgmentId:id(6)},...over});
const props=(over:any={})=>({sessionId:id(10),versionId:id(11),slug:'video-studio',target:target(),onClose:()=>{},...over});

test('saved teaching shows the frozen approved judgment and note with only a current-mark link',async()=>{
 const calls:any[]=[],r=await render(component,props(),{fetch:(async(url:any,init:any)=>{calls.push({url,init});return {ok:true,json:async()=>saved()};}) as typeof fetch});
 try{
  assert.match(r.text(),/Prefer a spatial explanation when geography matters/);assert.match(r.text(),/When location explains the comparison/);assert.match(r.text(),/Keep this · layout variety/);assert.match(r.text(),/Teaching uses the note as you approved it/);
  const details=r.document.querySelector('details')!;assert.equal(details.open,false);assert.match(details.textContent||'',/Use a map here, not another list/);assert.match(details.textContent||'',/Original saved training note/);
  assert.equal(r.document.querySelector('a')?.getAttribute('href'),`/training/video-studio/review/${id(7)}`);assert.match(r.text(),/current mark may have changed/);assert.equal(r.document.querySelectorAll('input,textarea,img,video').length,0);
  assert.equal(calls.length,1);assert.match(calls[0].url,new RegExp(`sessionId=${id(10)}&recordId=${id(1)}&expectedRecordDigest=${H}`));assert.equal(calls[0].init.cache,'no-store');assert.equal(calls[0].init.method,undefined);assert.equal(calls[0].init.body,undefined);
 }finally{r.cleanup();}
});

test('late reader responses cannot replace a newly selected lesson',async()=>{
 let release:(value:any)=>void=()=>{};let reads=0;const next={...saved(),recordId:id(2),fields:{...saved().fields,why:'The current selected lesson.'}};
 const first=props(),r=await render(component,first,{fetch:(async()=>++reads===1?new Promise(resolve=>release=resolve):{ok:true,json:async()=>next}) as typeof fetch});
 try{await r.rerender(props({target:target({recordId:id(2),reviewMark:{acknowledgmentId:id(9)}})}));assert.match(r.text(),/current selected lesson/);await r.act(async()=>{release({ok:true,json:async()=>saved()});await new Promise(resolve=>setTimeout(resolve,10));});assert.match(r.text(),/current selected lesson/);assert.doesNotMatch(r.text(),/Prefer a spatial explanation/);}finally{r.cleanup();}
});

test('stale, foreign and withdrawn saved teachings show no guessed source or raw prose',async()=>{
 for(const reason of ['teaching_changed','training_review_record_not_found','training_review_record_unavailable']){
  const r=await render(component,props(),{fetch:(async()=>({ok:false,json:async()=>({ok:false,reason,sourceMark:{body:'Do not expose this refused note.'}})})) as typeof fetch});
  try{assert.ok(r.document.querySelector('[role="alert"]'));assert.equal(r.document.querySelector('a'),null);assert.doesNotMatch(r.text(),/Do not expose|approved spatial-explanation lesson/);}finally{r.cleanup();}
 }
});

const projection=(state='discarded',digest=H)=>({ok:true,contractVersion:'guided-training-changes.v1',binding:{sessionId:id(10),agentFamilyId:id(12),workflowVersionId:id(11),snapshotDigest:H},policy:{policyId:null,policyDigest:null,revision:0,enabled:false},feedback:[],records:[target({state,recordDigest:digest,included:false,summary:null})],test:{snapshotDigest:null,scope:null,status:'not_run',runId:null,qualityScore:null,gaps:[],canTest:false},publication:{canPublish:false,reason:null,servedSnapshotDigest:null}});
test('explicit withdrawal uses only the exact current record, hides saved prose and retains original feedback',async()=>{
 const calls:any[]=[],changed:any[]=[];const r=await render(component,props({onChanged:()=>changed.push(true)}),{fetch:(async(url:any,init:any)=>{calls.push({url,init});return {ok:true,json:async()=>init?.method==='POST'?{ok:true,created:true,recordId:id(1),eventId:id(21),action:'discard'}:saved()};}) as typeof fetch});
 try{assert.equal(calls.length,1);await r.click(r.getByText('Withdraw teaching'));assert.equal(calls.length,2);assert.equal(calls[1].url,`/api/agent-training/review-mark-record?sessionId=${id(10)}`);assert.equal(calls[1].init.method,'POST');assert.deepEqual(JSON.parse(calls[1].init.body),{action:'discard',recordId:id(1),expectedRecordDigest:H});assert.match(calls[1].init.headers['Idempotency-Key'],/^[a-f0-9-]{36}$/);assert.match(r.text(),/Teaching withdrawn/);assert.match(r.text(),/original feedback stays/);assert.doesNotMatch(r.text(),/Prefer a spatial|Use a map here|When location/);assert.ok(r.document.querySelector('a')===null);assert.equal(changed.length,1);}finally{r.cleanup();}
});
test('lost withdrawal response resolves only exact discarded or revoked projection, without claiming causation',async()=>{
 for(const state of ['discarded','revoked']){const calls:any[]=[],r=await render(component,props(),{fetch:(async(url:any,init:any)=>{calls.push({url,init});if(init?.method==='POST')throw Error('lost response');return {ok:true,json:async()=>String(url).includes('/changes?')?projection(state):saved()};}) as typeof fetch});
  try{await r.click(r.getByText('Withdraw teaching'));assert.match(r.text(),/teaching is no longer usable/);assert.doesNotMatch(r.text(),/Teaching withdrawn|Prefer a spatial|Use a map here/);assert.equal(calls.filter(call=>call.init?.method==='POST').length,1);assert.match(calls[2].url,new RegExp(`/changes\\?sessionId=${id(10)}`));assert.ok(r.queryByText('Refresh status')===null);}finally{r.cleanup();}
 }
});
test('unknown withdrawal stays refresh-only and never resubmits or exposes refused source prose',async()=>{
 for(const outcome of ['unavailable','retired','absent','wrong_digest','foreign_version']){const calls:any[]=[],value:any=projection(outcome==='wrong_digest'?'discarded':outcome==='retired'?'retired':'unavailable',outcome==='wrong_digest'?'b'.repeat(64):H);if(outcome==='absent')value.records=[];if(outcome==='foreign_version')value.binding.workflowVersionId=id(98);
  const r=await render(component,props(),{fetch:(async(url:any,init:any)=>{calls.push({url,init});if(init?.method==='POST')return {ok:false,json:async()=>({ok:false,reason:'training_review_record_unavailable',sourceMark:{body:'Refused prose'}})};return {ok:true,json:async()=>String(url).includes('/changes?')?value:saved()};}) as typeof fetch});
  try{await r.click(r.getByText('Withdraw teaching'));assert.match(r.text(),/could not confirm withdrawal/);assert.doesNotMatch(r.text(),/Refused prose|Prefer a spatial|Use a map here/);await r.click(r.getByText('Refresh status'));assert.equal(calls.filter(call=>call.init?.method==='POST').length,1);assert.match(r.text(),/could not confirm withdrawal/);assert.ok(r.queryByText('Withdraw teaching')===null);await r.rerender(props({target:null}));await r.rerender(props());assert.match(r.text(),/could not confirm withdrawal/);assert.equal(calls.filter(call=>call.init?.method==='POST').length,1);}finally{r.cleanup();}
 }
});

test('pending withdrawal cannot double-submit or replace another selected lesson',async()=>{
 let release:(value:any)=>void=()=>{};const calls:any[]=[],next={...saved(),recordId:id(2),fields:{...saved().fields,why:'Another selected lesson.'}};
 const r=await render(component,props(),{fetch:(async(url:any,init:any)=>{calls.push({url,init});if(init?.method==='POST')return new Promise(resolve=>release=resolve);return {ok:true,json:async()=>String(url).includes(id(2))?next:saved()};}) as typeof fetch});
 try{const button=r.getByText('Withdraw teaching');await r.act(()=>{(button as HTMLElement).click();(button as HTMLElement).click();});assert.match(r.text(),/Withdrawing this teaching/);assert.equal(calls.filter(call=>call.init?.method==='POST').length,1);assert.doesNotMatch(r.text(),/Prefer a spatial|Use a map here/);
  await r.rerender(props({target:target({recordId:id(2),reviewMark:{acknowledgmentId:id(9)}})}));assert.match(r.text(),/Another selected lesson/);await r.act(()=>release({ok:true,json:async()=>({ok:true,created:true,recordId:id(1),eventId:id(21),action:'discard'})}));assert.match(r.text(),/Another selected lesson/);assert.doesNotMatch(r.text(),/Teaching withdrawn/);
 }finally{r.cleanup();}
});
