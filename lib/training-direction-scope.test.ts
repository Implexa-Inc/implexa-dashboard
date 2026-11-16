import test from 'node:test';
import assert from 'node:assert/strict';
import {isTrainingDirectionScope,trainingDirectionsFromTaskFacts,trainingDirectionFacts} from './training-local-ingress.ts';

test('conditional task facts cannot silently become general training at the client boundary',()=>{
 assert.deepEqual(trainingDirectionsFromTaskFacts(['presenter-led explanation']),[]);
 assert.equal(trainingDirectionsFromTaskFacts(undefined),undefined);
 for(const facts of [['creative_direction:Unknown'],['creative_direction=Balanced'],['creative_direction:Balanced','creative_direction:No B-rolls'],['creative_direction:Balanced','creative_direction:Balanced'],null])
  assert.equal(trainingDirectionsFromTaskFacts(facts),null);
 assert.equal(isTrainingDirectionScope(undefined),false);
 assert.equal(isTrainingDirectionScope(null),true);
 assert.throws(()=>trainingDirectionFacts(null as any));
});
test('all four exact run choices preserve a single conditional fact through the native writer',()=>{
 for(const direction of ['Animation-heavy','Cinematic B-roll-heavy','Balanced','No B-rolls'] as const){
  const facts=trainingDirectionFacts([direction]);
  assert.deepEqual(facts,[`creative_direction:${direction}`]);
  assert.deepEqual(trainingDirectionsFromTaskFacts(['presenter-led explanation',...facts]),[direction]);
 }
 assert.deepEqual(trainingDirectionFacts([]),[]);
});
