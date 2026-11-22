import test from 'node:test';
import assert from 'node:assert/strict';
import {render} from '../../../lib/test/render.ts';

test('browser Back and Forward wait for explicit confirmation and retry the exact history entry',async()=>{
 const r=await render('./annotation-leave-guard.tsx',{dirty:false});
 try{
  const navigation=new r.window.EventTarget() as EventTarget&{traverseTo:(key:string)=>void},keys:string[]=[];
  navigation.traverseTo=key=>{keys.push(key);};Object.defineProperty(r.window,'navigation',{value:navigation,configurable:true});
  await r.rerender({dirty:true});
  for(const key of ['previous-entry','forward-entry']){
   const event=Object.assign(new r.window.Event('navigate',{cancelable:true}),{navigationType:'traverse',destination:{key,url:'https://dashboard.test/training/video-craft'}});
   await r.act(()=>navigation.dispatchEvent(event));assert.equal(event.defaultPrevented,true);assert.match(r.text(),/Leave without saving/);
   await r.click(r.getByText('Keep editing'));assert.deepEqual(keys,[]);
  }
  const event=Object.assign(new r.window.Event('navigate',{cancelable:true}),{navigationType:'traverse',destination:{key:'exact-entry',url:'https://dashboard.test/training/video-craft'}});
  await r.act(()=>navigation.dispatchEvent(event));await r.click(r.document.querySelector('button.btn-danger')!);assert.deepEqual(keys,['exact-entry']);
  const approved=Object.assign(new r.window.Event('navigate',{cancelable:true}),{navigationType:'traverse',destination:{key:'exact-entry',url:'https://dashboard.test/training/video-craft'}});
  await r.act(()=>navigation.dispatchEvent(approved));assert.equal(approved.defaultPrevented,false);
  await r.rerender({dirty:false});const clean=Object.assign(new r.window.Event('navigate',{cancelable:true}),{navigationType:'traverse',destination:{key:'clean-entry',url:'https://dashboard.test/training/video-craft'}});
  await r.act(()=>navigation.dispatchEvent(clean));assert.equal(clean.defaultPrevented,false);
 }finally{r.cleanup();}
});

test('in-app links and browser close protect unsaved annotation; Keep editing does not navigate',async()=>{
 const r=await render('./annotation-leave-guard.tsx',{dirty:true});
 try{
  const link=r.document.createElement('a');link.href='/training/video-craft';link.textContent='Back to Train';r.document.body.append(link);
  await r.click(link);assert.equal(r.calls.push.length,0);await r.click(r.getByText('Keep editing'));assert.equal(r.calls.push.length,0);
  const close=new r.window.Event('beforeunload',{cancelable:true});r.window.dispatchEvent(close);assert.equal(close.defaultPrevented,true);
  await r.click(link);await r.click(r.document.querySelector('button.btn-danger')!);assert.deepEqual(r.calls.push,['/training/video-craft']);
 }finally{r.cleanup();}
});

test('discard callback runs only on explicit Leave, before navigating',async()=>{
 let discarded=0;const r=await render('./annotation-leave-guard.tsx',{dirty:true,onDiscard:()=>{assert.equal(r.calls.push.length,0);discarded++;}});
 try{
  const link=r.document.createElement('a');link.href='/training/video-craft';r.document.body.append(link);
  await r.click(link);await r.click(r.getByText('Keep editing'));assert.equal(discarded,0);
  await r.click(link);await r.click(r.document.querySelector('button.btn-danger')!);assert.equal(discarded,1);assert.deepEqual(r.calls.push,['/training/video-craft']);
 }finally{r.cleanup();}
});
