'use client';
import {useEffect,useState} from 'react';
import {agentDisplayMetrics,metricDuration,type AgentDisplayMetrics as Metrics} from '@/lib/agent-display-metrics';
export default function AgentDisplayMetrics({slug,source,familyId,delivered}:{slug:string;source:string;familyId:string;delivered:string}){
 const [value,setValue]=useState<Metrics|null>(null),[failed,setFailed]=useState(false),[retry,setRetry]=useState(0);
 useEffect(()=>{const c=new AbortController();setValue(null);setFailed(false);
  void fetch(`/api/agents/${encodeURIComponent(slug)}/metrics?source=${encodeURIComponent(source)}`,{cache:'no-store',signal:c.signal}).then(async r=>{const v=agentDisplayMetrics(await r.json());if(!c.signal.aborted){if(!r.ok||!v||v.familyId!==familyId)setFailed(true);else setValue(v);}}).catch(()=>{if(!c.signal.aborted)setFailed(true);});return()=>c.abort();
 },[slug,source,familyId,retry]);
 const hidden=value?.visibility==='insufficient_public_runs',pending=!value&&!failed;
 const unknown=failed?'Unavailable':pending?'Loading…':'Not enough public runs';
 return <section aria-label="Recorded agent activity"><div className="agent-page-stats">
  <Stat label="Delivered" value={delivered} detail="Existing delivery estimate · last 90 days"/>
  <Stat label="Average score" value={!value||hidden?unknown:value.averageScore===null?'Not scored yet':`${value.averageScore}/100`} detail={value&&!hidden?`${value.scoredRuns} of ${value.totalRuns} runs scored · all time`:undefined}/>
  <Stat label="Average run time" value={!value||hidden?unknown:value.averageDurationMs===null?'Not recorded yet':metricDuration(value.averageDurationMs)} detail={value&&!hidden?`${value.timedRuns} of ${value.totalRuns} runs timed · all time`:undefined}/>
 </div>{value&&<p className="mb-5 text-xs leading-6 text-ink-500">Versioned worker runs across this agent’s versions. Judge and recovery runs are excluded. Older runs without a recorded version are not included.{value.ownLastRun&&<> Your last run: {new Date(value.ownLastRun.at).toLocaleDateString('en-US',{month:'short',day:'numeric'})}{value.ownLastRun.executor?` · ${value.ownLastRun.executor==='codex'?'Codex':'Claude'}`:''}{value.ownLastRun.model?` · ${value.ownLastRun.model}`:''}.</>}</p>}{failed&&<p role="status" className="mb-5 text-xs text-ink-500">Statistics couldn’t load. You can still use this agent. <button type="button" className="underline" onClick={()=>setRetry(n=>n+1)}>Retry statistics</button></p>}</section>;
}
function Stat({label,value,detail}:{label:string;value:string;detail?:string}){return <div className="card p-4"><p className="text-xs text-ink-500">{label}</p><p className="mt-2 text-2xl">{value}</p>{detail&&<p className="mt-2 text-xs text-ink-500">{detail}</p>}</div>;}
