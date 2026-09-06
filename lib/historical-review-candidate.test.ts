import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHistoricalCandidates } from './historical-review-candidate.ts';
import { parseReviewPacketResponse, PACKET_SOURCE_KEYS } from './review.ts';
import { resolveInitialArtifact } from './review-room-state.ts';
const artifactId='11111111-1111-4111-8111-111111111111', recoveryId='22222222-2222-4222-8222-222222222222';
const runId='33333333-3333-4333-8333-333333333333';
const candidate={scope:'historical_partial_candidate',recoveryId,artifactId,implementedCount:1,deferredCount:6,technicalQaStatus:'pass',managerProof:false,issueAnchorTransfer:'not_transferred'};
const unverified={scope:'historical_unverified_candidate',recoveryId,artifactId,implementedCount:0,deferredCount:0,unresolvedCount:5,technicalQaStatus:'pass',managerProof:false,issueAnchorTransfer:'not_transferred'};
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
test('exact technical-only projection preserves unknown outcomes without inventing resolution',()=>{
  const parsed=parseHistoricalCandidates([unverified],'ready',artifacts);
  assert.deepEqual(parsed,[unverified]);
  assert.equal(parsed![0].scope,'historical_unverified_candidate');
  assert.equal(parsed![0].implementedCount,0);
  assert.equal(parsed![0].deferredCount,0);
});
for(const change of [
  {unresolvedCount:0},{unresolvedCount:101},{unresolvedCount:1.5},{unresolvedCount:undefined},
  {implementedCount:1},{deferredCount:1},{managerProof:true},{technicalQaStatus:'pending'},
  {scope:'historical_partial_candidate'},{privateIssueIds:[recoveryId]},
]) test(`technical-only candidate rejects unsupported provenance ${JSON.stringify(change)}`,()=>{
  assert.equal(parseHistoricalCandidates([{...unverified,...change}],'ready',artifacts),null);
});
test('technical-only candidate remains bound to one validated review-only artifact',()=>{
  assert.equal(parseHistoricalCandidates([unverified],'ready',[{...artifacts[0],status:'declared'}]),null);
  assert.equal(parseHistoricalCandidates([unverified],'ready',[{...artifacts[0],role:'final_output'}]),null);
  assert.equal(parseHistoricalCandidates([{...unverified,artifactId:recoveryId}],'ready',artifacts),null);
});
test('partial and technical-only candidates may coexist only with distinct custody identities',()=>{
  const otherArtifactId='44444444-4444-4444-8444-444444444444';
  const otherRecoveryId='55555555-5555-4555-8555-555555555555';
  const otherArtifact={...artifacts[0],id:otherArtifactId,relativePath:'private/other.mp4'};
  const other={...unverified,artifactId:otherArtifactId,recoveryId:otherRecoveryId};
  assert.deepEqual(parseHistoricalCandidates([candidate,other],'ready',[...artifacts,otherArtifact]),[candidate,other]);
  assert.equal(parseHistoricalCandidates([candidate,{...other,recoveryId}],'ready',[...artifacts,otherArtifact]),null);
  assert.equal(parseHistoricalCandidates([candidate,{...other,artifactId}],'ready',[...artifacts,otherArtifact]),null);
});
const packetFor=(historicalCandidates:unknown[])=>({ok:true,run:{id:runId,slug:null,runState:'completed',status:'partial',reviewStatus:'needs_input',holdKind:'needs_input',startedAt:null},
    lineage:{rootRunId:runId,versions:[{runId,label:'Original',runState:'completed',startedAt:null}]},artifacts,
    reviewArtifacts:[],issues:[],session:null,verification:{receipts:[]},judgment:null,production:null,
    sources:{...Object.fromEntries(PACKET_SOURCE_KEYS.map(k=>[k,'ready'])),historical_candidates:'ready'},historicalCandidates});
test('full packet consumer accepts the partial producer projection and refuses forged Manager proof',()=>{
  const packet=packetFor([candidate]);
  const parsed=parseReviewPacketResponse(packet,runId);
  assert.ok(parsed); assert.deepEqual(parsed.historicalCandidates,[candidate]);
  assert.equal(parsed.run?.status,'partial');
  assert.equal(parseReviewPacketResponse({...packet,historicalCandidates:[{...candidate,managerProof:true}]},runId),null);
});
test('full packet and artifact deep link accept the exact technical-only producer projection',()=>{
  const parsed=parseReviewPacketResponse(packetFor([unverified]),runId);
  assert.ok(parsed,'a valid technical-only candidate must not turn the entire Review packet unavailable');
  assert.deepEqual(parsed.historicalCandidates,[unverified]);
  assert.equal(resolveInitialArtifact(artifactId,parsed.artifacts,null),artifactId,
    'the requested candidate is selected only after its packet-bound artifact is validated');
  assert.equal(resolveInitialArtifact(recoveryId,parsed.artifacts,artifactId),artifactId,
    'a foreign query id is never trusted as a selection');
});
