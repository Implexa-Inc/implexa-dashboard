import test from 'node:test';
import assert from 'node:assert/strict';
import {trainingReviewSlug,trainingReviewHref} from './training-review-routing.ts';
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
