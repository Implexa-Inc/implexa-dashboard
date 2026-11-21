import test from 'node:test';
import assert from 'node:assert/strict';
import {render} from '../lib/test/render.ts';
const steps=[{index:1,label:'Read footage',status:'done'},{index:2,label:'Choose treatment',status:'running'},{index:3,label:'Build the video',status:'pending'}];
test('the progress dial uses real steps and the recorded run estimate, without invented step timings',async()=>{
 const r=await render('run-steps-list.tsx',{steps,progress:{state:'running',note:'Comparing the scene options',elapsedMs:192000,expectedMs:1800000}});
 try{assert.ok(r.document.querySelector('svg[aria-label="1 of 3 steps complete"]'));assert.match(r.text(),/Step 2 of 3/);assert.match(r.text(),/Choose treatment/);assert.match(r.text(),/About 27 min left/);assert.match(r.text(),/3:12/);assert.equal(r.document.querySelectorAll('.run-progress-steps li').length,3);assert.equal(r.document.querySelectorAll('.run-progress-orbit').length,1);assert.doesNotMatch(r.text(),/usually take|1 min|8 min|credits|charged/);assert.equal(r.calls.backend.length,0);}finally{r.cleanup();}
});
for(const state of ['waiting','stalled','failed'])test(`${state} uses its honest paused/stopped state and never an active orbit`,async()=>{
 const r=await render('run-steps-list.tsx',{steps,progress:{state,note:'Read the run details'}});
 try{assert.match(r.text(),state==='failed'?/Stopped at step 2 of 3/:state==='stalled'?/Step 2 of 3 · interrupted/:/Step 2 of 3 · paused/);assert.equal(r.document.querySelector('.run-progress-orbit'),null);assert.equal(r.document.querySelector('.run-progress-steps li:nth-child(2) small')?.textContent,state==='failed'?'Failed':state==='stalled'?'Interrupted':'Paused');assert.doesNotMatch(r.text(),/min left|usually take/);}finally{r.cleanup();}
});
test('unknown steps and missing estimate do not become invented step counts or a countdown',async()=>{
 const r=await render('run-steps-list.tsx',{steps:[],progress:{state:'queued'}});
 try{assert.match(r.text(),/Waiting to start/);assert.ok(r.document.querySelector('svg[aria-label="No steps reported yet"]'));assert.doesNotMatch(r.text(),/of 6|0 of 0|min left|elapsed/);assert.equal(r.document.querySelector('ol'),null);}finally{r.cleanup();}
});
test('compact Production checklists retain every supplied row and no full progress panel',async()=>{
 const r=await render('run-steps-list.tsx',{steps,compact:true,heading:null});
 try{assert.equal(r.document.querySelectorAll('li').length,3);assert.match(r.text(),/Read footage/);assert.equal(r.document.querySelector('.run-progress-panel'),null);}finally{r.cleanup();}
});
test('the existing poller advances queued to running and a held state, with no additional reader or mutation',async()=>{
 let read=0;let nextPoll:(()=>void)|undefined;
 const r=await render('run-step-checklist.tsx',{runId:'preview-run',initialSteps:[],initialRunState:'queued',presentation:'queued'}, {backend:()=>({item:++read===1?{run_state:'running',review_status:'none',steps_state:steps,progress:{current:{note:'Choosing visual treatment'}}}:{run_state:'running',review_status:'needs_input',steps_state:steps,progress:{current:{note:'Please approve the next step'}}}})});
 const nativeTimeout=r.window.setTimeout.bind(r.window);
 r.window.setTimeout=((fn:any,ms?:number,...args:any[])=>{if(ms===6000){nextPoll=fn;return 6000;}return nativeTimeout(fn,ms,...args);}) as any;
 try{await r.act(()=>new Promise(resolve=>setTimeout(resolve,1100)));assert.equal(r.calls.backend.length,1);assert.match(r.text(),/Choosing visual treatment/);assert.ok(r.document.querySelector('.is-running.run-progress-panel'));assert.ok(nextPoll);await r.act(async()=>{await nextPoll!();});assert.equal(r.calls.backend.length,2);assert.ok(r.document.querySelector('.is-waiting.run-progress-panel'));assert.match(r.text(),/Please approve the next step/);assert.equal(r.document.querySelector('.run-progress-orbit'),null);assert.ok(r.calls.backend.every(call=>call.path==='/api/v2/scheduled-skills/runs/preview-run'&&!(call.init as any)?.method));}finally{r.cleanup();}
});

test('progress files show checked artifacts immediately while retaining exact existing file actions',async()=>{
 const calls:string[]=[];
 const r=await render('verified-artifacts.tsx',{progress:true,runId:'preview-run',artifacts:[{relativePath:'outputs/rough-cut.mp4',validatedPath:'/verified/work/outputs/rough-cut.mp4',role:'final_output',sizeBytes:2048}]},{bridge:{openPath:async(path:string)=>{calls.push(path);return{ok:true};}}});
 try{assert.match(r.text(),/Files so far/);assert.ok(r.document.querySelector('ul'));assert.equal(r.document.querySelector('details')?.open,false);assert.match(r.text(),/rough-cut.mp4/);await r.click(r.getByText('Open'));assert.deepEqual(calls,['/verified/work/outputs/rough-cut.mp4']);assert.equal(r.calls.backend.length,0);}finally{r.cleanup();}
});
