import test from 'node:test';
import assert from 'node:assert/strict';
import {render} from '../../../lib/test/render.ts';

test('a modal traps focus, retains typing focus and restores its opener',async()=>{
 let closed=0;
 const props={open:false,title:'Before it runs',children:'Choose the inputs for this run.',onClose:()=>closed++};
 const page=await render('modal.tsx',props);
 try{
  const opener=page.document.createElement('button');opener.textContent='Run agent';page.document.body.append(opener);opener.focus();
  await page.rerender({...props,open:true});
  const dialog=page.document.querySelector('[role="dialog"]')!;
  const close=dialog.querySelector('button[aria-label="Close"]')!;
  assert.equal(page.document.activeElement,close);
  const input=page.document.createElement('input');dialog.querySelector('[tabindex="-1"]')!.append(input);input.focus();
  await page.rerender({...props,open:true,onClose:()=>closed++});
  assert.equal(page.document.activeElement,input,'a new callback on rerender must not steal typing focus');
  await page.act(()=>page.window.dispatchEvent(new page.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
  assert.equal(closed,1);
  await page.rerender(props);assert.equal(page.document.activeElement,opener);
  assert.equal(page.document.querySelector('[role="dialog"]'),null);
 }finally{page.cleanup();}
});
