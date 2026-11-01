'use client';
import {useState,type ReactNode} from 'react';
import {TrainingInfo} from './training-workspace';
import {trainingSnapshotReason,type GuidedTrainingChanges,type TrainingChangeRecord} from '@/lib/guided-training-changes';
import Modal from '../../_components/modal';

type Target={eventId:string;eventDigest:string};
const reasonCopy:Record<string,string>={question:'This was a question; a clear preference has not been supplied.',tentative:'This was a tentative idea, not a settled instruction.',agent_change:'This needs an agent setup change, not a taste teaching.',authority_request:'This needs a separate permission or spending decision.',insufficient:'There was not enough information to prepare a teaching.',not_converted:'This part has not been converted into a saved teaching.',not_guidance:'This proposal did not express a settled preference.',proposal_refused_content:'A proposed teaching could not be safely delivered. Your original feedback is preserved.',proposal_excerpt_unmatched:'The proposal could not be linked to an exact excerpt of your feedback.',proposal_excerpt_ambiguous:'The quoted excerpt was repeated, so its source was ambiguous.',proposal_excerpt_overlap:'This proposed excerpt overlapped another teaching.',proposed_guidance:'Linked to a saved teaching.'};
const explain=(reason:string)=>reasonCopy[reason]||(/^(training_|publication_)/.test(reason)?trainingSnapshotReason(reason):reason.replaceAll('_',' '));
export default function TrainingChanges({value,busy=false,onPolicy,onForce,onEdit,onRecord,onTest,onPublish,onImport,onWithdraw,onActivate,renderExample,captionFor,versionPicker,hideRunPanel=false}:{
 hideRunPanel?:boolean;captionFor?:(record:TrainingChangeRecord)=>string|null;renderExample?:(record:TrainingChangeRecord,index:number)=>ReactNode;versionPicker?:ReactNode;
 value:GuidedTrainingChanges;busy?:boolean;onPolicy:(enabled:boolean,expected:GuidedTrainingChanges['policy'])=>void;onForce:(target:Target)=>void;
 onEdit:(record:TrainingChangeRecord)=>void;onRecord:(record:TrainingChangeRecord,action:'admit'|'remove'|'undo')=>void;onTest:(snapshotDigest:string)=>void;onPublish:(snapshotDigest:string)=>void;
 onImport?:(build:NonNullable<GuidedTrainingChanges['creationImports']>[number],noteIndex:number)=>void;
 onWithdraw?:(target:Target)=>void;
 onActivate?:(snapshotDigest:string,testRequestId:string)=>void;
}){
 const [tab,setTab]=useState<'added'|'remaining'|'original'>('added'),[policyConsent,setPolicyConsent]=useState(false);
 const [withdrawing,setWithdrawing]=useState<Target|null>(null);
 const live=value.records.filter(r=>r.included),remaining=value.feedback.filter(f=>f.outcome!=='added');
 const button='text-xs text-ink-400 underline underline-offset-4 disabled:opacity-40';
 return <section className="space-y-5" aria-label="Your private training update">
  <header className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2"><h2 className="text-xl font-medium tracking-tight">Learnings</h2><TrainingInfo label="About your training update">{live.length} included · {remaining.length} feedback item{remaining.length===1?'':'s'} not fully converted. Original feedback stays available. Private edits do not change a currently served or published snapshot.</TrainingInfo></div>{versionPicker}</header>
  <nav className="flex gap-5 border-b border-ink-800 text-xs" aria-label="Feedback coverage">{([['added','Included'],['remaining',`Not converted${remaining.length?` (${remaining.length})`:''}`],['original','Original feedback']] as const).map(([id,label])=><button type="button" key={id} className={`border-b-2 pb-3 ${tab===id?'border-brand-500 text-ink-100':'border-transparent text-ink-500'}`} aria-current={tab===id?'page':undefined} onClick={()=>setTab(id)}>{label}</button>)}</nav>
  {onImport&&value.creationImports?.some(i=>i.importedNoteIndices.length<i.noteCount)&&<section className="rounded-xl border border-ink-800 p-4 text-sm" aria-label="Private notes from creation"><h3 className="font-medium">Bring your creation notes into Training</h3>
   <p className="mt-2 text-ink-400">These notes came from this agent’s completed build. Import preserves them as private source feedback; it does not accept a learning or change the definition.</p>
   {value.creationImports.map(i=><div key={`${i.buildRequestId}:${i.replyId}`} className="mt-3 space-y-3">{i.notes.map((note,n)=>i.importedNoteIndices.includes(n)?null:<div key={n}><p className="text-ink-300">{note}</p><button type="button" className={`${button} mt-2`} disabled={busy} onClick={()=>onImport(i,n)}>Import this private note</button></div>)}</div>)}
  </section>}
  {tab==='added'&&<div className="space-y-3">{value.records.map((r,index)=><details key={r.recordId} className="group border-b border-ink-800 py-4">
   <summary className="flex cursor-pointer list-none items-center gap-4 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500 [&::-webkit-details-marker]:hidden">
    {r.summary&&renderExample?.(r,index)}<span className="min-w-0 flex-1"><span className="block text-sm leading-6 text-ink-200">{teachingCaption(captionFor?.(r)||r.summary)}</span><span className="mt-1 block text-xs text-ink-500">{r.included?'Included':r.state==='suggested'?'Suggested':r.state==='removed'?'Removed':r.state==='revoked'?'Permission withdrawn':r.state==='retired'?'Stopped':r.state==='discarded'?'Discarded':'Unavailable'}</span></span><span aria-hidden="true" className="text-ink-500 transition group-open:rotate-90">›</span>
   </summary><div className="pt-4 text-sm leading-6"><p className="whitespace-pre-wrap">{r.summary||'This teaching is no longer available for use.'}</p><p className="mt-2 text-xs text-ink-500">{r.included?(r.admissionOrigin==='human_decision'?'Previously accepted by you · included in this private candidate':'Included in this private candidate'):r.state==='removed'?'Removed from this candidate':r.state==='retired'?'Removed from future updates':r.state==='revoked'?'Permission withdrawn':r.state==='discarded'?'Discarded':r.state==='unavailable'?'Unavailable · not included':'Suggested · not included'}{r.model?` · Prepared by ${r.model}`:''}</p>
   {r.admissionOrigin!=='none'&&<p className="mt-2 text-xs text-ink-500">{r.admissionOrigin==='standing_policy'?'Added by your standing policy':r.admissionOrigin==='owner_candidate'?'Added because you asked':'Your recorded human decision'}{r.policyReceiptId&&<span title={r.policyReceiptDigest||''}> · policy receipt {r.policyReceiptId.slice(0,8)}</span>}</p>}
   <div className="mt-3 flex gap-5"><button type="button" className={button} disabled={busy||!r.summary||['revoked','discarded','unavailable'].includes(r.state)} onClick={()=>onEdit(r)}>{r.sourceKind==='legacy_evidence'?'Review original example':'Change in chat'}</button>
    {r.included&&<button type="button" className={button} disabled={busy} onClick={()=>onRecord(r,'remove')}>Remove from this candidate</button>}
    {r.state==='suggested'&&<button type="button" className={button} disabled={busy} onClick={()=>onRecord(r,'admit')}>Include in private update</button>}
    {r.state==='removed'&&<button type="button" className={button} disabled={busy} onClick={()=>onRecord(r,'undo')}>Undo removal</button>}</div>
  </div></details>)}{value.records.length===0&&<p className="text-sm text-ink-500">No saved teaching yet. Explain a preference or annotate an example.</p>}</div>}
  {tab!=='added'&&<div className="space-y-3">{(tab==='remaining'?remaining:value.feedback).map(f=><article key={f.eventId} className="rounded-xl border border-ink-800 p-4 text-sm leading-6">
   <p className="mb-2 text-xs text-ink-500">{f.sourceKind==='creation_notes'?'Drafted by Implexa from your creation chat':f.sourceKind==='trainer_feedback'?'Your original feedback':'Saved source text'}</p>
   <p className="whitespace-pre-wrap">{f.text===null?'This feedback is withdrawn from further use. Original audit history remains retained.':f.text}</p><p className="mt-2 text-xs text-ink-500">{f.analysisStatus==='unavailable'?'Withdrawn · content hidden':f.outcome==='not_analysed'?f.analysisStatus==='pending'?'Analysis pending':f.analysisStatus==='failed'?'Analysis failed · feedback preserved':'Not analysed yet':f.outcome==='not_converted'?'Not converted':f.outcome==='partly'?'Partly converted':'Converted to saved teaching'}</p>
   {f.reason&&<p className="mt-2 text-ink-400">{explain(f.reason)}</p>}{f.proposalOutcomes?.filter(o=>o.status==='refused'&&o.reason!==f.reason).map(o=><p key={o.candidateKey} className="mt-2 text-xs text-ink-400">{explain(o.reason)}</p>)}
   {f.uncoveredText.some(s=>s.trim())&&<div className="mt-3 text-ink-400"><p className="text-xs font-medium">Still uncovered</p>{f.uncoveredText.filter(s=>s.trim()).map((s,i)=><p key={i} className="mt-1 whitespace-pre-wrap">{s}</p>)}</div>}
   {f.outcome!=='added'&&<button type="button" className={`${button} mt-3`} disabled={busy||f.analysisStatus==='pending'||f.analysisStatus==='unavailable'} onClick={()=>onForce({eventId:f.eventId,eventDigest:f.eventDigest})}>Use as learning</button>}
   {onWithdraw&&tab==='original'&&f.text!==null&&<button type="button" className={`${button} mt-3 ml-5`} disabled={busy} onClick={()=>setWithdrawing({eventId:f.eventId,eventDigest:f.eventDigest})}>Withdraw this feedback from future use</button>}
  </article>)}{tab==='remaining'&&remaining.length===0&&<p className="text-sm text-ink-500">All analysed feedback is accounted for in saved teachings.</p>}</div>}
  <details className="text-sm text-ink-400"><summary className="cursor-pointer">How future feedback is included</summary>
   {value.policy.enabled?<><p className="mt-3 text-ink-400">Ordinary taste feedback is automatically included in this agent’s private candidate. It still needs a test before publication. Access, spending, tools and public release keep their separate approvals.</p><button type="button" className={`${button} mt-3`} disabled={busy} onClick={()=>onPolicy(false,value.policy)}>Stop automatic inclusion for future feedback</button></>:<>
    <label className="mt-3 flex items-start gap-3 text-ink-400"><input type="checkbox" className="mt-1" checked={policyConsent} disabled={busy} onChange={e=>setPolicyConsent(e.target.checked)}/><span>Automatically include ordinary taste suggestions in this agent’s private updates. Future text feedback may be analysed with Claude Haiku 5.5; images and recordings keep their separate analysis consent. This does not grant tools, spending or publication.</span></label>
    <button type="button" className={`${button} mt-3`} disabled={busy||!policyConsent} onClick={()=>onPolicy(true,value.policy)}>Enable private automatic inclusion</button></>}
  </details>
  {!hideRunPanel&&<TrainingRunPanel value={value} busy={busy} onTest={onTest} onPublish={onPublish} onActivate={onActivate}/>}

  <Modal open={!!withdrawing} onClose={()=>setWithdrawing(null)} title="Withdraw this feedback?">
   <p className="text-sm leading-6 text-ink-300">This stops further use of this feedback and derived teachings, including releases. It is a privacy withdrawal, not removal from one candidate. Original history remains retained; this does not erase it.</p>
   <div className="mt-5 flex gap-4"><button type="button" className={button} disabled={busy} onClick={()=>setWithdrawing(null)}>Keep available</button><button type="button" className="btn-primary" disabled={busy||!withdrawing} onClick={()=>{if(withdrawing){onWithdraw?.(withdrawing);setWithdrawing(null);}}}>Withdraw feedback</button></div>
  </Modal>
 </section>;
}

