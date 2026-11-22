import test from 'node:test';import assert from 'node:assert/strict';
import {trainingAnnotationHref,trainingAnnotationReturn} from './training-annotation-routing.ts';
const id='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',digest='a'.repeat(64);
test('four annotation entry points use one agent-scoped full-page family and carry opaque selectors only',()=>{
 assert.equal(trainingAnnotationHref('my-agent',{kind:'result',runId:id,artifactId:other}),`/training/my-agent/review/${id}?artifact=${other}`);
 assert.equal(trainingAnnotationHref('my-agent',{kind:'recording',recordingId:id,momentId:other}),`/training/my-agent/annotate/recordings/${id}?momentId=${other}`);
 assert.equal(trainingAnnotationHref('my-agent',{kind:'image',sourceId:id,sessionId:other}),`/training/my-agent/annotate/${id}?sessionId=${other}`);
 assert.equal(trainingAnnotationHref('my-agent',{kind:'result',issueId:id}),`/training/my-agent/review/issues/${id}?issueId=${id}`);
 assert.equal(trainingAnnotationHref('my-agent',{kind:'feedback',annotationId:id,annotationDigest:digest,sessionId:other}),`/training/my-agent/annotate/feedback/${id}?sessionId=${other}&digest=${digest}`);
 assert.equal(trainingAnnotationReturn('my-agent'),'/training/my-agent');
});
test('a verified upload preserves its exact session/source handoff and the selected recording moment',()=>{
 const url=new URL(trainingAnnotationHref('my agent',{kind:'recording',recordingId:id,sessionId:other,sourceId:id,analyze:true,momentId:other}),'https://dashboard.test');
 assert.equal(url.pathname,`/training/my%20agent/annotate/recordings/${id}`);assert.equal(url.searchParams.get('sessionId'),other);assert.equal(url.searchParams.get('sourceId'),id);assert.equal(url.searchParams.get('momentId'),other);assert.equal(url.searchParams.get('analyze'),'1');
 assert.deepEqual([...url.searchParams.keys()].sort(),['analyze','momentId','sessionId','sourceId']);
});
