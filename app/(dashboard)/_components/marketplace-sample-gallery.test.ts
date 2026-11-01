import test from 'node:test';import assert from 'node:assert/strict';import {render} from '../../../lib/test/render.ts';
const video={slug:'beta-video-studio',sampleOnly:true,name:'The Video Studio',category:'YouTube educational video',input:'A raw recorded video',outcome:'A production-level YouTube video, ready to post — including 10+ minute videos.',tasteVariants:3,runCount:140,deliveryRate:89,supportedEngines:['Claude','Codex'],averageGrade:86,monthlyUsd:8,trial:'First run free',owner:{handle:'Juju8080',agentCount:3,averageGrade:83},artwork:'video'};
const marketing={...video,slug:'beta-performance-marketer',name:'The Performance Marketer',category:'Performance marketing',input:'Your website, product links and daily or monthly budget',outcome:'Continuously runs your campaigns, monitors results and improves them as a top marketer would.',tasteVariants:2,runCount:4540,deliveryRate:84,averageGrade:82,monthlyUsd:5,trial:'First day free',owner:{handle:'Masterofuniverse',agentCount:1,averageGrade:82},artwork:'marketing'};
test('the gallery shows two labelled sample offers; rental, details and owner previews never acquire, charge, run or navigate',async()=>{
 const r=await render('marketplace-sample-gallery.tsx',{listings:[video,marketing]});
 try{
  assert.equal(r.document.querySelectorAll('article').length,2);assert.equal(Array.from(r.document.querySelectorAll('p')).filter(p=>p.textContent==='Sample performance').length,2);assert.match(r.text(),/89% delivered/);assert.match(r.text(),/4,540/);assert.match(r.text(),/86\/100/);assert.match(r.text(),/Needs your Claude or ChatGPT subscription/);
  await r.click(r.getByText(/Rent for \$8\/mo/));assert.ok(r.document.querySelector('[role="dialog"]'));assert.match(r.text(),/rental checkout are coming next/);assert.equal(r.calls.backend.length,0);assert.equal(r.calls.push.length,0);assert.equal(r.document.querySelectorAll('form').length,0);
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
