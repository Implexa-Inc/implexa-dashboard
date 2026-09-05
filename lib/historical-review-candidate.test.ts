import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHistoricalCandidates } from './historical-review-candidate.ts';
import { parseReviewPacketResponse, PACKET_SOURCE_KEYS } from './review.ts';
const artifactId='11111111-1111-4111-8111-111111111111', recoveryId='22222222-2222-4222-8222-222222222222';
const runId='33333333-3333-4333-8333-333333333333';
const candidate={scope:'historical_partial_candidate',recoveryId,artifactId,implementedCount:1,deferredCount:6,technicalQaStatus:'pass',managerProof:false,issueAnchorTransfer:'not_transferred'};
const artifacts=[{id:artifactId,runId,role:'other',status:'validated',relativePath:'private/candidate.mp4',sha256:'a'.repeat(64),sizeBytes:2296329913,mtime:null,validatedAt:'2026-09-05T00:00:00Z'}];
test('exact public projection retains one implemented six deferred without success promotion',()=>{
  assert.deepEqual(parseHistoricalCandidates([candidate],'ready',artifacts),[candidate]);
});
test('old backend and explicit unavailable remain distinct safe inputs',()=>{
  assert.deepEqual(parseHistoricalCandidates(undefined,undefined,artifacts),[]);
  assert.deepEqual(parseHistoricalCandidates([],'unavailable',artifacts),[]);
  assert.equal(parseHistoricalCandidates([candidate],'unavailable',artifacts),null);
  assert.equal(parseHistoricalCandidates([candidate],undefined,artifacts),null);
});
for(const change of [
  {managerProof:true},{issueAnchorTransfer:'transferred'},{deferredCount:0},{implementedCount:0},{implementedCount:1.5},
  {deferredCount:100},{technicalQaStatus:'pending'},{artifactId:recoveryId},{scope:'completed'},{privateBody:'secret'},
]) test(`reject unsupported provenance ${JSON.stringify(change)}`,()=>{
  assert.equal(parseHistoricalCandidates([{...candidate,...change}],'ready',artifacts),null);
});
test('unvalidated and final-output rows cannot masquerade as review-only candidate',()=>{
  assert.equal(parseHistoricalCandidates([candidate],'ready',[{...artifacts[0],status:'declared'}]),null);
  assert.equal(parseHistoricalCandidates([candidate],'ready',[{...artifacts[0],role:'final_output'}]),null);
  assert.equal(parseHistoricalCandidates([candidate,candidate],'ready',artifacts),null);
});
test('full packet consumer accepts the producer projection and refuses forged Manager proof',()=>{
  const packet={ok:true,run:{id:runId,slug:null,runState:'completed',status:'partial',reviewStatus:'needs_input',holdKind:'needs_input',startedAt:null},
    lineage:{rootRunId:runId,versions:[{runId,label:'Original',runState:'completed',startedAt:null}]},artifacts,
    reviewArtifacts:[],issues:[],session:null,verification:{receipts:[]},judgment:null,production:null,
    sources:{...Object.fromEntries(PACKET_SOURCE_KEYS.map(k=>[k,'ready'])),historical_candidates:'ready'},historicalCandidates:[candidate]};
  const parsed=parseReviewPacketResponse(packet,runId);
  assert.ok(parsed); assert.deepEqual(parsed.historicalCandidates,[candidate]);
  assert.equal(parsed.run?.status,'partial');
  assert.equal(parseReviewPacketResponse({...packet,historicalCandidates:[{...candidate,managerProof:true}]},runId),null);
});
