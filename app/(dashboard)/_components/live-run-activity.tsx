'use client';
import {useState} from 'react';
import CompletedRunResults from './completed-run-results';
import RunningAgents,{type LiveState} from './running-agents';

/** One existing live poller; its read state also owns the empty/loading message. */
export default function LiveRunActivity({compact=false}:{compact?:boolean}){
 const [revision,setRevision]=useState(0);
 const [state,setState]=useState<LiveState>({status:'loading',count:0});
 return <><section aria-label="Live run activity"><h2 className="mb-3 text-sm font-medium text-ink-200">{compact?'Active agent runs':'Live activity'}</h2>
  <RunningAgents bare compact={compact} onState={setState} onFinished={()=>setRevision(value=>value+1)}/>
  {state.status==='loading'&&<p role="status" className="text-sm text-ink-400">Checking active runs…</p>}
  {state.status==='unavailable'&&<p role="status" className="text-sm text-amber-300">Live activity is temporarily unavailable. Reconnecting…</p>}
  {!compact&&state.status==='ready'&&state.count===0&&<p className="text-sm text-ink-400">No active runs right now.</p>}
 </section>{compact&&<CompletedRunResults revision={revision}/>}</>;
}
