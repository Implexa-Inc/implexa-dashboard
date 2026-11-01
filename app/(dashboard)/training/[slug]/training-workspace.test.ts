import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {render} from '../../../../lib/test/render.ts';
const component='../training/[slug]/training-workspace.tsx';
const PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const H=createHash('sha256').update(Buffer.from(PNG.split(',')[1],'base64')).digest('hex');

test('info is closed by default and works by click, hover and Escape without taking an action',async()=>{
 const r=await render(component,{label:'Training details',children:'The explanation.'},{exportName:'TrainingInfo'});
 try{
  const b=r.document.querySelector('button')!,tip=r.document.querySelector('[role="tooltip"]')! as HTMLElement;
  assert.equal(tip.hidden,true);await r.click(b);assert.equal(tip.hidden,false);
  await r.act(()=>b.dispatchEvent(new r.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
  assert.equal(tip.hidden,true);assert.equal(b.getAttribute('aria-expanded'),'false');
  await r.act(()=>b.parentElement!.dispatchEvent(new r.window.MouseEvent('mouseover',{bubbles:true})));assert.equal(tip.hidden,false);
  await r.act(()=>b.parentElement!.dispatchEvent(new r.window.MouseEvent('mouseout',{bubbles:true,relatedTarget:r.document.body})));assert.equal(tip.hidden,true);
 }finally{r.cleanup();}
});

test('saved-frame rows load only in view, bind exact identities, reject late frames and reuse a verified frame after busy',async()=>{
 const calls:any[]=[];let resolveFirst:(v:any)=>void=()=>{};
 const props={token:'local-token',recordId:'first',recordDigest:'a'.repeat(64),frameSha256:H,alt:'Saved example',context:'session:version'};
 const r=await render(component,props,{exportName:'TrainingImage',bridge:{trainingLocal:async(op:string,args:any)=>{calls.push({op,args});return calls.length===1?new Promise(resolve=>{resolveFirst=resolve;}):{ok:true,recordId:args.recordId,recordDigest:'a'.repeat(64),image:PNG};}}});
 try{
  assert.equal(calls.length,0,'no read before a visible row');
  Object.defineProperty(r.window,'crypto',{value:globalThis.crypto,configurable:true});
  (r.window as any).IntersectionObserver=class{callback:any;constructor(callback:any){this.callback=callback;}observe(){this.callback([{isIntersecting:true}]);}disconnect(){}};
  await r.rerender({...props,context:'visible-session:version'});assert.equal(calls.length,1);
  await r.rerender({...props,recordId:'second',context:'visible-session:version'});
  assert.equal(calls.length,1,'the second read waits for the first');
  await r.act(async()=>{resolveFirst({ok:true,recordId:'first',recordDigest:'a'.repeat(64),image:PNG});await new Promise(resolve=>setTimeout(resolve,30));});
  assert.deepEqual(calls.map(c=>c.args.recordId),['first','second']);
  assert.equal(r.document.querySelector('img')?.getAttribute('src'),PNG);
  await r.rerender({...props,recordId:'second',context:'visible-session:version',enabled:false});assert.equal(r.document.querySelector('img'),null);
  await r.rerender({...props,recordId:'second',context:'visible-session:version',enabled:true});assert.equal(calls.length,2);assert.ok(r.document.querySelector('img'));
  await r.rerender({...props,recordId:'third',recordDigest:'b'.repeat(64),context:'other-session:version'});
  await r.act(async()=>{await new Promise(resolve=>setTimeout(resolve,20));});assert.equal(r.document.querySelector('img'),null,'wrong digest cannot populate a new row');
 }finally{r.cleanup();}
});

test('recent results use only the existing preview capability and revoke late capabilities on navigation',async()=>{
 const calls:any[]=[],token='1234567890abcdef1234567890abcdef';let release:(value:any)=>void=()=>{};
 const artifact={id:'artifact',runId:'run',relativePath:'final.mp4',role:'final_output',status:'validated',sha256:H,sizeBytes:100,mtime:null,validatedAt:null};
 const props={slug:'video-agent',runs:[{id:'run',date:'2026-10-31T12:00:00Z',status:'Done',artifact}],onShow:()=>calls.push('show')};
 const r=await render(component,props,{exportName:'TrainingEntry',bridge:{createArtifactPreview:async(...args:any[])=>{calls.push(args);return new Promise(resolve=>{release=resolve;});},revokeArtifactPreview:async(t:string)=>calls.push(['revoke',t])}});
 try{
  assert.deepEqual(calls,[['run','artifact']]);assert.equal(r.document.querySelector('video'),null);
  await r.rerender({...props,runs:[]});
  await r.act(async()=>{release({ok:true,url:`implexa-artifact://preview/${token}`});await new Promise(resolve=>setTimeout(resolve,10));});
  assert.deepEqual(calls.at(-1),['revoke',token]);assert.equal(r.document.querySelector('video'),null);
  assert.equal(r.document.querySelector('a')?.getAttribute('href'),'/workflows/video-agent?source=generated&tab=runs');
 }finally{r.cleanup();}
});
