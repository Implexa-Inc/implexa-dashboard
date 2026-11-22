export type AgentDisplayMetrics={ok:true;contractVersion:'agent-display-metrics.v1';familyId:string;basis:'versioned_worker_runs';visibility:'owner_aggregate'|'public_aggregate'|'insufficient_public_runs';totalRuns:number|null;scoredRuns:number|null;averageScore:number|null;timedRuns:number|null;averageDurationMs:number|null;ownLastRun:null|{at:string;executor:'claude'|'codex'|null;model:string|null}};
export function agentDisplayMetrics(v:any):AgentDisplayMetrics|null{
 if(!v||Object.keys(v).sort().join('|')!==['ok','contractVersion','familyId','basis','visibility','totalRuns','scoredRuns','averageScore','timedRuns','averageDurationMs','ownLastRun'].sort().join('|')||v.ok!==true||v.contractVersion!=='agent-display-metrics.v1'||!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v.familyId||'')||v.basis!=='versioned_worker_runs'||!['owner_aggregate','public_aggregate','insufficient_public_runs'].includes(v.visibility))return null;
 if(v.visibility==='insufficient_public_runs'){
  if([v.totalRuns,v.scoredRuns,v.averageScore,v.timedRuns,v.averageDurationMs].some(x=>x!==null))return null;
 }else if(![v.totalRuns,v.scoredRuns,v.timedRuns].every(x=>Number.isSafeInteger(x)&&x>=0)||v.scoredRuns>v.totalRuns||v.timedRuns>v.totalRuns
  ||(v.scoredRuns===0?v.averageScore!==null:typeof v.averageScore!=='number'||v.averageScore<0||v.averageScore>100)
  ||(v.timedRuns===0?v.averageDurationMs!==null:!Number.isSafeInteger(v.averageDurationMs)||v.averageDurationMs<=0))return null;
 const l=v.ownLastRun;
 if(l!==null&&(!l||Object.keys(l).sort().join('|')!=='at|executor|model'||typeof l.at!=='string'||!Number.isFinite(Date.parse(l.at))||![null,'claude','codex'].includes(l.executor)||l.model!==null&&(typeof l.model!=='string'||l.model.length>200)))return null;
 return v;
}
export function metricDuration(ms:number){const seconds=Math.round(ms/1000);return seconds<60?`${seconds}s`:seconds<3600?`${Math.round(seconds/60)} min`:`${(seconds/3600).toFixed(1)} hr`;}
