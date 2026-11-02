import test from 'node:test';
import assert from 'node:assert/strict';
import {parseRunSummaryCursor,selectRunSummaries} from './run-state.ts';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function client(rows:any[],hidden:string[]=[],error:any=null,classError:any=null){
 const calls:any[]=[];
 return {calls,db:{from:(table:string)=>{const q:any={};
  for(const method of ['select','eq','in','or','not','order','limit'])q[method]=(...args:any[])=>{calls.push([table,method,...args]);return q;};
  q.then=(resolve:any)=>Promise.resolve(table==='skill_runs'?{data:rows,error}:{data:hidden.map(run_id=>({run_id})),error:classError}).then(resolve);return q;
 }} as any};
}
test('thin result pages exclude bodies, scope the owner, and retain raw pagination across hidden scaffolds',async()=>{
 const rows=Array.from({length:6},(_,n)=>({id:id(n),skill_slug:'video',status:'completed',ran_at:'2026-11-01T12:00:00.123456+00:00'}));
 const {db,calls}=client(rows,rows.slice(0,5).map(r=>r.id));
 const page=await selectRunSummaries(db,'owner');
 assert.deepEqual(page.rows,[]);
 assert.deepEqual(page.nextCursor,{ranAt:rows[4].ran_at,id:id(4)});
 assert.deepEqual(calls.find(c=>c[0]==='skill_runs'&&c[1]==='select'),['skill_runs','select','id,skill_slug,status,ran_at']);
 assert.ok(calls.some(c=>c[1]==='eq'&&c[2]==='user_id'&&c[3]==='owner'));
 assert.deepEqual(calls.find(c=>c[1]==='limit'),['skill_runs','limit',6]);
 assert.deepEqual(calls.filter(c=>c[1]==='order').map(c=>c[2]),['ran_at','id']);
 assert.ok(calls.some(c=>c[1]==='not'&&c[2]==='output_markdown'));
 assert.ok(calls.some(c=>c[1]==='or'&&c[2].includes('review_status.neq.pending')));
 assert.ok(calls.some(c=>c[1]==='or'&&c[2]==='run_state.eq.completed,run_state.is.null'));
 const next=client(rows.slice(5));await selectRunSummaries(next.db,'owner',page.nextCursor);
 assert.ok(next.calls.some(c=>c[1]==='or'&&c[2]===`ran_at.lt.${rows[4].ran_at},and(ran_at.eq.${rows[4].ran_at},id.lt.${id(4)})`));
});
test('short raw page ends pagination and primary/classification failures remain unavailable',async()=>{
 const row={id:id(1),skill_slug:'video',status:'partial',ran_at:'2026-11-01T12:00:00Z'};
 assert.deepEqual(await selectRunSummaries(client([row]).db,'owner'),{rows:[row],nextCursor:null});
 await assert.rejects(selectRunSummaries(client([],[],{code:'42501'}).db,'owner'),/unavailable/);
 await assert.rejects(selectRunSummaries(client([row],[],null,{code:'42501'}).db,'owner'),/unavailable/);
});
test('cursor rejects partial or expression-injection values and keeps timestamp precision',()=>{
 assert.equal(parseRunSummaryCursor(null,null),null);
 for(const [time,key] of [[null,id(1)],['bad',id(1)],['2026-11-01T12:00:00Z',`${id(1)}),user_id.neq.x`]])assert.throws(()=>parseRunSummaryCursor(time,key),/invalid_cursor/);
 const time='2026-11-01T12:00:00.123456+00:00';assert.equal(parseRunSummaryCursor(time,id(1))?.ranAt,time);
});
