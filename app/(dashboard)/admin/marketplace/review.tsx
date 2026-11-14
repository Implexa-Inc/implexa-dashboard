'use client';
import {useEffect,useState} from 'react';
type Entry={id:string;name:string;studioName:string;revision:number;versionId:string};
export default function MarketplaceReview(){
 const [entries,setEntries]=useState<Entry[]>([]),[selected,setSelected]=useState<any>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[note,setNote]=useState('');
 async function load(id?:string){setBusy(true);setError('');setNote('');if(id)setSelected(null);try{
  const r=await fetch(`/api/admin/marketplace-submissions${id?`?id=${encodeURIComponent(id)}`:''}`,{cache:'no-store'}),v=await r.json();
  if(!r.ok||v.ok!==true)throw Error();if(id)setSelected(v.submission);else setEntries(v.submissions);
 }catch{setError('The review could not be loaded. Try again.');}finally{setBusy(false);}}
 useEffect(()=>{void load();},[]);
 async function decide(decision:'approved'|'rejected'|'revoked'){
  if(!selected)return;setBusy(true);setError('');setNote('');try{
   const r=await fetch('/api/admin/marketplace-submissions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({submissionId:selected.id,expectedReviewId:selected.review?.id||null,payloadDigest:selected.payloadDigest,decision,reason:decision==='approved'?'Approved metadata for the two-account beta.':'Kept off the beta marketplace.'})}),v=await r.json();
   if(!r.ok||!v.ok){setError(v.reason==='submission_changed'?'This submission is no longer current. Reopen it before approving.':v.reason==='review_changed'?'Another review was saved. Reopen this submission.':'The review could not be saved. Try again.');return;}
   setSelected({...selected,review:{id:v.reviewId,submission_id:selected.id,decision:v.decision}});setNote(decision==='approved'?'Approved for the beta marketplace.':'Kept off the marketplace.');
  }catch{setError('The review could not be saved. Reopen it to check the result.');}finally{setBusy(false);}
 }
 return <section className="mt-8 space-y-5">{error&&<p role="alert" className="text-amber-300">{error}</p>}{note&&<p role="status" className="text-emerald-400">{note}</p>}
 <button disabled={busy} className="btn-secondary" onClick={()=>void load()}>Refresh submissions</button>
 <div className="flex flex-wrap gap-3">{entries.map(e=><button key={e.id} disabled={busy} className="rounded-xl border border-ink-700 p-4 text-left" onClick={()=>void load(e.id)}><strong>{e.name}</strong><span className="mt-2 block text-sm text-ink-400">{e.studioName} · Submitted revision {e.revision}</span></button>)}</div>
 {!busy&&!error&&!entries.length&&<p>No submitted listings.</p>}
 {selected&&<article className="space-y-5 rounded-2xl border border-ink-700 p-6"><h2 className="text-2xl">{selected.listing.name}</h2><p>{selected.listing.studioName} · {selected.listing.category} · Revision {selected.revision}</p>
 <p className="text-sm text-ink-400">Customer provides: {selected.listing.input}</p><p className="text-sm">Customer receives: {selected.listing.output}</p>
 <p>${(selected.listing.servicePriceCents/100).toFixed(2)} / {selected.listing.pricePeriod==='per_run'?'run':'month'} · proposed service price</p>
 <section><h3 className="font-medium">Owner-approved samples</h3>{selected.samples.map((s:any)=><p key={s.artifactId} className="mt-2 text-sm text-ink-300">{s.filename} · {s.sizeBytes?`${(s.sizeBytes/1048576).toFixed(1)} MB`:'Size unavailable'}<span className="block text-xs text-ink-500">SHA-256 {s.sha256}</span></p>)}<p className="mt-3 text-sm text-ink-400">Playback is not hosted yet. Approval covers listing metadata and the sample selection; it does not claim a new visual review.</p></section>
 <section><h3 className="font-medium">Tools</h3>{selected.listing.tools.map((t:any)=><p key={t.id} className="mt-2 text-sm">{t.id} · {t.mode==='included'?'Proposed inclusion; funding setup required':t.mode==='customer_connects'?'Customer connects account':'Not included'}</p>)}</section>
 {selected.review&&<p className="text-sm text-ink-400">Latest beta decision: {selected.review.decision}</p>}
 {!selected.canApprove&&<p className="text-amber-300">The submitted agent or sample is no longer eligible. It cannot be approved.</p>}
 {selected.review?.submission_id===selected.id&&['rejected','revoked','owner_retracted'].includes(selected.review.decision)&&<p className="text-sm text-ink-400">A new submission is needed before this listing can be approved again.</p>}
 <div className="flex flex-wrap gap-3"><button disabled={busy||!selected.canApprove||selected.review?.submission_id===selected.id&&selected.review.decision!=='approved'} className="btn-primary" onClick={()=>void decide('approved')}>Approve beta listing</button><button disabled={busy} className="btn-secondary" onClick={()=>void decide(selected.review?.submission_id===selected.id&&selected.review?.decision==='approved'?'revoked':'rejected')}>Keep off marketplace</button><button disabled={busy} className="btn-secondary" onClick={()=>void load(selected.id)}>Reopen submission</button></div></article>}
 </section>;
}
