'use client';
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {TrainingInfo,RunImage} from './training-workspace';
import type {ReviewArtifact} from '@/lib/review';

type ToolOffer={id:string;mode:'customer_connects'|'included'|'not_offered';credits:number;markupPercent:number};
type Listing={name:string;studioName:string;category:string;input:string;output:string;servicePriceCents:number;pricePeriod:'per_run'|'per_month';sampleIds:string[];sampleReleaseConsent:boolean;tools:ToolOffer[]};
type Price={creditsPerClip:number;centsPerCredit:number;currency:string;model:string;durationSeconds:number;sourceUrl:string;checkedAt:string;validUntil:string};
type Context={ok:true;contractVersion:string;agent:{id:string;versionId:string;name:string};bindingDigest:string;canSubmit:boolean;
 tools:{id:string;name:string;required:boolean;provider:string|null;canInclude:boolean;canCustomerConnect:boolean;origin:string;accessMode:string}[];
 samples:(ReviewArtifact&{date:string})[];engines:string[];defaults:Listing;runwayPrice:Price;
 draft:{id:string;revision:number;state:string;version_id:string;payload:{listing:Listing;bindingDigest:string};created_at:string}|null;
 submission:{id:string;revision:number;state:string;version_id:string;created_at:string}|null;
 submissionReview?:{status:string;decision?:string|null};
 review?:{status:string;id?:string;submissionId?:string;decision?:string|null;visibility?:string;hiddenReason?:string|null}};
