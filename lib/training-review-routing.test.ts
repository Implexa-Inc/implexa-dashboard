import test from 'node:test';
import assert from 'node:assert/strict';
import {trainingReviewSlug,trainingReviewHref,isTrainerFeedback,reviewQueueForArea} from './training-review-routing.ts';
import type {MyWorkflowsRead} from './workflow-catalog';
const owned={status:'ready',workflows:[{slug:'video',source:'generated'}]} as MyWorkflowsRead;
test('only a readable owned generated-agent result moves into Training; approvals and customers retain Work',()=>{
 const packet={live:true,run:{slug:'video',holdKind:null}};
 assert.equal(trainingReviewSlug(packet,owned),'video');
 for(const p of [{...packet,live:false},{...packet,run:null},{live:true,run:{slug:null}},{live:true,run:{slug:'other'}},{live:true,run:{slug:'video',holdKind:'approval_before_action'}}])assert.equal(trainingReviewSlug(p,owned),null);
 assert.equal(trainingReviewSlug(packet,{status:'unavailable',reason:'timeout'}),null);
 assert.equal(trainingReviewSlug(packet,{status:'ready',workflows:[]}),null);
 assert.equal(trainingReviewSlug(packet,{status:'ready',workflows:[{slug:'video',source:'captured'}]} as MyWorkflowsRead),null);
 assert.equal(trainingReviewHref('video agent','run/id','art/id'),'/training/video%20agent/review/run%2Fid?artifact=art%2Fid');
});

test('Training and Work share one feedback partition; approvals/customers remain in Work and failed ownership preserves its badge',()=>{
 const own={slug:'video',reason:'result_unreviewed',holdKind:null};
 const approval={...own,reason:'approval'},customer={...own,slug:'other'};
 const q={items:[own,approval,customer],visibleCount:3,total:3,truncated:false,live:true,sources:{review_endpoint:'ready'}} as any;
 assert.equal(isTrainerFeedback(own as any,owned),true);assert.equal(isTrainerFeedback(approval as any,owned),false);
 assert.deepEqual(reviewQueueForArea(q,owned,'training').items,[own]);
 const work=reviewQueueForArea(q,owned,'work');assert.deepEqual(work.items,[approval,customer]);assert.equal(work.visibleCount,2);
 assert.equal(reviewQueueForArea(q,{status:'unavailable',reason:'timeout'},'work'),q,'failed roster leaves every Work item and original counts intact');
 assert.equal(reviewQueueForArea(q,{status:'unavailable',reason:'timeout'},'training').sources.training_owner_roster,'unavailable');
});
