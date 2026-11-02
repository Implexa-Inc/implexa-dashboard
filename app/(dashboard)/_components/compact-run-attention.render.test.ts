import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {render} from '../../../lib/test/render.ts';
const attention={items:[],partial:false,truncated:false,live:true,unavailableSources:[]};
test('compact alerts and parents expose failed reads without a count or all-clear',async()=>{
 for(const [exportName,props,copy]of [
  ['CompactRunAlerts',{attention:{...attention,partial:true,live:false}},/alerts couldn’t be checked/],
  ['CompactActiveProductions',{load:{status:'unavailable',reason:'offline'}},/active work couldn’t be checked/],
 ] as const){
  const r=await render('compact-run-attention.tsx',props,{exportName});
  try{assert.match(r.text(),copy);assert.doesNotMatch(r.text(),/0 runs|No active|Nothing needs/);assert.equal(r.document.querySelector('a')?.getAttribute('href'),'/work?view=needs');}finally{r.cleanup();}
 }
 const page=readFileSync(new URL('../work/page.tsx',import.meta.url),'utf8');
 const pilot=page.slice(page.indexOf("if (pilot &&"),page.indexOf('// The review queue'));
 assert.match(pilot,/<CompactRunAttention\/>/);assert.match(pilot,/<CompactProductionList jwt=/);
 assert.match(pilot,/<LiveRunActivity compact\/>/);assert.match(pilot,/prefetch=\{false\}/);
 assert.doesNotMatch(pilot,/getReviewQueue\(|readMyWorkflows\(|selectRuns\(/);
});
test('partial run alerts are a lower bound and capped parents remain explicitly incomplete',async()=>{
 const r=await render('compact-run-attention.tsx',{attention:{...attention,truncated:true,items:[{runId:'a',attentionId:'x'},{runId:'a',attentionId:'y'}]}},{exportName:'CompactRunAlerts'});
 try{assert.match(r.text(),/At least 1 run needs you/);}finally{r.cleanup();}
 const p=await render('compact-run-attention.tsx',{load:{status:'ready',productions:[],truncated:true}},{exportName:'CompactActiveProductions'});
 try{assert.match(p.text(),/more may need you/);assert.doesNotMatch(p.text(),/No active|Nothing needs/);}finally{p.cleanup();}
});
