'use client';
import {useState,type ReactNode} from 'react';

export type VisualTeachingDraft={id:string;digest:string;judgment:string;appliesWhen:string;example:string;category:string;relation?:string;renderEvidence:ReactNode};

/** Selection is a review choice only. Existing Desktop acceptance owns every write. */
export default function TrainingDraftBundle({drafts,busy,onApply,onEdit,onExplain,explanationFor}:{drafts:VisualTeachingDraft[];busy:boolean;onApply:(ids:string[])=>void;onEdit:(id:string)=>void;onExplain?:(id:string)=>void;explanationFor?:(id:string)=>ReactNode}){
  const [skipped,setSkipped]=useState<Set<string>>(()=>new Set()),[confirmed,setConfirmed]=useState<Set<string>>(()=>new Set());
  const relationCopy:Record<string,string>={accepted:'keep this',rejected:'avoid this',contrast:'use this as a contrast',exception:'use this as an exception'};
  const keyFor=(draft:VisualTeachingDraft)=>`${draft.id}:${draft.digest}:${draft.relation||'unclassified'}:${draft.category}`;
  const selected=drafts.filter(draft=>!skipped.has(keyFor(draft)));
  if(!drafts.length)return null;
  return <section aria-label="Review proposed visual training" className="space-y-4">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-medium">Your agent will learn</h2><p className="mt-1 text-xs text-ink-400">Review the lesson. Keep the example as evidence.</p></div><span className="text-xs text-ink-500">{selected.length} selected</span></header>
    <div className={`grid gap-4 ${drafts.length>1?'md:grid-cols-2':'max-w-2xl'}`}>{drafts.map(draft=>{const key=keyFor(draft),included=!skipped.has(key),relation=draft.relation&&relationCopy[draft.relation];return <article key={key} className={`rounded-xl border bg-ink-900/20 p-4 ${included?'border-ink-700':'border-ink-800 opacity-60'}`}>
      <div className="mb-4 flex items-start justify-between gap-3">{draft.renderEvidence}<label className="flex items-center gap-2 text-xs text-ink-400"><input type="checkbox" checked={included} disabled={busy} onChange={()=>setSkipped(previous=>{const next=new Set(previous);if(included)next.add(key);else next.delete(key);return next;})}/>Include</label></div>
      <p className="text-sm leading-6 text-ink-100">{draft.judgment}</p><p className="mt-3 text-xs leading-5 text-ink-400"><span className="font-medium text-ink-300">Applies when </span>{draft.appliesWhen}</p>
      <div className="mt-3 rounded-lg bg-ink-950/50 p-3 text-xs leading-5 text-ink-300"><p>Implexa suggests: <strong>{relation||'classification needs review'}</strong></p><p className="mt-1 text-ink-500">{draft.category}</p>{included&&relation&&<label className="mt-2 flex items-start gap-2"><input type="checkbox" aria-label={`Confirm example use: ${relation}`} checked={confirmed.has(key)} disabled={busy} onChange={event=>setConfirmed(previous=>{const next=new Set(previous);if(event.target.checked)next.add(key);else next.delete(key);return next;})} className="mt-1"/><span>I agree: {relation}.</span></label>}{!relation&&<p className="mt-2 text-amber-300">Review this example’s type before applying.</p>}</div>
      {explanationFor?.(draft.id)}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs">{onExplain&&<button type="button" disabled={busy} className="text-ink-300" onClick={()=>onExplain(draft.id)}>✨ Explain</button>}<button type="button" disabled={busy} className="text-ink-300 underline underline-offset-4" onClick={()=>onEdit(draft.id)}>Review</button></div>
      <details className="mt-3 text-xs leading-5 text-ink-500"><summary className="cursor-pointer">Original example</summary><p className="mt-2 whitespace-pre-wrap">{draft.example}</p></details>
    </article>;})}</div>
    <button type="button" className="btn-primary" disabled={busy||!selected.length||selected.some(draft=>!draft.relation||!relationCopy[draft.relation]||!confirmed.has(keyFor(draft)))} onClick={()=>onApply(selected.map(draft=>draft.id))}>{busy?'Saving training…':`Apply ${selected.length===1?'selected lesson':`${selected.length} selected lessons`}`}</button>
    <p className="text-xs text-ink-500">Then test the update before making it live.</p>
  </section>;
}
