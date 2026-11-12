'use client';
import {useRef,useState,type ReactNode} from 'react';
import Modal from '../../_components/modal';

export type VisualTeachingDraft={id:string;digest:string;judgment:string;appliesWhen:string;example:string;category:string;relation?:string;relationOrigin?:'model'|'owner';sourceNote?:{body:string;purpose:'training'|'revision'};renderEvidence:ReactNode};

function SavedSourceNote({note}:{note:NonNullable<VisualTeachingDraft['sourceNote']>}){
 const long=note.body.length>240;
 return <div className="mt-3 rounded-lg border border-ink-800 p-3 text-xs leading-5 text-ink-400"><p className="font-medium text-ink-300">{note.purpose==='revision'?'Sent for revision':'Training note'}</p><p className="mt-1 whitespace-pre-wrap">{long?`${note.body.slice(0,240)}…`:note.body}</p>{long&&<details className="mt-2"><summary className="cursor-pointer">Full saved note</summary><p className="mt-2 whitespace-pre-wrap">{note.body}</p></details>}</div>;
}
const sameSourceNote=(a:VisualTeachingDraft['sourceNote'],b:VisualTeachingDraft['sourceNote'])=>!a&&!b||!!a&&!!b&&a.body===b.body&&a.purpose===b.purpose;

