'use client';
import {useState} from 'react';
import type {GuidedTrainingChanges,TrainingChangeRecord} from '@/lib/guided-training-changes';
import Modal from '../../_components/modal';

type Target={eventId:string;eventDigest:string};
const reasonCopy:Record<string,string>={question:'This was a question; a clear preference has not been supplied.',tentative:'This was a tentative idea, not a settled instruction.',agent_change:'This needs an agent setup change, not a taste teaching.',authority_request:'This needs a separate permission or spending decision.',insufficient:'There was not enough information to prepare a teaching.',not_converted:'This part has not been converted into a saved teaching.',not_guidance:'This proposal did not express a settled preference.',proposal_refused_content:'A proposed teaching could not be safely delivered. Your original feedback is preserved.',proposal_excerpt_unmatched:'The proposal could not be linked to an exact excerpt of your feedback.',proposal_excerpt_ambiguous:'The quoted excerpt was repeated, so its source was ambiguous.',proposal_excerpt_overlap:'This proposed excerpt overlapped another teaching.',proposed_guidance:'Linked to a saved teaching.'};
const explain=(reason:string)=>reasonCopy[reason]||reason.replaceAll('_',' ');
export default function TrainingChanges({value,busy=false,onPolicy,onForce,onEdit,onRecord,onTest,onPublish,onImport,onWithdraw}:{
 value:GuidedTrainingChanges;busy?:boolean;onPolicy:(enabled:boolean,expected:GuidedTrainingChanges['policy'])=>void;onForce:(target:Target)=>void;
 onEdit:(record:TrainingChangeRecord)=>void;onRecord:(record:TrainingChangeRecord,action:'admit'|'remove'|'undo')=>void;onTest:(snapshotDigest:string)=>void;onPublish:(snapshotDigest:string)=>void;
 onImport?:(build:NonNullable<GuidedTrainingChanges['creationImports']>[number],noteIndex:number)=>void;
 onWithdraw?:(target:Target)=>void;
}){
 const [tab,setTab]=useState<'added'|'remaining'|'original'>('added'),[policyConsent,setPolicyConsent]=useState(false);
 const [withdrawing,setWithdrawing]=useState<Target|null>(null);
 const live=value.records.filter(r=>r.included),remaining=value.feedback.filter(f=>f.outcome!=='added');
 const button='text-xs text-ink-400 underline underline-offset-4 disabled:opacity-40';
 return <section className="space-y-5" aria-label="Your private training update">
  <header><p className="text-[10px] uppercase tracking-[.18em] text-ink-500">Your private update</p><h2 className="mt-2 text-lg font-medium">What Implexa learned</h2>
   <p className="mt-2 text-sm leading-6 text-ink-400">{live.length} included · {remaining.length} feedback item{remaining.length===1?'':'s'} not fully converted. Original feedback stays available. Private edits do not change a currently served or published snapshot.</p></header>
  <nav className="flex gap-5 border-b border-ink-800 text-xs" aria-label="Feedback coverage">{([['added','Included'],['remaining','Not converted'],['original','Original feedback']] as const).map(([id,label])=><button type="button" key={id} className={`border-b-2 pb-3 ${tab===id?'border-brand-500 text-ink-100':'border-transparent text-ink-500'}`} aria-current={tab===id?'page':undefined} onClick={()=>setTab(id)}>{label}</button>)}</nav>
  {onImport&&value.creationImports?.some(i=>i.importedNoteIndices.length<i.noteCount)&&<section className="rounded-xl border border-ink-800 p-4 text-sm" aria-label="Private notes from creation"><h3 className="font-medium">Bring your creation notes into Training</h3>
   <p className="mt-2 text-ink-400">These notes came from this agent’s completed build. Import preserves them as private source feedback; it does not accept a learning or change the definition.</p>
   {value.creationImports.map(i=><div key={`${i.buildRequestId}:${i.replyId}`} className="mt-3 space-y-3">{i.notes.map((note,n)=>i.importedNoteIndices.includes(n)?null:<div key={n}><p className="text-ink-300">{note}</p><button type="button" className={`${button} mt-2`} disabled={busy} onClick={()=>onImport(i,n)}>Import this private note</button></div>)}</div>)}
  </section>}
  {tab==='added'&&<div className="space-y-3">{value.records.map(r=><article key={r.recordId} className="rounded-xl border border-ink-800 p-4">
   <p className="text-sm leading-6">{r.summary||'This teaching is no longer available for use.'}</p><p className="mt-2 text-xs text-ink-500">{r.included?(r.admissionOrigin==='human_decision'?'Previously accepted by you · included in this private candidate':'Included in this private candidate'):r.state==='removed'?'Removed from this candidate':r.state==='retired'?'Removed from future updates':r.state==='revoked'?'Permission withdrawn':r.state==='discarded'?'Discarded':r.state==='unavailable'?'Unavailable · not included':'Suggested · not included'}{r.model?` · Prepared by ${r.model}`:''}</p>
   {r.admissionOrigin!=='none'&&<p className="mt-2 text-xs text-ink-500">{r.admissionOrigin==='standing_policy'?'Added by your standing policy':r.admissionOrigin==='owner_candidate'?'Added because you asked':'Your recorded human decision'}{r.policyReceiptId&&<span title={r.policyReceiptDigest||''}> · policy receipt {r.policyReceiptId.slice(0,8)}</span>}</p>}
   <div className="mt-3 flex gap-5"><button type="button" className={button} disabled={busy||!r.summary||['revoked','discarded','unavailable'].includes(r.state)} onClick={()=>onEdit(r)}>Change in chat</button>
    {r.included&&<button type="button" className={button} disabled={busy} onClick={()=>onRecord(r,'remove')}>Remove from this candidate</button>}
    {r.state==='suggested'&&<button type="button" className={button} disabled={busy} onClick={()=>onRecord(r,'admit')}>Include in private update</button>}
    {r.state==='removed'&&<button type="button" className={button} disabled={busy} onClick={()=>onRecord(r,'undo')}>Undo removal</button>}</div>
  </article>)}{value.records.length===0&&<p className="text-sm text-ink-500">No saved teaching yet. Explain a preference or annotate an example.</p>}</div>}
  {tab!=='added'&&<div className="space-y-3">{(tab==='remaining'?remaining:value.feedback).map(f=><article key={f.eventId} className="rounded-xl border border-ink-800 p-4 text-sm leading-6">
   <p className="mb-2 text-xs text-ink-500">{f.sourceKind==='creation_notes'?'Drafted by Implexa from your creation chat':f.sourceKind==='trainer_feedback'?'Your original feedback':'Saved source text'}</p>
   <p className="whitespace-pre-wrap">{f.text===null?'This feedback is withdrawn from further use. Original audit history remains retained.':f.text}</p><p className="mt-2 text-xs text-ink-500">{f.outcome==='not_analysed'?f.analysisStatus==='pending'?'Analysis pending':f.analysisStatus==='failed'?'Analysis failed · feedback preserved':f.analysisStatus==='unavailable'?'Analysis unavailable':'Not analysed yet':f.outcome==='not_converted'?'Not converted':f.outcome==='partly'?'Partly converted':'Converted to saved teaching'}</p>
   {f.reason&&<p className="mt-2 text-ink-400">{explain(f.reason)}</p>}{f.proposalOutcomes?.filter(o=>o.status==='refused'&&o.reason!==f.reason).map(o=><p key={o.candidateKey} className="mt-2 text-xs text-ink-400">{explain(o.reason)}</p>)}
   {f.uncoveredText.some(s=>s.trim())&&<div className="mt-3 text-ink-400"><p className="text-xs font-medium">Still uncovered</p>{f.uncoveredText.filter(s=>s.trim()).map((s,i)=><p key={i} className="mt-1 whitespace-pre-wrap">{s}</p>)}</div>}
   {f.outcome!=='added'&&<button type="button" className={`${button} mt-3`} disabled={busy||f.analysisStatus==='pending'||f.analysisStatus==='unavailable'} onClick={()=>onForce({eventId:f.eventId,eventDigest:f.eventDigest})}>Use as learning</button>}
   {onWithdraw&&tab==='original'&&f.text!==null&&<button type="button" className={`${button} mt-3 ml-5`} disabled={busy} onClick={()=>setWithdrawing({eventId:f.eventId,eventDigest:f.eventDigest})}>Withdraw this feedback from future use</button>}
  </article>)}{tab==='remaining'&&remaining.length===0&&<p className="text-sm text-ink-500">All analysed feedback is accounted for in saved teachings.</p>}</div>}
  <details className="rounded-xl border border-ink-800 p-4 text-sm"><summary className="cursor-pointer">How future feedback is included</summary>
   {value.policy.enabled?<><p className="mt-3 text-ink-400">Ordinary taste feedback is automatically included in this agent’s private candidate. It still needs a test before publication. Access, spending, tools and public release keep their separate approvals.</p><button type="button" className={`${button} mt-3`} disabled={busy} onClick={()=>onPolicy(false,value.policy)}>Stop automatic inclusion for future feedback</button></>:<>
    <label className="mt-3 flex items-start gap-3 text-ink-400"><input type="checkbox" className="mt-1" checked={policyConsent} disabled={busy} onChange={e=>setPolicyConsent(e.target.checked)}/><span>Automatically include ordinary taste suggestions in this agent’s private updates. Future text feedback may be analysed with Claude Haiku 5.5; images and recordings keep their separate analysis consent. This does not grant tools, spending or publication.</span></label>
    <button type="button" className={`${button} mt-3`} disabled={busy||!policyConsent} onClick={()=>onPolicy(true,value.policy)}>Enable private automatic inclusion</button></>}
  </details>
  <section className="rounded-xl border border-ink-800 p-4 text-sm" aria-label="Test this update"><h3 className="font-medium">Try it on a real task</h3>
   <p className="mt-2 text-ink-400">{value.test.status==='running'?'This exact update is being tested.':value.test.status==='stale'?'The update changed after its last test. Test the current snapshot before publishing.':value.test.status==='delivered'?'A test delivered. Its grade describes quality; it does not prove every learning caused a change.':value.test.status==='failed'?'The last test did not deliver. Its evidence is preserved.':'Run this private update before publishing it for other people.'}</p>
   {value.test.qualityScore!==null&&<p className="mt-3 font-medium">Quality: {value.test.qualityScore}/100</p>}
   {value.test.gaps.length>0&&<ul className="mt-3 list-disc space-y-1 pl-5 text-ink-400">{value.test.gaps.map((gap,i)=><li key={i}>{gap}</li>)}</ul>}
   <div className="mt-4 flex gap-5"><button type="button" className="btn-primary" disabled={busy||!value.test.canTest||value.test.status==='running'} onClick={()=>onTest(value.binding.snapshotDigest)}>Run with updates</button>
    <button type="button" className={button} disabled={busy||!value.publication.canPublish} onClick={()=>onPublish(value.publication.proposedSnapshotDigest||value.binding.snapshotDigest)}>Review publication</button></div>
   {value.publication.reason&&<p className="mt-3 text-xs text-ink-500">{value.publication.reason}</p>}
  </section>
  <Modal open={!!withdrawing} onClose={()=>setWithdrawing(null)} title="Withdraw this feedback?">
   <p className="text-sm leading-6 text-ink-300">This stops further use of this feedback and derived teachings, including releases. It is a privacy withdrawal, not removal from one candidate. Original history remains retained; this does not erase it.</p>
   <div className="mt-5 flex gap-4"><button type="button" className={button} disabled={busy} onClick={()=>setWithdrawing(null)}>Keep available</button><button type="button" className="btn-primary" disabled={busy||!withdrawing} onClick={()=>{if(withdrawing){onWithdraw?.(withdrawing);setWithdrawing(null);}}}>Withdraw feedback</button></div>
  </Modal>
 </section>;
}