const money=(cents:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(cents/100);
const field='mt-2 w-full rounded-xl border border-ink-700 bg-ink-950 p-3 text-sm text-ink-100';
const errors:Record<string,string>={listing_changed:'Your agent changed. Reload the saved draft to use its current setup.',listing_revision_changed:'This draft was saved elsewhere. Reload the saved draft before editing.',tested_publication_required:'Test and publish this version’s training before submitting.',sample_release_required:'Choose a sample and confirm you can show it.',tool_price_needs_refresh:'The tool rate needs a fresh check before this offer can be saved.',marketplace_submission_unavailable:'The listing could not be loaded or saved. Try again.',invalid_listing:'Check the listing fields and tool limits.',invalid_tool_price:'Use 60–10,000 whole API credits and 0–20% markup.'};

export default function MarketplaceSubmission({slug,versionId}:{slug:string;versionId:string|null}){
 const [context,setContext]=useState<Context|null>(null),[listing,setListing]=useState<Listing|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[note,setNote]=useState(''),[revision,setRevision]=useState(0),[moreSamples,setMoreSamples]=useState(false),[submittedRevision,setSubmittedRevision]=useState<number|null>(null);
 const scope=useRef(0);
 useEffect(()=>{void load();return()=>{scope.current++;};},[slug,versionId]);
 async function load(){
  const captured=++scope.current;setBusy(true);setError('');setNote('');setContext(null);setListing(null);setRevision(0);setSubmittedRevision(null);setMoreSamples(false);
  try{const response=await fetch(`/api/agent-training/marketplace-submission?slug=${encodeURIComponent(slug)}`,{cache:'no-store'});const c=await response.json();
   if(captured!==scope.current)return;
   if(!response.ok||c.ok!==true||c.contractVersion!=='marketplace-submission.v1'||!c.agent?.versionId||(versionId&&c.agent.versionId!==versionId))throw Error(c.reason||'listing_changed');
   setContext(c);setRevision(c.draft?.revision||0);setSubmittedRevision(c.submission?.revision||null);
   const same=c.draft?.version_id===c.agent.versionId;
   const prior=same?c.draft.payload.listing:null;
   setListing(prior?{...prior,sampleReleaseConsent:false,sampleIds:prior.sampleIds.filter((id:string)=>c.samples.some((s:ReviewArtifact)=>s.id===id)),
    tools:c.defaults.tools.map((t:ToolOffer)=>{const saved=prior.tools.find((p:ToolOffer)=>p.id===t.id),tool=c.tools.find((x:{id:string})=>x.id===t.id);return saved?{id:saved.id,mode:saved.mode==='customer_connects'&&tool.canCustomerConnect===false?'not_offered':saved.mode,credits:saved.credits||60,markupPercent:saved.markupPercent||0}:t;})}:c.defaults);
   if(same&&c.draft.payload.bindingDigest!==c.bindingDigest)setNote('Your agent’s setup changed. Review this draft before saving it again.');
   else if(same&&c.draft.state==='submitted')setNote('Submitted for review. Publication is a separate step.');
  }catch(e){if(captured===scope.current)setError(errors[(e as Error).message]||errors.marketplace_submission_unavailable);}
  finally{if(captured===scope.current)setBusy(false);}
 }
 function change<K extends keyof Listing>(key:K,value:Listing[K]){setNote('');setListing(l=>l?{...l,[key]:value,...(key==='sampleIds'?{sampleReleaseConsent:false}:{})}:l);}
 function toolChange(id:string,patch:Partial<ToolOffer>){if(listing)change('tools',listing.tools.map(t=>t.id===id?{...t,...patch}:t));}
 async function save(action:'save'|'submit'){
  if(!context||!listing)return;const captured=scope.current;setBusy(true);setError('');setNote('');
  try{const response=await fetch(`/api/agent-training/marketplace-submission?slug=${encodeURIComponent(slug)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,expectedRevision:revision,bindingDigest:context.bindingDigest,listing})});const result=await response.json();
   if(captured!==scope.current)return;
   if(!response.ok||result.ok!==true||!result.submission||result.submission.revision!==revision+1)throw Error(result.reason||'marketplace_submission_unavailable');
   setRevision(result.submission.revision);if(action==='submit'){setSubmittedRevision(result.submission.revision);setContext({...context,submission:{...result.submission},submissionReview:{status:'ready',decision:null}});}setNote(action==='submit'?'Submitted for review. Publication is a separate step.':'Draft saved.');
  }catch(e){if(captured===scope.current)setError(errors[(e as Error).message]||errors.marketplace_submission_unavailable);}
  finally{if(captured===scope.current)setBusy(false);}
 }
 async function retract(){
  if(!context?.review?.id||!context.review.submissionId)return;const captured=scope.current;setBusy(true);setError('');
  try{const r=await fetch(`/api/agent-training/marketplace-submission?slug=${encodeURIComponent(slug)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'retract',submissionId:context.review.submissionId,expectedReviewId:context.review.id})});const v=await r.json();
   if(captured!==scope.current)return;if(!r.ok||!v.ok)throw Error();setContext({...context,submissionReview:context.review.submissionId===context.submission?.id?{status:'ready',decision:'owner_retracted'}:context.submissionReview,review:{...context.review,id:v.reviewId,decision:'owner_retracted',visibility:undefined,hiddenReason:null}});setNote('Removed from the beta marketplace. Your agent and training are unchanged.');
  }catch{if(captured===scope.current)setError('Could not remove the listing. Reload the page to check the result.');}finally{if(captured===scope.current)setBusy(false);}
 }
 async function polish(){
  if(!context)return;const captured=scope.current;setBusy(true);setError('');
  try{const response=await fetch(`/api/agent-training/marketplace-submission?slug=${encodeURIComponent(slug)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'suggest',bindingDigest:context.bindingDigest})});const result=await response.json();
   if(captured!==scope.current)return;if(!response.ok||result.ok!==true||result.bindingDigest!==context.bindingDigest)throw Error(result.reason||'listing_suggestion_unavailable');
   setListing(l=>l?{...l,...result.copy}:l);setNote('AI suggested the wording. Review it before saving.');
  }catch{if(captured===scope.current)setError('AI suggestions are unavailable right now. Your draft is unchanged; you can keep editing.');}
  finally{if(captured===scope.current)setBusy(false);}
 }
 return <div className="listing-layout">
  <section aria-label="Marketplace listing form" className="min-w-0 space-y-6">
   {busy&&!context&&<p role="status">Preparing your draft…</p>}
   {error&&<div role="alert" className="mb-4 space-y-3 text-sm text-ink-200"><p>{error}</p>{context&&<p className="text-xs text-ink-400">Reloading replaces unsaved edits with the saved draft.</p>}<button type="button" className="btn-outline" disabled={busy} onClick={()=>void load()}>{context?'Reload saved draft':'Try again'}</button></div>}
   {note&&<p role="status" className="mb-4 text-sm text-state-ok">{note}</p>}
   {context&&listing&&<fieldset disabled={busy} className="space-y-6">
    {submittedRevision!==null&&<aside className="rounded-xl border border-ink-700 p-4 text-sm text-ink-300">Revision {submittedRevision} {context.review?.submissionId===context.submission?.id&&context.review?.decision==='approved'?(context.review.visibility==='visible'?'is approved for the beta marketplace':context.review.visibility==='hidden'?'is approved but currently hidden':'is approved; current visibility is unavailable'):['rejected','revoked','owner_retracted'].includes(context.submissionReview?.decision||'')?'is kept off the marketplace':'is submitted for review'}.{revision>submittedRevision?' Later edits are drafts until you submit again.':''} This does not publish your agent.{context.review?.status==='unavailable'?' Review status is temporarily unavailable.':''}</aside>}
    {context.review?.decision==='approved'&&context.review.submissionId!==context.submission?.id&&<p className="text-sm text-ink-300">Your earlier approved listing {context.review.visibility==='visible'?'remains visible':context.review.visibility==='hidden'?'is currently hidden':'has unavailable visibility'}.</p>}
    {context.review?.visibility==='hidden'&&<p className="text-sm text-state-needs">{context.review.hiddenReason==='agent_not_shared'?'This agent is private. Use the agent’s sharing settings before offering it to customers.':context.review.hiddenReason==='agent_or_sample_changed'?'The published agent or selected sample changed. Test and submit its current version for review.':'This listing is not currently available in the beta marketplace.'}</p>}
    {context.review?.decision==='approved'&&<button type="button" className="text-sm text-ink-400 underline" onClick={()=>void retract()}>Remove beta listing</button>}
    <p className="text-xs text-ink-500">Drafted from your agent’s setup. Edit anything below.</p>
    <>
     <div className="flex items-center gap-2"><button type="button" className="text-sm text-action-accent" onClick={()=>void polish()}>✨ Suggest wording with AI</button><TrainingInfo label="About AI listing suggestions">Uses the saved service name, description, input labels and tool names with Implexa’s existing Claude service. It receives no training examples or keys, and changes only draft wording.</TrainingInfo></div>
     <div className="grid gap-4 sm:grid-cols-2">{([['name','Service name'],['studioName','Studio name'],['category','Category']] as const).map(([key,label])=><label key={key} className="text-sm text-ink-300">{label}<input className={field} maxLength={key==='name'?120:key==='studioName'?100:80} value={listing[key]} onChange={e=>change(key,e.target.value)}/></label>)}</div>
     {([['input','Customer provides'],['output','Customer receives']] as const).map(([key,label])=><label key={key} className="block text-sm text-ink-300">{label}<textarea className={field} rows={2} maxLength={600} value={listing[key]} onChange={e=>change(key,e.target.value)}/></label>)}
     <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm">Service price (USD)<input type="number" min="0" max="10000" step="0.01" className={field} value={listing.servicePriceCents/100} onChange={e=>change('servicePriceCents',Math.round(Number(e.target.value)*100))}/></label><label className="text-sm">Charge per<select className={field} value={listing.pricePeriod} onChange={e=>change('pricePeriod',e.target.value as Listing['pricePeriod'])}><option value="per_run">Run</option><option value="per_month">Month</option></select></label></div>
    </>
    <section className="space-y-3"><h3 className="font-medium">Sample outputs</h3>{context.samples.length===0?<p className="text-sm text-ink-400">Complete a run on this version to add a sample.</p>:<div className="grid gap-3 sm:grid-cols-2">{context.samples.filter((s,index)=>moreSamples||index<4||listing.sampleIds.includes(s.id)).map(sample=><article key={sample.id} className="overflow-hidden rounded-xl border border-ink-700 p-3"><RunImage artifact={sample}/><label className="mt-3 flex items-center gap-3 text-sm">{<input type="checkbox" checked={listing.sampleIds.includes(sample.id)} disabled={busy||!listing.sampleIds.includes(sample.id)&&listing.sampleIds.length>=3} onChange={e=>change('sampleIds',e.target.checked?[...listing.sampleIds,sample.id]:listing.sampleIds.filter(id=>id!==sample.id))}/>}{sample.relativePath.split('/').pop()} · {new Date(sample.date).toLocaleString()}</label></article>)}</div>}
     {context.samples.length>4&&<button type="button" className="text-sm text-ink-400 underline" onClick={()=>setMoreSamples(!moreSamples)}>{moreSamples?'Show fewer outputs':'Choose from more outputs'}</button>}
     {<label className="flex items-start gap-3 text-sm text-ink-400"><input type="checkbox" className="mt-1" checked={listing.sampleReleaseConsent} onChange={e=>change('sampleReleaseConsent',e.target.checked)}/>I can show these final outputs as public samples when this listing is approved.</label>}
    </section>
    <section className="space-y-4"><h3 className="font-medium">Tools for your customers</h3>{context.tools.map(tool=>{
     const offer=listing.tools.find(t=>t.id===tool.id)!;const price=context.runwayPrice;
     const {cost,markup,valid}=estimateTool(offer,price);
     return <article key={tool.id} className="space-y-4 rounded-xl border border-ink-700 p-4"><header className="flex items-center gap-2"><h4 className="font-medium">{tool.name}</h4><span className="text-xs text-ink-500">{tool.required?'Required':'Optional'}</span>{tool.origin==='funded_pilot_reference'&&<span className="text-xs text-ink-500">Previously tested funded operation</span>}<TrainingInfo label={`About ${tool.name} funding`}>Included tool offers are reviewed separately. Saving or submitting does not grant your account, create a spending allowance or charge anyone. Credentials stay in the existing vault.</TrainingInfo></header>
      {<select aria-label={`${tool.name} access`} className={field} value={offer.mode} onChange={e=>toolChange(tool.id,{mode:e.target.value as ToolOffer['mode']})}>{tool.canCustomerConnect!==false&&<option value="customer_connects">Customer connects their account</option>}{tool.canCustomerConnect===false&&<option value="not_offered">Do not include this tool</option>}{tool.canInclude&&<option value="included">Include this tool for customers</option>}</select>}
      {offer.mode==='included'&&<><p className="text-xs text-state-needs">Funding setup required before customers can use this offer.</p>{<div className="grid gap-4 sm:grid-cols-2"><label className="text-sm">API credits allowed per run<input type="number" min="60" max="10000" step="1" className={field} value={offer.credits} onChange={e=>toolChange(tool.id,{credits:Number(e.target.value)})}/></label><label className="text-sm">Your tool markup (0–20%)<input type="number" min="0" max="20" step="1" className={field} value={offer.markupPercent} onChange={e=>toolChange(tool.id,{markupPercent:Number(e.target.value)})}/></label></div>}
       <dl className="space-y-2 text-sm"><div className="flex justify-between"><dt>Estimated provider cost ceiling</dt><dd>{valid?money(cost):'Unavailable'}</dd></div><div className="flex justify-between"><dt>Your tool markup</dt><dd>{valid?money(markup):'—'}</dd></div><div className="flex justify-between border-t border-ink-700 pt-3 font-medium"><dt>Maximum customer tool charge / run</dt><dd>{valid?money(cost+markup):'Unavailable'}</dd></div></dl>
       <details className="text-xs leading-6 text-ink-500"><summary className="cursor-pointer">Rate details</summary><p>{price.model} · {price.durationSeconds}-second clips · {price.creditsPerClip} API credits each. This cap covers at most {valid?Math.floor(offer.credits/price.creditsPerClip):'—'} clips, subject to a separate allowance. These are API wallet credits, not web subscription credits.</p><p><a className="underline" href={price.sourceUrl} target="_blank" rel="noreferrer">Official USD rate</a> checked {new Date(price.checkedAt).toLocaleDateString(undefined,{timeZone:'UTC'})}; valid until {new Date(price.validUntil).toLocaleDateString(undefined,{timeZone:'UTC'})} UTC. Markup rounds up to a cent. Tax is not included. Checkout and settlement are not enabled.</p></details>
      </>}
     </article>;
    })}{context.tools.length===0&&<p className="text-sm text-ink-400">No external account tools declared for this version.</p>}</section>
    {!context.canSubmit&&<p className="text-sm text-state-needs">Test and publish this version’s training before submitting. You can save your draft now.</p>}
    <div className="flex flex-wrap gap-3 border-t border-ink-800 pt-5"><a href="#listing-preview" className="btn-outline">Preview listing</a><button type="button" className="btn-secondary" disabled={busy} onClick={()=>void save('save')}>Save draft</button><button type="button" className="btn-primary" disabled={busy||!context.canSubmit||!listing.sampleReleaseConsent||listing.sampleIds.length===0} onClick={()=>void save('submit')}>{busy?'Saving…':'Submit for review'}</button></div>
   </fieldset>}
  </section>
  <aside id="listing-preview" tabIndex={-1} className="listing-preview card">
   <p className="text-xs text-ink-400">Listing preview</p>
   <h2 className="mt-3 text-2xl font-display">{listing?.name||'Your trained agent'}</h2>
   {listing&&<><p className="mt-2 text-sm text-ink-400">{listing.studioName} · {listing.category}</p>
    <dl className="mt-6 space-y-5 text-sm"><div><dt className="text-xs text-ink-400">Customer provides</dt><dd className="mt-1">{listing.input}</dd></div><div><dt className="text-xs text-ink-400">Customer receives</dt><dd className="mt-1">{listing.output}</dd></div><div><dt className="text-xs text-ink-400">Proposed service price</dt><dd className="mt-1 text-lg">{money(listing.servicePriceCents)} {listing.pricePeriod==='per_run'?'per run':'per month'}</dd></div></dl>
    <ul className="mt-5 space-y-3 text-sm">{context?.tools.map(tool=>{
     const offer=listing.tools.find(item=>item.id===tool.id);if(!offer)return null;
     const quote=estimateTool(offer,context.runwayPrice);
     return <li key={tool.id}><span className="block font-medium">{tool.name}</span><span className="text-xs text-ink-400">{offer.mode==='included'?(quote.valid?`Proposed inclusion · up to ${money(quote.cost+quote.markup)} per run (estimate)`:'Proposed inclusion · price unavailable'):offer.mode==='not_offered'?'Not included in this offer':'Customer connects their account'}</span></li>;
    })}</ul>
    <p className="mt-6 border-t border-ink-700 pt-4 text-xs leading-5 text-ink-400">Private draft. Saving or submitting does not publish this agent, enable billing, or fund a tool.</p>
   </>}
  </aside>
 </div>;
}

/** The training workspace stays light; draft reads begin only on the listing page. */
export function MarketplaceSubmissionEntry({slug,versionId}:{slug:string;versionId?:string|null}) {
 return <section aria-label="Marketplace submission" className="card flex flex-wrap items-center justify-between gap-5">
  <div><h2 className="text-lg font-medium">Earn with your trained agent</h2><p className="mt-2 text-sm text-ink-400">Turn your training into a service others can rent.</p></div>
  <Link className="btn-primary" href={`/training/${encodeURIComponent(slug)}/listing${versionId?`?versionId=${encodeURIComponent(versionId)}`:''}`}>Prepare marketplace listing</Link>
 </section>;
}

function estimateTool(offer:ToolOffer,price:Price) {
 const cost=offer.credits*price.centsPerCredit,markup=Math.ceil(cost*offer.markupPercent/100);
 const valid=Date.now()<Date.parse(price.validUntil)&&Number.isSafeInteger(offer.credits)&&offer.credits>=60&&offer.credits<=10000&&Number.isInteger(offer.markupPercent)&&offer.markupPercent>=0&&offer.markupPercent<=20;
 return {cost,markup,valid};
}
