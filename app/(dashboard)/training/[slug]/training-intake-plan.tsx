'use client';

import {useId,useState} from 'react';
import {UUID} from '@/lib/trainer-questions';

export const INTAKE_CONTRACT = 'training-intake-plan.v1';
export const METHOD_CONTRACT = 'training-recorded-method.v1';
const METHOD_LABELS={browser:'Browser',computer_use:'Computer use',desktop_app:'Desktop app',command_line:'Command line',api:'API'};
type RecordedMethod={access:keyof typeof METHOD_LABELS;website:string|null;tool:string|null;actions:string[]};
type Change = {kind:'step_change'|'tool_addition';stepOrder:number;instruction:string;toolName:string|null;toolId:string|null;accessModes:string[];method?:RecordedMethod};
export type IntakePlan = {contractVersion:typeof INTAKE_CONTRACT;planId:string;planDigest:string;versionId:string;changes:Change[]};

function validMethod(method:RecordedMethod) {
  return !!method&&Object.hasOwn(METHOD_LABELS,method.access)
    &&(method.website===null||typeof method.website==='string'&&method.website.length<=60&&/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(method.website))
    &&(method.tool===null||typeof method.tool==='string'&&!!method.tool.trim()&&method.tool.length<=40)
    &&Array.isArray(method.actions)&&method.actions.length>=1&&method.actions.length<=4
    &&method.actions.every(action=>typeof action==='string'&&!!action.trim()&&action.length<=70);
}

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
    &&change.accessModes.every(mode=>['api_key','browser_login','local_tool'].includes(mode))
    &&(change.method===undefined||change.kind==='step_change'&&validMethod(change.method)))?plan:null;
}

export default function TrainingIntakePlan({plan,disabled,onQueue,onClose}:{
  plan:IntakePlan;disabled:boolean;onQueue:(selected:number[])=>Promise<void>;onClose:()=>void;
}) {
  const methodId=useId();
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
        const method=change.method;
        const example=method&&[method.tool,method.website].filter(Boolean).join(' · ');
        return <div key={index} className="rounded-lg border border-ink-800 p-3 text-sm">
          <label className="flex gap-3">
            <input type="checkbox" disabled={disabled||pending||needsSetup} checked={selected.includes(index)}
              aria-describedby={method?`${methodId}-${index}`:undefined}
              onChange={event=>setSelected(current=>event.target.checked?[...current,index]:current.filter(i=>i!==index))}/>
            <span><span className="block font-medium">{change.kind==='step_change'?'Update an agent step':`Add ${change.toolName}`}</span>
            <span className="block text-ink-400">{change.instruction}</span>
            {needsSetup&&<span className="block text-ink-400">This tool needs a supported connection before it can be added.</span>}
            </span>
          </label>
          {method&&<div id={`${methodId}-${index}`} className="ml-7 mt-2 space-y-1 text-ink-300">
            <p>{METHOD_LABELS[method.access]}{example&&` · ${example} or an equivalent`}</p>
            <ol className="list-decimal space-y-1 pl-5">{method.actions.map((action,i)=><li key={i}>{action}</li>)}</ol>
          </div>}
        </div>;
      })}
      {error&&<p role="alert" className="text-sm text-state-needs">{error}</p>}
      <button type="button" className="btn-primary" disabled={disabled||pending||!selected.length} onClick={()=>void queue()}>
        {pending?'Requesting update…':'Request selected changes'}
      </button>
    </>}
  </section>;
}
