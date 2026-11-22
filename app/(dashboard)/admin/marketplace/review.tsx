'use client';
import {useEffect,useState} from 'react';
import {sampleUrl} from '../../training/[slug]/marketplace-samples';
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
   const next={id:v.reviewId,submission_id:selected.id,decision:v.decision};
   setSelected({...selected,review:next,targetReview:next,effectiveReview:decision==='rejected'?selected.effectiveReview:next});setNote(decision==='approved'?'Approved for the beta marketplace.':decision==='rejected'?'Proposed listing rejected. Any earlier approved listing is unchanged.':'Removed from the beta marketplace.');
  }catch{setError('The review could not be saved. Reopen it to check the result.');}finally{setBusy(false);}
 }
 return <section className="mt-8 space-y-5">{error&&<p role="alert" className="text-state-needs">{error}</p>}{note&&<p role="status" className="text-state-ok">{note}</p>}
 <button disabled={busy} className="btn-secondary" onClick={()=>void load()}>Refresh submissions</button>
 <div className="flex flex-wrap gap-3">{entries.map(e=><button key={e.id} disabled={busy} className="rounded-xl border border-ink-700 p-4 text-left" onClick={()=>void load(e.id)}><strong>{e.name}</strong><span className="mt-2 block text-secondary text-ink-400">{e.studioName} · Submitted revision {e.revision}</span></button>)}</div>
 {!busy&&!error&&!entries.length&&<p>No submitted listings.</p>}
 {selected&&<article className="space-y-5 rounded-2xl border border-ink-700 p-6">{selected.listing?<><h2 className="text-2xl">{selected.listing.name}</h2><p>{selected.listing.studioName} · {selected.listing.category} · Revision {selected.revision}</p>
 <p className="text-reading text-ink-400">Customer provides: {selected.listing.input}</p><p className="text-reading">Customer receives: {selected.listing.output}</p>
 <p>${(selected.listing.servicePriceCents/100).toFixed(2)} / {selected.listing.pricePeriod==='per_run'?'run':'month'} · proposed service price</p></>:<p role="alert">This submission contains restricted information. Its wording is hidden and it can only be rejected.</p>}
 <section><h3 className="font-medium">Owner-approved samples</h3>{selected.samples.map((s:any)=><p key={s.mediaId||s.artifactId} className="mt-2 text-reading text-ink-300">{s.mediaId&&!s.unavailable&&<a href={sampleUrl(s.mediaId,'preview')} target="_blank" rel="noreferrer" className="block"><img src={sampleUrl(s.mediaId)} alt={s.filename} className="aspect-video max-w-xs rounded-lg object-cover"/><span className="underline">Preview trainer-provided example</span></a>}{s.filename} · {s.sizeBytes?`${(s.sizeBytes/1048576).toFixed(1)} MB`:'Size unavailable'}<span className="block text-secondary text-ink-500">SHA-256 {s.sha256}</span></p>)}<p className="mt-3 text-reading text-ink-400">{selected.samples.some((s:any)=>s.mediaId&&!s.unavailable)?'Uploaded examples have private previews above. Run outputs remain on the owner’s Mac. A trainer-provided example is not proof that the agent produced it.':'Playback is not hosted yet for these run outputs. They remain on the owner’s Mac.'}</p></section>
 {selected.listing&&<section><h3 className="font-medium">Tools</h3>{selected.listing.tools.map((t:any)=><p key={t.id} className="mt-2 text-reading">{t.id} · {t.mode==='included'?'Proposed inclusion; funding setup required':t.mode==='customer_connects'?'Customer connects account':'Not included'}</p>)}</section>}
 {selected.review&&<p className="text-reading text-ink-400">Latest beta decision: {selected.review.decision}</p>}
 {!selected.canApprove&&<p className="text-state-needs">The submitted agent or sample is no longer eligible. It cannot be approved.</p>}
 {selected.targetReview&&selected.targetReview.decision!=='approved'&&<p className="text-reading text-ink-400">A new submission is needed before this listing can be approved again.</p>}
 <div className="flex flex-wrap gap-3"><button disabled={busy||!selected.canApprove||!!selected.targetReview&&selected.targetReview.decision!=='approved'} className="btn-primary" onClick={()=>void decide('approved')}>Approve beta listing</button>
 {selected.effectiveReview?.submission_id===selected.id&&selected.effectiveReview?.decision==='approved'?<button disabled={busy} className="btn-secondary" onClick={()=>void decide('revoked')}>Remove approved listing</button>:<button disabled={busy||!selected.latestSubmitted||!!selected.targetReview} className="btn-secondary" onClick={()=>void decide('rejected')}>Reject proposed listing</button>}
 <button disabled={busy} className="btn-secondary" onClick={()=>void load(selected.id)}>Reopen submission</button></div></article>}
 </section>;
}
