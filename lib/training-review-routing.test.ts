import test from 'node:test';
import assert from 'node:assert/strict';
import {trainingReviewSlug,trainingReviewHref,isTrainerFeedback,trainingReviewQueue} from './training-review-routing.ts';
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

test('Training selects feedback for owned agents and preserves the unconfirmed-roster state',()=>{
 const own={slug:'video',reason:'result_unreviewed',holdKind:null};
 const approval={...own,reason:'approval'},customer={...own,slug:'other'};
 const q={items:[own,approval,customer],visibleCount:3,total:3,truncated:false,live:true,sources:{review_endpoint:'ready'}} as any;
 assert.equal(isTrainerFeedback(own as any,owned),true);assert.equal(isTrainerFeedback(approval as any,owned),false);
 assert.deepEqual(trainingReviewQueue(q,owned).items,[own]);
 assert.equal(trainingReviewQueue(q,{status:'unavailable',reason:'timeout'}).sources.training_owner_roster,'unavailable');
});
