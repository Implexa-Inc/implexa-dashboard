'use client';
import {useState,type ReactNode} from 'react';

export type VisualTeachingDraft={id:string;digest:string;judgment:string;appliesWhen:string;example:string;category:string;renderEvidence:ReactNode};

/** Selection is a review choice only. Existing Desktop acceptance owns every write. */
export default function TrainingDraftBundle({drafts,busy,onApply,onEdit,onExplain,explanationFor}:{drafts:VisualTeachingDraft[];busy:boolean;onApply:(ids:string[])=>void;onEdit:(id:string)=>void;onExplain?:(id:string)=>void;explanationFor?:(id:string)=>ReactNode}){
  const [skipped,setSkipped]=useState<Set<string>>(()=>new Set());
  const selected=drafts.filter(draft=>!skipped.has(`${draft.id}:${draft.digest}`));
  if(!drafts.length)return null;
  return <section aria-label="Review proposed visual training" className="space-y-4 rounded-2xl border border-brand-500/40 p-5">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-medium">Your agent will learn</h2><p className="mt-1 text-xs text-ink-400">Review the lesson. Keep the example as evidence.</p></div><span className="text-xs text-ink-500">{selected.length} selected</span></header>
    <div className="grid gap-4 md:grid-cols-2">{drafts.map(draft=>{const key=`${draft.id}:${draft.digest}`,included=!skipped.has(key);return <article key={key} className={`rounded-xl border bg-ink-900/20 p-4 ${included?'border-ink-700':'border-ink-800 opacity-60'}`}>
      <div className="mb-4 flex items-start justify-between gap-3">{draft.renderEvidence}<label className="flex items-center gap-2 text-xs text-ink-400"><input type="checkbox" checked={included} disabled={busy} onChange={()=>setSkipped(previous=>{const next=new Set(previous);if(included)next.add(key);else next.delete(key);return next;})}/>Include</label></div>
      <p className="text-sm leading-6 text-ink-100">{draft.judgment}</p><p className="mt-3 text-xs leading-5 text-ink-400"><span className="font-medium text-ink-300">Applies when </span>{draft.appliesWhen}</p>
      {explanationFor?.(draft.id)}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs"><span className="text-ink-500">{draft.category}</span>{onExplain&&<button type="button" disabled={busy} className="text-ink-300" onClick={()=>onExplain(draft.id)}>✨ Explain</button>}<button type="button" disabled={busy} className="text-ink-300 underline underline-offset-4" onClick={()=>onEdit(draft.id)}>Review</button></div>
      <details className="mt-3 text-xs leading-5 text-ink-500"><summary className="cursor-pointer">Original example</summary><p className="mt-2 whitespace-pre-wrap">{draft.example}</p></details>
    </article>;})}</div>
    <button type="button" className="btn-primary" disabled={busy||!selected.length} onClick={()=>onApply(selected.map(draft=>draft.id))}>{busy?'Saving training…':`Apply ${selected.length===1?'selected lesson':`${selected.length} selected lessons`}`}</button>
    <p className="text-xs text-ink-500">Then test the update before making it live.</p>
  </section>;
}
