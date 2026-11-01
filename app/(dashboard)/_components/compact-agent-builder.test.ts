import test from 'node:test';
import assert from 'node:assert/strict';
import {render} from '../../../lib/test/render.ts';

test('Rent opens the existing builder in a compact input without starting work on mount; ordinary builder stays a one-line input',async()=>{
 const r=await render('talk-to-implexa.tsx',{hasAgents:true,compact:true,connected:true});
 try{
  assert.ok(r.document.querySelector('textarea[aria-label="Describe your agent"]'));
  assert.equal(r.document.querySelector('input#talk'),null);
  assert.equal((r.getByText('Build it') as HTMLButtonElement).disabled,true);
  assert.equal(r.calls.backend.length,0);assert.equal(r.calls.push.length,0);
 }finally{r.cleanup();}
 const o=await render('talk-to-implexa.tsx',{hasAgents:true});
 try{assert.ok(o.document.querySelector('input#talk'));assert.equal(o.document.querySelector('textarea#talk'),null);}finally{o.cleanup();}
});
