import test from 'node:test';import assert from 'node:assert/strict';import {render} from '../../../lib/test/render.ts';
const video={slug:'beta-video-studio',sampleOnly:true,name:'The Video Studio',category:'YouTube educational video',input:'A raw recorded video',outcome:'A production-level YouTube video, ready to post — including 10+ minute videos.',tasteVariants:3,runCount:140,deliveryRate:89,supportedEngines:['Claude','Codex'],averageGrade:86,monthlyUsd:8,trial:'First run free',owner:{handle:'Juju8080',agentCount:3,averageGrade:83},artwork:'video'};
const marketing={...video,slug:'beta-performance-marketer',name:'The Performance Marketer',category:'Performance marketing',input:'Your website, product links and daily or monthly budget',outcome:'Continuously runs your campaigns, monitors results and improves them as a top marketer would.',tasteVariants:2,runCount:4540,deliveryRate:84,averageGrade:82,monthlyUsd:5,trial:'First day free',owner:{handle:'Masterofuniverse',agentCount:1,averageGrade:82},artwork:'marketing'};
test('the gallery shows two labelled sample offers; rental, details and owner previews never acquire, charge, run or navigate',async()=>{
 const r=await render('marketplace-sample-gallery.tsx',{listings:[video,marketing]});
 try{
  assert.equal(r.document.querySelectorAll('article').length,2);assert.equal(Array.from(r.document.querySelectorAll('p')).filter(p=>p.textContent==='Sample performance').length,2);assert.match(r.text(),/89% delivered/);assert.match(r.text(),/4,540/);assert.match(r.text(),/86\/100/);assert.match(r.text(),/Needs your Claude or ChatGPT subscription/);
  await r.click(r.getByText(/Try for free\. \$50\/run/));assert.ok(r.document.querySelector('[role="dialog"]'));assert.match(r.text(),/rental checkout are coming next/);assert.equal(r.calls.backend.length,0);assert.equal(r.calls.push.length,0);assert.equal(r.document.querySelectorAll('form').length,0);
  await r.click(r.getByText('Done'));await r.click(Array.from(r.document.querySelectorAll('button')).find(b=>b.textContent?.startsWith('Juju8080'))!);assert.match(r.text(),/Illustrative trainer profile/);await r.click(r.getByText('Done'));
  await r.click(r.document.querySelector('button[aria-label="View The Video Studio"]')!);assert.match(r.text(),/Beta sample/);await r.click(r.getByText('Done'));
  await r.click(r.getByText('YouTube & video'));assert.equal(r.document.querySelectorAll('article').length,1);
  await r.click(r.getByText('☷ List'));assert.equal(r.document.querySelector('[data-view]')?.getAttribute('data-view'),'list');
  await r.click(r.getByText('All'));assert.equal(r.document.querySelectorAll('article').length,2);assert.equal(r.calls.backend.length,0);
 }finally{r.cleanup();}
});
test('the agent frame no longer repeats sidebar destinations as page tabs',async()=>{
 const r=await render('agent-home-frame.tsx',{children:'Existing agents'});
 try{assert.equal(r.document.querySelector('nav'),null);assert.match(r.text(),/Existing agents/);}finally{r.cleanup();}
});

test('the sketch layout starts with a collapsed Build row above the full-width rental content',async()=>{
 const r=await render('agent-home-frame.tsx',{build:'Existing builder',status:'Build status',children:'Rental gallery'},{exportName:'RentBuildHome'});
 try{
  assert.equal(r.document.querySelector('h1')?.textContent,'Rent/Build');
  const disclosure=r.document.querySelector('details')!;
  assert.equal(disclosure.hasAttribute('open'),false);
  assert.match(r.text(),/Build status/);assert.doesNotMatch(disclosure.textContent||'',/Build status/);
  assert.match(disclosure.querySelector('summary')?.textContent||'',/Build an agent/);
  assert.ok(r.text().indexOf('Build an agent')<r.text().indexOf('Rental gallery'));
  await r.click(disclosure.querySelector('summary')!);assert.equal(disclosure.hasAttribute('open'),true);
  assert.match(disclosure.textContent||'',/Existing builder/);
  assert.equal(r.calls.backend.length,0);assert.equal(r.calls.push.length,0);
 }finally{r.cleanup();}
});

test('real approved card replaces only the fictional video and uses normal setup without billing or invented metrics',async()=>{
 const actual={id:'12000000-0000-4000-8000-000000000001',slug:'trained-studio',versionId:'12000000-0000-4000-8000-000000000002',revision:5,name:'Real trained studio',studioName:'Actual studio',category:'Video',input:'A raw video',output:'An edited video',servicePriceCents:5000,pricePeriod:'per_run',engines:['claude','codex'],sampleCount:1,samplePlayback:'not_hosted',billing:'not_enabled',funding:'not_activated',tools:[{id:'runway_media',mode:'included',maximumChargeCents:120,validUntil:'2099-01-01'}]};
 const r=await render('marketplace-sample-gallery.tsx',{listings:[video,marketing],approved:{status:'ready',listings:[actual]}});
 try{
  assert.equal(r.document.querySelectorAll('article').length,2);assert.doesNotMatch(r.text(),/The Video Studio/);assert.match(r.text(),/Real trained studio/);assert.match(r.text(),/planned service price/);
  const real=r.document.querySelector('article')!;assert.doesNotMatch(real.textContent||'',/140|89%|86\/100|Juju8080|Try for free/);
  await r.click(r.getByText('View agent'));assert.match(r.text(),/Playback is not hosted yet/);assert.match(r.text(),/funding setup required/);
  assert.equal(r.document.querySelector('a')?.getAttribute('href'),'/workflows/trained-studio?source=generated');assert.equal(r.calls.backend.length,0);
 }finally{r.cleanup();}
});
test('approved-read failure remains visible and never restores the fictional video',async()=>{
 const r=await render('marketplace-sample-gallery.tsx',{listings:[video,marketing],approved:{status:'unavailable',listings:[]}});
 try{assert.match(r.text(),/Approved listings could not be loaded/);assert.doesNotMatch(r.text(),/The Video Studio/);assert.match(r.text(),/The Performance Marketer/);}finally{r.cleanup();}
});
