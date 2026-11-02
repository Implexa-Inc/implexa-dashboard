import test from 'node:test';
import assert from 'node:assert/strict';
import {render} from '../../../lib/test/render.ts';
const row=(n:number)=>({id:`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,skill_slug:`video-${n}`,status:'completed',ran_at:'2026-11-01T12:00:00.123456Z'});
const flush=async(r:any)=>r.act(()=>new Promise(resolve=>setTimeout(resolve,20)));
test('results fetch on mount, More fetches the next page; failure preserves rows and retries that page',async()=>{
 const paths:string[]=[];let fail=true;
 const cursor={ranAt:row(1).ran_at,id:row(1).id};
 const r=await render('completed-run-results.tsx',{}, {fetch:(async(path:any)=>{
  paths.push(String(path));const next=String(path).includes('?');
  if(next&&fail)return {ok:false};
  return {ok:true,json:async()=>next?{rows:[row(2)],nextCursor:null}:{rows:[row(1)],nextCursor:cursor}};
 }) as any});
 try {
  await flush(r);assert.equal(paths.length,1);assert.match(r.text(),/Video 1/);
  await r.click(r.getByText('More ↓'));await flush(r);assert.equal(paths.length,2);
  assert.match(paths[1],/before=2026-11-01T12%3A00%3A00.123456Z/);
  assert.match(r.text(),/Couldn’t load results/);assert.match(r.text(),/Video 1/);
  fail=false;await r.click(r.getByText('Try again'));await flush(r);
  assert.equal(paths[2],paths[1]);assert.match(r.text(),/Video 2/);
  assert.equal(r.document.querySelectorAll('a').length,5); // history and two links per result
  assert.ok(!r.text().includes('More ↓'));
 }finally{r.cleanup();}
});
test('initial history failure does not report an empty result set',async()=>{
 const r=await render('completed-run-results.tsx',{}, {fetch:(async()=>({ok:false})) as any});
 try{await flush(r);assert.match(r.text(),/Couldn’t load results/);assert.ok(!r.text().includes('No completed'));}finally{r.cleanup();}
});
