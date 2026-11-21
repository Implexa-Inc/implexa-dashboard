import test from 'node:test';import assert from 'node:assert/strict';import {render} from '../../../lib/test/render.ts';
import generated from '../../../test-fixtures/generated/agent-marketplace-slice1.json' with {type:'json'};
const video={slug:'beta-video-studio',sampleOnly:true,name:'The Video Studio',category:'Video',input:'A raw recorded video',outcome:'A finished YouTube video',tasteVariants:3,runCount:140,deliveryRate:89,supportedEngines:['Claude','Codex'],averageGrade:86,monthlyUsd:8,trial:'First run free',owner:{handle:'Sample trainer',agentCount:3,averageGrade:83},artwork:'video'};
const actual={id:'12000000-0000-4000-8000-000000000001',slug:'trained-studio',versionId:'12000000-0000-4000-8000-000000000002',revision:5,name:'Real trained studio',studioName:'Actual studio',category:'Video',input:'A raw video',output:'An edited video',servicePriceCents:5000,pricePeriod:'per_run',engines:['claude','codex'],sampleCount:1,samplePlayback:'not_hosted',billing:'not_enabled',funding:'not_activated',tools:[]};
test('sample listings retain a safe preview without fabricated prices, performance, trainer ratings or acquisition',async()=>{
 const r=await render('marketplace-sample-gallery.tsx',{listings:[video]});
 try{assert.match(r.text(),/Sample listing/);assert.doesNotMatch(r.text(),/89%|140|86\/100|\$50|unlimited|Certified|Best match/);await r.click(r.getByText('Preview sample'));assert.match(r.text(),/illustrative, not available to run/);assert.equal(r.calls.backend.length,0);await r.click(r.getByText('Done'));await r.click(r.getByText('List'));assert.equal(r.document.querySelector('[data-view]')?.getAttribute('data-view'),'list');}finally{r.cleanup();}
});
test('both Agents tabs always show; each tab has one shared Build action',async()=>{
 for(const selected of ['mine','find']){const r=await render('agent-home-frame.tsx',{selected,count:'58',children:'Existing content'});try{assert.equal(r.document.querySelectorAll('nav a').length,2);assert.equal(r.document.querySelector('a[aria-current="page"]')?.textContent?.trim(),selected==='mine'?'Your agents 58':'Find a trained agent');assert.equal(r.document.querySelectorAll('a[href="/create"]').length,1);assert.equal(r.document.querySelector('details'),null);}finally{r.cleanup();}}
});
test('real approved cards replace duplicate samples and open existing permission-aware setup directly',async()=>{
 const r=await render('marketplace-sample-gallery.tsx',{listings:[video],approved:{status:'ready',listings:[actual]},discovery:{status:'ready',agents:[{...generated.available,slug:actual.slug}]}});
 try{assert.equal(r.document.querySelectorAll('article').length,1);assert.match(r.text(),/Real trained studio|Actual studio/);assert.match(r.text(),/planned price/);assert.doesNotMatch(r.text(),/The Video Studio|89%|Try for free/);assert.equal(r.getByText('View agent').getAttribute('href'),'/workflows/trained-studio?source=generated');assert.equal(r.calls.backend.length,0);assert.equal(r.document.querySelector('[role="dialog"]'),null);}finally{r.cleanup();}
});
test('unavailable catalogs stay unavailable rather than asserting an empty marketplace',async()=>{
 const r=await render('marketplace-sample-gallery.tsx',{listings:[video],approved:{status:'unavailable',listings:[]},discovery:{status:'unavailable',agents:[],reason:'timeout'}});
 try{assert.match(r.text(),/Some trained agents couldn’t be loaded/);assert.doesNotMatch(r.text(),/No results yet|The Video Studio/);assert.equal(r.document.querySelector('a[href*="/workflows/"]'),null);}finally{r.cleanup();}
});
test('one search filters authoritative admitted agents and approved listings without acquiring either',async()=>{
 const r=await render('marketplace-sample-gallery.tsx',{listings:[],approved:{status:'ready',listings:[actual]},discovery:{status:'ready',agents:[{...generated.available,id:'another',name:'Proof Reader',job:'Review a draft'}]}});
 try{const search=r.document.querySelector('input')!;await r.act(()=>{Object.getOwnPropertyDescriptor(r.window.HTMLInputElement.prototype,'value')!.set!.call(search,'Proof Reader');search.dispatchEvent(new r.window.Event('input',{bubbles:true}));});assert.match(r.text(),/Proof Reader/);assert.doesNotMatch(r.text(),/Real trained studio/);assert.equal(r.document.querySelector('article a.btn-outline')?.getAttribute('href'),`/workflows/${generated.available.slug}`);assert.equal(r.calls.backend.length,0);}finally{r.cleanup();}
});

test('empty Find states use plain list-state wording, and an empty search does not promote a build card',async()=>{
 const r=await render('marketplace-sample-gallery.tsx',{listings:[]});
 try{assert.match(r.text(),/No results/);assert.match(r.text(),/No trained agents are listed yet/);assert.equal(r.document.querySelector('.marketplace-build-card'),null);}finally{r.cleanup();}
});
