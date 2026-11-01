import test from 'node:test';import assert from 'node:assert/strict';
import {readMarketplaceSamples,parseMarketplaceSample,marketplacePilotEnabled,agentHomeTab,agentHomeView} from './agent-marketplace-samples.ts';
const listing={sampleOnly:true,name:'Sample studio',category:'Video',input:'A video',outcome:'A finished video',tasteVariants:3,runCount:140,deliveryRate:89,supportedEngines:['Claude','Codex'],averageGrade:86,monthlyUsd:8,trial:'First run free',owner:{handle:'Example trainer',agentCount:3,averageGrade:83},artwork:'video'};
test('only explicit, well-formed sample rows enable the pilot; empty, malformed and unavailable reads preserve the ordinary page',async()=>{
 const valid=await readMarketplaceSamples(async()=>({data:[{slug:'beta-video',listing}],error:null}));assert.equal(marketplacePilotEnabled(valid),true);
 assert.equal(parseMarketplaceSample({slug:'real-agent',listing}),null);
 for(const patch of [{sampleOnly:false},{sampleOnly:undefined},{monthlyUsd:-1},{averageGrade:101},{runCount:1.5},{supportedEngines:['Claude','Claude']},{owner:{handle:'X'}}])assert.equal(parseMarketplaceSample({slug:'beta-video',listing:{...listing,...patch}}),null);
 for(const result of [{data:[],error:null},{data:null,error:{message:'missing table'}},{data:[{slug:'beta-video',listing:{...listing,sampleOnly:false}}],error:null}])assert.equal(marketplacePilotEnabled(await readMarketplaceSamples(async()=>result)),false);
 assert.equal(marketplacePilotEnabled(await readMarketplaceSamples(async()=>{throw Error('timeout');})),false);
 assert.equal(agentHomeTab(),'rent');assert.equal(agentHomeTab('running'),'running');assert.equal(agentHomeTab('training'),'training');assert.equal(agentHomeTab('unknown'),'rent');
});

test('home branching keeps every non-pilot read on the ordinary page for every tab; only authorized sample rows enable the three views',()=>{
 const reads=[{status:'ready',listings:[]},{status:'unavailable',listings:[]}] as const;
 for(const read of reads)for(const tab of [undefined,'rent','running','training','unknown'])assert.equal(agentHomeView(read as any,tab),'ordinary');
 const sample=parseMarketplaceSample({slug:'beta-video',listing})!;
 const enabled={status:'ready',listings:[sample]} as const;
 assert.equal(agentHomeView(enabled as any),'rent');assert.equal(agentHomeView(enabled as any,'rent'),'rent');assert.equal(agentHomeView(enabled as any,'running'),'running');assert.equal(agentHomeView(enabled as any,'training'),'training');
});