/** Selection is a review choice only. Existing Desktop acceptance owns every write. */
export default function TrainingDraftBundle({drafts,busy,onApply,onEdit,onExplain,explanationFor}:{drafts:VisualTeachingDraft[];busy:boolean;onApply:(ids:string[])=>void;onEdit:(id:string)=>void;onExplain?:(id:string)=>void;explanationFor?:(id:string)=>ReactNode}){
  const [skipped,setSkipped]=useState<Set<string>>(()=>new Set()),[review,setReview]=useState<VisualTeachingDraft[]|null>(null);
  const confirming=useRef(false);
  const relationCopy:Record<string,string>={accepted:'keep this',rejected:'avoid this',contrast:'use this as a contrast',exception:'use this as an exception'};
  const keyFor=(draft:VisualTeachingDraft)=>`${draft.id}:${draft.digest}:${draft.relation||'unclassified'}:${draft.category}:${draft.relationOrigin||'model'}:${JSON.stringify(draft.sourceNote||null)}`;
  const selectable=(draft:VisualTeachingDraft)=>!!draft.relation&&!!relationCopy[draft.relation]&&!!draft.category.trim();
  const selected=drafts.filter(draft=>selectable(draft)&&!skipped.has(keyFor(draft)));
  const reviewCurrent=!!review?.length&&review.every(saved=>{const matches=drafts.filter(draft=>draft.id===saved.id);const current=matches[0];return matches.length===1&&current.digest===saved.digest&&current.relation===saved.relation&&current.category===saved.category&&(current.relationOrigin||'model')===(saved.relationOrigin||'model')&&current.judgment===saved.judgment&&sameSourceNote(current.sourceNote,saved.sourceNote)&&selectable(current);});
  function openReview(){confirming.current=false;setReview(selected.map(draft=>({...draft,...(draft.sourceNote?{sourceNote:{...draft.sourceNote}}:{})})));}
  function applyReviewed(){if(busy||!reviewCurrent||!review||confirming.current)return;confirming.current=true;onApply(review.map(draft=>draft.id));setReview(null);}

  if(!drafts.length&&!review)return null;
  return <section aria-label="Review proposed visual training" className="space-y-4">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-medium">Your agent will learn</h2><p className="mt-1 text-xs text-ink-400">Review the lesson. Keep the example as evidence.</p></div><span className="text-xs text-ink-500">{selected.length} selected</span></header>
    <div className={`grid gap-4 ${drafts.length>1?'md:grid-cols-2':'max-w-2xl'}`}>{drafts.map(draft=>{const key=keyFor(draft),included=selectable(draft)&&!skipped.has(key),relation=draft.relation&&relationCopy[draft.relation];return <article key={key} className={`rounded-xl border bg-ink-900/20 p-4 ${included?'border-ink-700':'border-ink-800 opacity-60'}`}>
      <div className="mb-4 flex items-start justify-between gap-3">{draft.renderEvidence}<label className="flex items-center gap-2 text-xs text-ink-400"><input type="checkbox" checked={included} disabled={busy||!selectable(draft)} onChange={()=>setSkipped(previous=>{const next=new Set(previous);if(included)next.add(key);else next.delete(key);return next;})}/>Include</label></div>
      <p className="text-sm leading-6 text-ink-100">{draft.judgment}</p><p className="mt-3 text-xs leading-5 text-ink-400"><span className="font-medium text-ink-300">Applies when </span>{draft.appliesWhen}</p>
      <div className="mt-3 rounded-lg bg-ink-950/50 p-3 text-xs leading-5 text-ink-300"><p>{draft.relationOrigin==='owner'?'Your choice:':'Implexa suggests:'} <strong>{relation||'classification needs review'}</strong></p><p className="mt-1 text-ink-500">{draft.category}</p>{!selectable(draft)&&<p className="mt-2 text-amber-300">Review this example’s type before applying.</p>}</div>
      {explanationFor?.(draft.id)}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs">{onExplain&&<button type="button" disabled={busy} className="text-ink-300" onClick={()=>onExplain(draft.id)}>✨ Explain</button>}<button type="button" disabled={busy} className="text-ink-300 underline underline-offset-4" onClick={()=>onEdit(draft.id)}>Review</button></div>
      <details className="mt-3 text-xs leading-5 text-ink-500"><summary className="cursor-pointer">Original example</summary><p className="mt-2 whitespace-pre-wrap">{draft.example}</p>{draft.sourceNote&&<SavedSourceNote note={draft.sourceNote}/>}</details>
    </article>;})}</div>
    <button type="button" className="btn-primary" disabled={busy||!selected.length} onClick={openReview}>{busy?'Saving training…':`Apply ${selected.length===1?'selected lesson':`${selected.length} selected lessons`}`}</button>
    <Modal open={review!==null} onClose={()=>{if(!busy)setReview(null);}} title="Apply these lessons?" subtitle="Review how each example will be used." maxWidth="max-w-2xl">
      <ul className="max-h-[55vh] space-y-4 overflow-y-auto">{review?.map(draft=><li key={`${draft.id}:${draft.digest}`} className="flex items-start gap-4 rounded-xl border border-ink-800 p-3">
        {draft.renderEvidence}<div className="min-w-0 flex-1"><p className="text-sm leading-6 text-ink-100">{draft.judgment}</p><p className="mt-2 text-xs text-ink-500">{draft.category}</p><p className="mt-1 text-xs text-ink-300">{draft.relationOrigin==='owner'?'Your choice:':'Suggested by Implexa:'} <strong>{draft.relation?relationCopy[draft.relation]:'needs review'}</strong></p>{draft.sourceNote&&<SavedSourceNote note={draft.sourceNote}/>}</div>
      </li>)}</ul>
      {!reviewCurrent&&<p role="alert" className="mt-4 text-sm text-amber-300">A selected lesson changed. Review the current lessons before applying.</p>}
      <div className="mt-5 flex flex-wrap items-center gap-4"><button type="button" className="btn-primary" disabled={busy||!reviewCurrent} onClick={applyReviewed}>Apply these lessons as shown</button>{!reviewCurrent&&<button type="button" className="text-sm text-ink-300 underline underline-offset-4" disabled={busy||!selected.length} onClick={openReview}>Review current lessons</button>}<button type="button" className="text-sm text-ink-400" disabled={busy} onClick={()=>setReview(null)}>Keep reviewing</button></div>
    </Modal>
    <p className="text-xs text-ink-500">Then test the update before making it live.</p>
  </section>;
}