/** A short excerpt from saved wording, never a new AI interpretation. Full text expands. */
export function teachingCaption(summary:string|null){
 if(!summary)return 'Teaching unavailable';
 const preferred=summary.match(/Desired behavior:\s*([\s\S]*)/i)?.[1]||summary.match(/Chosen:\s*([\s\S]*?)(?:\s+Why:|$)/i)?.[1]||summary;
 const excerpt=preferred.match(/^([\s\S]*?[.!?])(?:\s|$)/)?.[1]||preferred;
 return excerpt.length>170?`${excerpt.slice(0,167).trimEnd()}…`:excerpt;
}

/** Keep the live run controller mounted independently of learning-history tabs. */
export function TrainingRunPanel({value,actions,busy=false,onTest,onPublish,onActivate}:{value:GuidedTrainingChanges|null;actions?:ReactNode;busy?:boolean;onTest:(digest:string)=>void;onPublish:(digest:string)=>void;onActivate?:(digest:string,testRequestId:string)=>void}){
 const button='text-xs text-ink-400 underline underline-offset-4 disabled:opacity-40';
 return (<section className="border-t border-ink-800 pt-6 text-sm" aria-label="Test this update"><h3 className="font-medium">Run your agent</h3>{actions}{!value&&<p className="mt-2 text-xs text-ink-500">Pending training status unavailable.</p>}{value&&<><details className="mt-2 text-xs text-ink-400"><summary className="cursor-pointer">Test details</summary>
   {value.records.some(r=>r.included&&r.sourceKind!=='legacy_evidence')&&<p className="mt-2 text-ink-400">Text guidance currently requires the Codex executor and Implexa Desktop 0.4.160 or newer. Use the prepared Run now path; a delivery without its managed verification receipts cannot qualify this update.</p>}
   {value.selectionCoverage&&value.selectionCoverage.eligibleTextByStage.length>0&&<div className="mt-3 space-y-2 text-xs text-ink-400"><p>At most {value.selectionCoverage.maxStandingReferences} stage-start references, across text and images, fit each stage. Eligibility does not mean delivery: exact run receipts show what was selected; remaining guidance may be deferred.</p><ul>{value.selectionCoverage.eligibleTextByStage.map(s=><li key={s.stage}>{s.stage.replaceAll('_',' ')}: {s.count} eligible text teachings.</li>)}</ul></div>}
   <p className="mt-2 text-ink-400">{value.test.status==='prepared'?'This update is frozen for a test. Choose its inputs in the run form before starting.':value.test.status==='queued'?'The test is queued.':value.test.status==='running'?'This exact update is being tested.':value.test.status==='stale'?'The update changed after its last test. Test the current snapshot before publishing.':value.test.status==='delivered'?'A matching test delivered. Its grade describes quality; it does not prove every learning caused a change.':['failed','cancelled','blocked'].includes(value.test.status)?'The last test did not deliver. Its evidence is preserved.':'Run this private update before publishing it for other people.'}</p>
   {value.test.qualityScore!==null&&<p className="mt-3 font-medium">Quality: {value.test.qualityScore}/100</p>}
   {value.test.gaps.length>0&&<ul className="mt-3 list-disc space-y-1 pl-5 text-ink-400">{value.test.gaps.map((gap,i)=><li key={i}>{explain(gap)}</li>)}</ul>}
   </details>{!actions&&<><p className="mt-2 text-sm text-ink-400">{value.test.status==='delivered'?'Test delivered':value.test.status==='running'?'Test running':value.test.status==='queued'?'Test queued':value.test.status==='stale'?'Updates ready for a new test':value.test.status==='prepared'?'Test ready to start':['failed','cancelled','blocked'].includes(value.test.status)?'Last test needs attention':'Test before publishing'}{value.test.qualityScore!==null?` · ${value.test.qualityScore}/100`:''}</p><div className="mt-4 flex flex-wrap items-center gap-5"><button type="button" className="btn-primary" disabled={busy||!value.test.canTest||value.test.status==='running'} onClick={()=>onTest(value.binding.snapshotDigest)}>Run with updates</button>
    </div></> }<details className="mt-4 text-xs text-ink-400"><summary className="cursor-pointer">Manage live training</summary><div className="mt-3"><button type="button" className={button} disabled={busy||!value.publication.canPrepare} onClick={()=>onPublish(value.publication.proposedSnapshotDigest||value.binding.snapshotDigest)}>Review publication</button></div>
   {value.activation&&<div className="mt-4 space-y-2 text-xs text-ink-400"><details><summary className="cursor-pointer">Serving details</summary><p>{value.activation.servedSnapshotDigest?'Runs keep using the served training until you activate a tested update.':'Existing accepted training stays live until your first tested activation.'}</p>
    {value.activation.withdrawnSinceTest>0&&<p>{value.activation.withdrawnSinceTest} teaching{value.activation.withdrawnSinceTest===1?' is':'s are'} withdrawn since the served test; those teachings are excluded.</p>}
    {(value.activation.stoppedSinceTest||0)>0&&<p>{value.activation.stoppedSinceTest} teaching{value.activation.stoppedSinceTest===1?'':'s'} stopped for new runs since the served test. Earlier-running tasks keep their frozen taste; privacy withdrawal still stops further access immediately.</p>}
    </details><button id="training-activation" type="button" className={button} disabled={busy||!onActivate||!value.activation.canActivate||!value.activation.testRequestId} onClick={()=>{if(value.activation?.testRequestId)onActivate?.(value.binding.snapshotDigest,value.activation.testRequestId);}}>Use this tested update</button>
    {value.activation.reason&&<p>{explain(value.activation.reason)}</p>}
   </div>}
   {value.publication.reason&&<p className="mt-3 text-xs text-ink-500">{explain(value.publication.reason)}</p>}</details>
  </>}</section>);
}
