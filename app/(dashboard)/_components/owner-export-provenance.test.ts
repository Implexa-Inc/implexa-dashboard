import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { projectRunArtifacts, withOwnerExportProvenance, resultSurface } from '../../../lib/run-artifact-projection.ts';
import { parseReviewPacketResponse } from '../../../lib/review.ts';
import { render } from '../../../lib/test/render.ts';

// Actual SQL writer + SELECT output from the existing full-schema/Desktop
// preparation producer, not an approximated successful API response.
const fixture=JSON.parse(readFileSync(new URL('../../../lib/test/fixtures/owner-export-postgres.json',import.meta.url),'utf8'));

for(const finished of [false,true])test(`owner export retains truthful provenance and exact Open path (finished=${finished})`,async()=>{
  const projected=projectRunArtifacts(fixture.artifacts);
  const artifacts=withOwnerExportProvenance(projected.verified,fixture.run.run_close_reason);
  const opened:string[]=[];
  const view=await render('verified-artifacts.tsx',{artifacts,finished},{bridge:{openPath:async(p:string)=>{opened.push(p);return{ok:true};}}});
  try{
    assert.match(view.text(),/Verified by an owner-authorized operator/);
    assert.match(view.text(),/interrupted execution remains ungraded/);
    assert.doesNotMatch(view.text(),/Checked on this Mac by Tukido/);
    assert.equal(artifacts[0].role,'other','display provenance grants no final-output authority');
    const files=view.queryByText(/View files \(/);if(files)await view.click(files);
    await view.click(view.getByText('Open'));
    assert.deepEqual(opened,[fixture.artifacts[0].validated_path]);
  }finally{view.cleanup();}
});

test('ordinary artifacts retain the native verification wording',async()=>{
  const artifacts=withOwnerExportProvenance(projectRunArtifacts(fixture.artifacts).verified,null);
  const view=await render('verified-artifacts.tsx',{artifacts});
  try{
    assert.match(view.text(),/Checked on this Mac by Tukido/);
    assert.doesNotMatch(view.text(),/owner-authorized operator/);
    assert.equal(artifacts[0].provenance,undefined);
  }finally{view.cleanup();}
});


test('an unavailable provenance read never falls back to native verification copy',async()=>{
  const artifacts=withOwnerExportProvenance(projectRunArtifacts(fixture.artifacts).verified,null,false);
  const view=await render('verified-artifacts.tsx',{artifacts});
  try{
    assert.match(view.text(),/File provenance could not be checked/);
    assert.doesNotMatch(view.text(),/Checked on this Mac|Verified by an owner/);
  }finally{view.cleanup();}
});


test('a real live review packet for owner salvage renders only the private export branch',async()=>{
  const packet=parseReviewPacketResponse(fixture.reviewPacket,fixture.runRecord.id);
  assert.ok(packet?.live,'real producer packet is live despite the absence of an accepted Review session');
  assert.equal(packet.session,null);
  const surface=resultSurface({runId:fixture.runRecord.id,completed:fixture.runRecord.run_state==='completed',
    closeReason:fixture.runRecord.run_close_reason,provenanceAvailable:true,reviewLive:packet.live,reviewRunId:packet.run?.id});
  assert.equal(surface,'owner_export');
  const artifacts=withOwnerExportProvenance(projectRunArtifacts(fixture.artifacts).verified,fixture.runRecord.run_close_reason);
  const opened:string[]=[];
  const view=await render('verified-artifacts.tsx',{artifacts,runId:fixture.runRecord.id,children:fixture.runRecord.output_markdown},
    {exportName:'OwnerRecoveredExport',bridge:{openPath:async(p:string)=>{opened.push(p);return{ok:true};}}});
  try{
    assert.match(view.text(),/Recovery record/);
    assert.doesNotMatch(view.text(),/Ready for your review|Ask for changes|Request changes|Accept result|Agent’s notes/);
    assert.equal(Array.from(view.document.querySelectorAll('button,a')).some(node=>/share|accept|annotate|change/i.test(node.textContent||'')),false);
    const files=view.queryByText(/View files \(/);if(files)await view.click(files);
    await view.click(view.getByText('Open'));assert.deepEqual(opened,[fixture.artifacts[0].validated_path]);
  }finally{view.cleanup();}
  assert.equal(resultSurface({runId:fixture.runRecord.id,completed:true,closeReason:null,provenanceAvailable:false,
    reviewLive:packet.live,reviewRunId:packet.run?.id}),'files','an unavailable reason cannot activate generic Review');
});
