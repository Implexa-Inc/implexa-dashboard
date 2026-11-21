/** Display-only decision identities; existing action writers recheck authority. */
export type CoachDecision={id:string;kind:'lesson'|'feedback'|'question'|'customer'|'agent_change';source:'record'|'review_issue'|'question'|'contribution'|'intake_plan'|'annotation_gap'|'recording_agent';sessionId:string|null;versionId:string;digest:string;createdAt:string};
export type CoachAgent={id:string;slug:string;name:string;description:string|null;versionId:string|null;decisions:CoachDecision[];decisionsComplete:boolean;liveLessons:number|null;lastTaughtAt:string|null;listing:'listed'|'draft'|'submitted'|'not_listed'|'unknown'};
export type CoachPage={ok:true;contractVersion:'training-coach-decisions.v1';agents:CoachAgent[];complete:boolean};
export type CoachRead={status:'ready';page:CoachPage}|{status:'unavailable'};
const uuid=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
const exact=(v:any,keys:string[])=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join('|')===keys.sort().join('|');
export function coachPage(value:unknown):CoachPage|null{
 const v=value as any;
 if(!exact(v,['ok','contractVersion','agents','complete'])||v.ok!==true||v.contractVersion!=='training-coach-decisions.v1'||typeof v.complete!=='boolean'||!Array.isArray(v.agents)||v.agents.length>200)return null;
 const seen=new Set();
 for(const a of v.agents){
  if(!exact(a,['id','slug','name','description','versionId','decisions','decisionsComplete','liveLessons','lastTaughtAt','listing'])||!uuid(a.id)||seen.has(a.id)
   ||a.description!==null&&(typeof a.description!=='string'||a.description.length>1000)
   ||typeof a.slug!=='string'||!/^[a-zA-Z0-9_-]{1,200}$/.test(a.slug)||typeof a.name!=='string'||a.name.length>500||a.versionId!==null&&!uuid(a.versionId)
   ||typeof a.decisionsComplete!=='boolean'||a.liveLessons!==null&&(!Number.isSafeInteger(a.liveLessons)||a.liveLessons<0||a.liveLessons>200)
   ||(a.liveLessons===null||a.liveLessons===0)&&a.lastTaughtAt!==null
   ||a.lastTaughtAt!==null&&(typeof a.lastTaughtAt!=='string'||!Number.isFinite(Date.parse(a.lastTaughtAt)))
   ||!['listed','draft','submitted','not_listed','unknown'].includes(a.listing)||!Array.isArray(a.decisions)||a.decisions.length>200)return null;
  seen.add(a.id);const ids=new Set();
  for(const d of a.decisions){
   const sources:Record<string,string[]>={lesson:['record'],feedback:['review_issue'],question:['question'],customer:['contribution'],agent_change:['intake_plan','annotation_gap','recording_agent']};
   if(!exact(d,['id','kind','source','sessionId','versionId','digest','createdAt'])||!uuid(d.id)||ids.has(d.id)||!sources[d.kind]?.includes(d.source)
    ||(['lesson','agent_change'].includes(d.kind)?!uuid(d.sessionId):d.sessionId!==null)||d.versionId!==a.versionId||!uuid(d.versionId)||typeof d.digest!=='string'||!/^[a-f0-9]{64}$/.test(d.digest)
    ||typeof d.createdAt!=='string'||!Number.isFinite(Date.parse(d.createdAt)))return null;
   ids.add(d.id);
  }
 }
 return v;
}
export function coachingCounts(page:CoachPage){
 const decisions=page.agents.reduce((n,a)=>n+a.decisions.length,0),decisionsComplete=page.complete&&page.agents.every(a=>a.decisionsComplete);
 const listed=page.agents.filter(a=>a.listing==='listed').length,listedComplete=page.complete&&page.agents.every(a=>a.listing!=='unknown');
 return {decisions,decisionsComplete,agents:page.agents.length,agentsComplete:page.complete,listed,listedComplete};
}
export const coachingCount=(count:number,complete:boolean)=>`${count}${complete?'':'+'}`;
