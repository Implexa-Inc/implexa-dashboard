import test from 'node:test';import assert from 'node:assert/strict';
import {readMarketplaceSamples,parseMarketplaceSample,marketplacePilotEnabled,agentHomeTab} from './agent-marketplace-samples.ts';
const listing={sampleOnly:true,name:'Sample studio',category:'Video',input:'A video',outcome:'A finished video',tasteVariants:3,runCount:140,deliveryRate:89,supportedEngines:['Claude','Codex'],averageGrade:86,monthlyUsd:8,trial:'First run free',owner:{handle:'Example trainer',agentCount:3,averageGrade:83},artwork:'video'};
test('only explicit, well-formed sample rows enable the pilot; empty, malformed and unavailable reads preserve the ordinary page',async()=>{
 const valid=await readMarketplaceSamples(async()=>({data:[{slug:'beta-video',listing}],error:null}));assert.equal(marketplacePilotEnabled(valid),true);
 assert.equal(parseMarketplaceSample({slug:'real-agent',listing}),null);
 for(const patch of [{sampleOnly:false},{sampleOnly:undefined},{monthlyUsd:-1},{averageGrade:101},{runCount:1.5},{supportedEngines:['Claude','Claude']},{owner:{handle:'X'}}])assert.equal(parseMarketplaceSample({slug:'beta-video',listing:{...listing,...patch}}),null);
 for(const result of [{data:[],error:null},{data:null,error:{message:'missing table'}},{data:[{slug:'beta-video',listing:{...listing,sampleOnly:false}}],error:null}])assert.equal(marketplacePilotEnabled(await readMarketplaceSamples(async()=>result)),false);
 assert.equal(marketplacePilotEnabled(await readMarketplaceSamples(async()=>{throw Error('timeout');})),false);
 assert.equal(agentHomeTab(),'rent');assert.equal(agentHomeTab('running'),'running');assert.equal(agentHomeTab('training'),'training');assert.equal(agentHomeTab('unknown'),'rent');
});
