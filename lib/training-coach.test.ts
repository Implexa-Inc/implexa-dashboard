import test from 'node:test';import assert from 'node:assert/strict';import {coachPage,coachingCounts,coachingCount} from './training-coach.ts';
const id=(n:number)=>`80000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const fixture=()=>({ok:true,contractVersion:'training-coach-decisions.v1',complete:true,agents:[{id:id(1),slug:'owned',name:'Owned',description:null,versionId:id(2),decisionsComplete:true,liveLessons:0,lastTaughtAt:null,listing:'not_listed',decisions:[{id:id(3),kind:'lesson',source:'record',sessionId:id(4),versionId:id(2),digest:'a'.repeat(64),createdAt:'2026-11-21T12:00:00Z'}]}]});
test('counts come from the same displayed decision identities and preserve lower bounds',()=>{
 const page=coachPage(fixture());assert.ok(page);assert.deepEqual(coachingCounts(page),{decisions:1,decisionsComplete:true,agents:1,agentsComplete:true,listed:0,listedComplete:true});page.agents[0].decisionsComplete=false;page.agents[0].listing='unknown';assert.equal(coachingCount(coachingCounts(page).decisions,coachingCounts(page).decisionsComplete),'1+');assert.equal(coachingCounts(page).listedComplete,false);
});
test('private fields, stale versions, duplicate identities and wrong source kinds are refused',()=>{
 const cases=[(v:any)=>v.agents[0].decisions[0].excerpt='private',(v:any)=>v.agents[0].decisions[0].source='contribution',(v:any)=>v.agents[0].decisions[0].versionId=id(8),(v:any)=>v.agents[0].decisions.push(v.agents[0].decisions[0]),(v:any)=>v.agents[0].runId=id(9)];
 for(const mutate of cases){const v=fixture();mutate(v);assert.equal(coachPage(v),null);}
});
