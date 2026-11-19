'use client';

import {useState} from 'react';
import {UUID} from '@/lib/trainer-questions';

export const INTAKE_CONTRACT = 'training-intake-plan.v1';
type Change = {kind:'step_change'|'tool_addition';stepOrder:number;instruction:string;toolName:string|null;toolId:string|null;accessModes:string[]};
export type IntakePlan = {contractVersion:typeof INTAKE_CONTRACT;planId:string;planDigest:string;versionId:string;changes:Change[]};

export function readIntakePlan(value:unknown,versionId:string):IntakePlan|null {
  const plan=value as IntakePlan;
  if(!plan||plan.contractVersion!==INTAKE_CONTRACT||plan.versionId!==versionId
    ||!UUID.test(plan.planId)||!/^[a-f0-9]{64}$/.test(plan.planDigest)
    ||!Array.isArray(plan.changes)||!plan.changes.length||plan.changes.length>3)return null;
  return plan.changes.every(change=>change
    &&['step_change','tool_addition'].includes(change.kind)&&Number.isSafeInteger(change.stepOrder)&&change.stepOrder>0
    &&typeof change.instruction==='string'&&!!change.instruction.trim()&&change.instruction.length<=400
    &&(change.kind==='step_change'?change.toolName===null&&change.toolId===null:typeof change.toolName==='string'&&!!change.toolName.trim())
    &&(change.toolId===null||typeof change.toolId==='string')&&Array.isArray(change.accessModes)
    &&change.accessModes.every(mode=>['api_key','browser_login','local_tool'].includes(mode)))?plan:null;
}

export default function TrainingIntakePlan({plan,disabled,onQueue,onClose}:{
  plan:IntakePlan;disabled:boolean;onQueue:(selected:number[])=>Promise<void>;onClose:()=>void;
}) {
  const [selected,setSelected]=useState<number[]>([]);
  const [pending,setPending]=useState(false);
  const [queued,setQueued]=useState(false);
  const [error,setError]=useState('');
  async function queue(){
    setPending(true);setError('');
    try{await onQueue(selected);setQueued(true);}
    catch(caught){setError(caught instanceof Error?caught.message:'The update could not be confirmed.');}
    finally{setPending(false);}
  }
  return <section className="space-y-3 rounded-xl border border-ink-700 p-4" aria-label="Suggested agent changes">
    <div className="flex items-center justify-between gap-2">
      <h3 className="font-medium">Suggested agent changes</h3>
      <button type="button" className="text-sm underline" disabled={pending} onClick={onClose}>Close</button>
    </div>
    {queued?<p role="status">Update requested. The current version stays active while Implexa prepares the revision.</p>:<>
      <p className="text-sm text-ink-300">Select the changes you want Implexa to prepare for this agent.</p>
      {plan.changes.map((change,index)=>{
        const needsSetup=change.kind==='tool_addition'&&!change.toolId;
        return <label key={index} className="flex gap-3 rounded-lg border border-ink-800 p-3 text-sm">
          <input type="checkbox" disabled={disabled||pending||needsSetup} checked={selected.includes(index)}
            onChange={event=>setSelected(current=>event.target.checked?[...current,index]:current.filter(i=>i!==index))}/>
          <span><span className="block font-medium">{change.kind==='step_change'?'Update an agent step':`Add ${change.toolName}`}</span>
            <span className="block text-ink-400">{change.instruction}</span>
            {needsSetup&&<span className="block text-ink-400">This tool needs a supported connection before it can be added.</span>}
          </span>
        </label>;
      })}
      {error&&<p role="alert" className="text-sm text-amber-300">{error}</p>}
      <button type="button" className="btn-primary" disabled={disabled||pending||!selected.length} onClick={()=>void queue()}>
        {pending?'Requesting update…':'Request selected changes'}
      </button>
    </>}
  </section>;
}
