import test from 'node:test';
import assert from 'node:assert/strict';
import {render} from '../../../lib/test/render.ts';
const row=(n:number)=>({id:`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,skill_slug:`video-${n}`,status:'completed',outputName:`result-${n}.mp4`,ran_at:'2026-11-01T12:00:00.123456Z'});
const flush=async(r:any)=>r.act(()=>new Promise(resolve=>setTimeout(resolve,20)));
test('recent results show three real permalinks, link to Delivered, and refresh only on a completion signal',async()=>{
 const paths:string[]=[];let fail=false;
 const r=await render('completed-run-results.tsx',{}, {fetch:(async(path:any)=>{
  paths.push(String(path));return fail?{ok:false}:{ok:true,json:async()=>({rows:[row(1),row(2),row(3),row(4)],nextCursor:{ranAt:row(4).ran_at,id:row(4).id}})};
 }) as any});
 try{
  await flush(r);assert.equal(paths.length,1);
  assert.equal(r.document.querySelectorAll('.work-item-row').length,3);
  assert.match(r.document.querySelector('.work-row-sub')?.textContent||'',/result-1.mp4/);
  assert.ok(r.document.querySelector(`a.btn-outline[href="/runs/${row(1).id}"]`));
  assert.ok(r.document.querySelector(`a[href="/runs/${row(1).id}"]`));
  assert.equal(r.document.querySelector('a[href="/work?view=delivered"]')?.textContent,'See all →');
  assert.doesNotMatch(r.text(),/Video 4|More ↓/);
  await r.rerender({revision:0});await flush(r);assert.equal(paths.length,1);
  fail=true;await r.rerender({revision:1});await flush(r);
  assert.equal(paths.length,2);assert.match(r.text(),/Couldn’t load results/);assert.match(r.text(),/Video 1/);
  fail=false;await r.click(r.getByText('Try again'));await flush(r);assert.equal(paths.length,3);
  assert.doesNotMatch(r.text(),/Couldn’t load results/);
 }finally{r.cleanup();}
});
test('initial history failure does not report an empty result set',async()=>{
 const r=await render('completed-run-results.tsx',{}, {fetch:(async()=>({ok:false})) as any});
 try{await flush(r);assert.match(r.text(),/Couldn’t load results/);assert.doesNotMatch(r.text(),/No results to display/);}finally{r.cleanup();}
});
