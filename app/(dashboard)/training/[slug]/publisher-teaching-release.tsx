'use client';
import {useEffect,useRef,useState} from 'react';
import {isTrainingEvidenceStorage,type TrainingEvidenceStorage} from '@/lib/training-local-ingress';
import {teachingDigest} from '@/lib/training-teaching-draft';
import Modal from '../../_components/modal';
import type {GuidedTrainingChanges,TrainingPublicationPreview} from '@/lib/guided-training-changes';

type Projection={recordId:string;recordDigest:string;relation:string;properties:string[];summary:string;mustNotCopy:string[];attribution:string|null;
 derivative:{evidenceId:string;sha256:string;anchorDigest:string;mediaType:string;sizeBytes:number;width:number;height:number}};
type Candidate={recordId:string;recordDigest:string;sessionId:string;localSourceId:string;baseVersionId:string;sourceMachineId:string;
 projection:Projection;decision:Record<string,string>;eligible:boolean;storage:TrainingEvidenceStorage|null;
 release:{releaseId:string;releaseDigest:string;withdrawnAt:string|null;current:boolean}|null};
type Preview={releaseId:string;releaseDigest:string;projection:Projection;receipt:{workflowVersionId:string;storageId:string;retentionUntil:string;deliveryMode:string}};
type Bridge={trainingEvidenceStorageContractVersion?:string;trainingLocal:(operation:string,args:unknown)=>Promise<any>};
const uuid=(s:unknown):s is string=>typeof s==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(s);
const sha=(s:unknown):s is string=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
function candidate(v:any):v is Candidate {
 return v&&[v.recordId,v.sessionId,v.localSourceId,v.baseVersionId].every(uuid)&&sha(v.recordDigest)&&typeof v.sourceMachineId==='string'
  &&typeof v.eligible==='boolean'&&v.projection?.recordId===v.recordId&&v.projection?.recordDigest===v.recordDigest
  &&Array.isArray(v.projection.properties)&&v.projection.properties.every((p:unknown)=>typeof p==='string')
  &&typeof v.projection.summary==='string'&&v.projection.summary.length<=4000&&Array.isArray(v.projection.mustNotCopy)
  &&uuid(v.projection.derivative?.evidenceId)&&sha(v.projection.derivative?.sha256)&&v.projection.derivative?.mediaType==='image/png'
  &&Number.isSafeInteger(v.projection.derivative?.sizeBytes)&&v.projection.derivative.sizeBytes>0&&v.projection.derivative.sizeBytes<=8388608
  &&[v.projection.derivative.width,v.projection.derivative.height].every(n=>Number.isInteger(n)&&n>0&&n<=2560)
  &&(v.storage===null||isTrainingEvidenceStorage(v.storage,v.recordId,v.recordDigest))
  &&(v.release===null||uuid(v.release?.releaseId)&&sha(v.release?.releaseDigest)&&typeof v.release?.current==='boolean');
}

/** The normal publication path reviews one tested snapshot. The existing image
 * custody/fork controls above remain available for detailed evidence operations. */
export function GuidedPublicationReview({open,value,busy=false,error='',onClose,onPrepare,onTest,onPublish,onReviewExample}:{
 open:boolean;value:GuidedTrainingChanges;busy?:boolean;error?:string;onClose:()=>void;
 onPrepare:(recordIds:string[])=>Promise<TrainingPublicationPreview|null>;
 onTest:(preview:TrainingPublicationPreview)=>Promise<void>;
 onPublish:(preview:TrainingPublicationPreview)=>Promise<boolean>;
 onReviewExample?:(recordId:string)=>void;
}){
 const [ids,setIds]=useState<string[]>([]),[preview,setPreview]=useState<TrainingPublicationPreview|null>(null),[consent,setConsent]=useState(false);
 const [working,setWorking]=useState(false),[note,setNote]=useState('');const pending=useRef(false);
 const identity=`${value.binding.sessionId}:${value.binding.workflowVersionId}:${value.binding.snapshotDigest}:${open}`,current=useRef(identity);current.current=identity;
 useEffect(()=>{setIds([]);setPreview(null);setConsent(false);setNote('');},[identity]);
 const work=async(action:()=>Promise<void>)=>{if(pending.current||busy)return;pending.current=true;setWorking(true);setNote('');try{await action();}catch{setNote('This publication action could not be confirmed. Refresh the saved state before trying again.');}finally{pending.current=false;setWorking(false);}};
 const prepare=async()=>{const captured=identity,found=await onPrepare(ids);if(current.current!==captured)return;setPreview(found);setConsent(false);if(!found)setNote('The exact public preview is unavailable. Your private training and served version are unchanged.');};
 const unavailable=busy||working;
 return <Modal open={open} onClose={onClose} title="Review the public version" maxWidth="max-w-3xl">
  <div className="space-y-5 text-sm leading-6">
   <p className="text-ink-400">Choose exactly which teachings customers may receive. Your private candidate, raw feedback and recordings are not published by opening this review. Nothing is selected automatically.</p>
   <div className="space-y-3" aria-label="Teachings proposed for public release">{value.records.filter(r=>r.included&&r.summary).map(r=><label key={r.recordId} className="flex items-start gap-3 rounded-lg border border-ink-800 p-3">
    <input type="checkbox" disabled={unavailable||!ids.includes(r.recordId)&&ids.length>=32} checked={ids.includes(r.recordId)} className="mt-1" onChange={e=>{setIds(old=>e.target.checked?[...old,r.recordId]:old.filter(id=>id!==r.recordId));setPreview(null);setConsent(false);}}/>
    <span><span className="block">{r.summary}</span><span className="text-xs text-ink-500">{r.sourceKind==='legacy_evidence'?'Teaching with visual evidence':'Text guidance'} · {r.recordDigest.slice(0,12)}</span></span>
   </label>)}</div>
   <p className="text-xs text-ink-500">{ids.length} selected. Selecting none prepares a definition-only public version.</p>
   <button type="button" className="btn-outline" disabled={unavailable||!value.publication.canPrepare} onClick={()=>work(prepare)}>Prepare exact public preview</button>
   {preview&&<section className="space-y-4 rounded-xl border border-ink-700 p-4" aria-label="Exact public snapshot">
    <div><h3 className="font-medium">{preview.definition.name}</h3><p className="mt-2 text-ink-400">{preview.definition.description}</p></div>
    {preview.records.map(r=><article className="border-t border-ink-800 pt-3" key={r.recordId}><p>{r.summary}</p>
     <p className="mt-1 text-xs text-ink-500">{r.relation} · {r.deliveryMode==='standing'?'Stage-start guidance':'Retrieved for relevant questions'} · {r.derivative.mediaType==='image/png'?'Image and guidance':'Text guidance'}</p>
     {r.mustNotCopy.length>0&&<p className="mt-1 text-xs text-ink-400">Preserved restrictions: {r.mustNotCopy.map(s=>s.replaceAll('_',' ')).join(', ')}</p>}
     {r.attribution&&<p className="mt-1 text-xs text-ink-400">{r.attribution}</p>}
     {r.derivative.mediaType==='image/png'&&onReviewExample&&<button type="button" className="mt-2 text-xs underline" disabled={unavailable} onClick={()=>onReviewExample(r.recordId)}>Review exact image</button>}
    </article>)}
    <p className="text-xs text-ink-500">Material snapshot {preview.snapshotDigest.slice(0,12)}. Selected example copies may be inspected by customers who receive them; withdrawal stops future access.</p>
    {!preview.canPublish&&<><p className="text-ink-400">This exact public material needs a matching delivered test before publication.{preview.reason?` ${preview.reason.replaceAll('_',' ')}.`:''}</p>
     <button type="button" className="btn-outline" disabled={unavailable} onClick={()=>work(()=>onTest(preview))}>Test this public version</button></>}
    {preview.canPublish&&<p className="text-emerald-300">A delivered test matches this exact public material.</p>}
    <label className="flex items-start gap-3"><input type="checkbox" className="mt-1" checked={consent} disabled={unavailable} onChange={e=>setConsent(e.target.checked)}/>
     <span>I reviewed this definition and the selected guidance and examples, and release this exact public version for customers. Raw feedback and recordings stay private.</span></label>
    <button type="button" className="btn-primary" disabled={unavailable||!preview.canPublish||!consent} onClick={()=>work(async()=>{const captured=identity;if(await onPublish(preview)&&current.current===captured){setNote('This exact tested public version is published.');setConsent(false);}})}>Publish tested public version</button>
   </section>}
   {working&&<p role="status">Checking the exact snapshot…</p>}{(error||note)&&<p role="status">{error?error.replaceAll('_',' '):note}</p>}
  </div>
 </Modal>;
}
async function verifyImage(image:string,p:Projection){
 if(typeof image!=='string'||!image.startsWith('data:image/png;base64,')||image.length>11200000)throw Error('The exact teaching image is unavailable.');
 const bytes=Uint8Array.from(atob(image.slice(22)),c=>c.charCodeAt(0)),d=p.derivative;
 if(bytes.length!==d.sizeBytes||bytes.length<24||[137,80,78,71,13,10,26,10].some((n,i)=>bytes[i]!==n)
  ||new DataView(bytes.buffer).getUint32(16)!==d.width||new DataView(bytes.buffer).getUint32(20)!==d.height
  ||await teachingDigest(bytes)!==d.sha256)throw Error('The teaching image does not match its admitted bytes.');
}
export default function PublisherTeachingRelease({slug,versionId:activeVersionId,forkPermission}:{slug:string;versionId:string|null;forkPermission?:{lineageId:string;parentVersionId:string}}){
 const versionId=activeVersionId||(forkPermission?.parentVersionId&&uuid(forkPermission.parentVersionId)&&uuid(forkPermission.lineageId)?forkPermission.parentVersionId:null);
 const [items,setItems]=useState<Candidate[]>([]),[listVersion,setListVersion]=useState<string|null>(null);
 const [selected,setSelected]=useState<{item:Candidate;token:string;image:string}|null>(null),[preview,setPreview]=useState<Preview|null>(null);
 const [storeConsent,setStoreConsent]=useState(false),[releaseConsent,setReleaseConsent]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[note,setNote]=useState('');
 const [forkId,setForkId]=useState(forkPermission?.lineageId||''),[forkGrants,setForkGrants]=useState<any[]>([]),[forkConsent,setForkConsent]=useState(false);
 const [forkPreview,setForkPreview]=useState<{item:Candidate;data:any}|null>(null);
 const [scopePreview,setScopePreview]=useState<{grant:any;data:any}|null>(null),[scopeConsent,setScopeConsent]=useState(false);
 const current=useRef(versionId);current.current=versionId;const pending=useRef(false);
 useEffect(()=>{setItems([]);setListVersion(null);setSelected(null);setPreview(null);setStoreConsent(false);setReleaseConsent(false);setForkPreview(null);setForkGrants([]);setForkConsent(false);setScopePreview(null);setScopeConsent(false);},[slug,versionId]);
 const bridge=()=>{const b=(window as unknown as {implexaDesktop?:Bridge}).implexaDesktop;
  if(!b?.trainingLocal||b.trainingEvidenceStorageContractVersion!=='1')throw Error('Open updated Implexa Desktop on the source machine to prepare this teaching.');return b;};
 const work=async(fn:()=>Promise<void>)=>{if(pending.current)return;pending.current=true;setBusy(true);setError('');setNote('');try{await fn();}catch(e){setError(e instanceof Error?e.message:'Teaching release is unavailable.');}finally{pending.current=false;setBusy(false);}};
 const request=async(body:unknown=null)=>{const response=await fetch(`/api/agent-training/teaching-releases?slug=${encodeURIComponent(slug)}&versionId=${encodeURIComponent(versionId||'')}`,{
  method:body?'POST':'GET',cache:'no-store',...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
  const data=await response.json();if(!response.ok||data.ok!==true)throw Error(data.reason?.replaceAll('_',' ')||'Teaching release is unavailable.');return data;};
 const ensureVersion=(v:string|null)=>{if(!v||current.current!==v)throw Error('The agent version changed. Reload release candidates.');};
 async function load(){const v=versionId;const data=await request();ensureVersion(v);
  if(data.contractVersion!=='publisher-teaching-candidates.v1'||data.workflowVersionId!==v||!Array.isArray(data.candidates)||data.candidates.length>50||!data.candidates.every(candidate))throw Error('Release candidates could not be verified.');
  setItems(data.candidates);setListVersion(v);return data.candidates as Candidate[];}
 async function review(item:Candidate){const v=versionId;setSelected(null);setPreview(null);setStoreConsent(false);setReleaseConsent(false);
  if(listVersion!==v||!item.eligible)throw Error('Reload the current compatible teaching candidates.');
  const b=bridge(),listed=await b.trainingLocal('list',{sessionId:item.sessionId});ensureVersion(v);
  const source=listed.ok&&listed.sources?.find((s:any)=>s.sourceId===item.localSourceId),record=source?.decisions?.find((r:any)=>r.recordId===item.recordId&&r.recordDigest===item.recordDigest);
  if(!source?.token||!record)throw Error('Open the source machine shown for this teaching. Its original source has not been re-registered here.');
  const frame=await b.trainingLocal('decisionPreview',{token:source.token,recordId:item.recordId});ensureVersion(v);
  if(!frame.ok||frame.recordId!==item.recordId||frame.recordDigest!==item.recordDigest)throw Error('The exact saved frame could not be verified.');
  await verifyImage(frame.image,item.projection);ensureVersion(v);setSelected({item,token:source.token,image:frame.image});
 }
 async function store(){if(!selected||!storeConsent)return;const v=versionId,target=selected;
  const data=await bridge().trainingLocal('serverStorage',{action:'store',token:target.token,recordId:target.item.recordId,expectedDigest:target.item.recordDigest,consent:true});ensureVersion(v);
  if(!data.ok||!isTrainingEvidenceStorage(data.storage,target.item.recordId,target.item.recordDigest)||!data.storage?.storedAt||data.storage.withdrawnAt||data.storage.deletedAt)throw Error(data.reason||'The exact image was not confirmed as stored.');
  const rows=await load(),item=rows.find(r=>r.recordId===target.item.recordId);ensureVersion(v);if(!item||item.storage?.storageId!==data.storage.storageId)throw Error('Stored image status changed. Reload candidates.');
  setSelected({...target,item});setStoreConsent(false);setPreview(null);setReleaseConsent(false);setNote('Exact image stored privately. It is not released to customers yet.');
 }
 async function prepare(){if(!selected?.item.storage)return;const v=versionId,target=selected;
  setPreview(null);setReleaseConsent(false);const data=await request({action:'preview',versionId:v,recordId:target.item.recordId,recordDigest:target.item.recordDigest,storageId:target.item.storage!.storageId,releaseId:crypto.randomUUID()});ensureVersion(v);
  if(data.contractVersion!=='publisher-teaching-preview.v1'||data.released!==false||!uuid(data.releaseId)||!sha(data.releaseDigest)
   ||data.receipt?.workflowVersionId!==v||data.receipt?.storageId!==target.item.storage!.storageId||data.receipt?.deliveryMode!=='on_question'
   ||JSON.stringify(data.projection)!==JSON.stringify(target.item.projection))throw Error('The release projection changed. Review the current candidate again.');
  setPreview(data);
 }
 async function release(){if(!selected||!preview||!releaseConsent||preview.receipt.workflowVersionId!==versionId)return;
  const v=versionId,target=selected,p=preview;const data=await request({action:'release',versionId:v,recordId:target.item.recordId,recordDigest:target.item.recordDigest,storageId:p.receipt.storageId,releaseId:p.releaseId,previewDigest:p.releaseDigest});ensureVersion(v);
  if(data.released!==true||data.releaseId!==p.releaseId||data.releaseDigest!==p.releaseDigest)throw Error('The release receipt could not be verified.');
  await load();setPreview(null);setReleaseConsent(false);setSelected(null);setNote('This exact teaching is released for installed customers of this version.');
 }
 async function withdraw(item:Candidate){if(!item.release)return;const v=versionId;
  const data=await request({action:'withdraw',releaseId:item.release.releaseId,releaseDigest:item.release.releaseDigest});ensureVersion(v);
  if(data.releaseId!==item.release.releaseId||data.releaseDigest!==item.release.releaseDigest||!data.withdrawnAt)throw Error('Release withdrawal could not be verified.');
  await load();setSelected(null);setPreview(null);setReleaseConsent(false);setNote('Further customer disclosure is withdrawn. Original teaching and private storage are preserved.');}
 async function loadFork(){
  if(!uuid(forkId)||!versionId)throw Error('Open the permission link from the private fork, or enter its fork reference.');
  const v=versionId,id=forkId,data=await request({action:'fork_list',versionId:v,lineageId:id});ensureVersion(v);
  if(data.lineageId!==id||!Array.isArray(data.grants)||data.grants.length>50||data.grants.some((g:any)=>!uuid(g.id)||g.lineage_id!==id||!uuid(g.release_id)||!sha(g.grant_digest)
    ||g.successor_scope_digest!=null&&(!sha(g.successor_scope_digest)||typeof g.successor_scope_confirmed_at!=='string'||!Number.isFinite(Date.parse(g.successor_scope_confirmed_at)))
    ||g.successor_scope_digest==null&&g.successor_scope_confirmed_at!=null))throw Error('Fork permissions could not be verified.');
  setForkGrants(data.grants);return data.grants as any[];
 }
 async function prepareFork(item:Candidate){
  if(!item.release?.current||listVersion!==versionId||!uuid(forkId))throw Error('Load a current release and an exact fork reference first.');
  const v=versionId,id=forkId;setForkPreview(null);setForkConsent(false);
  const data=await request({action:'fork_preview',versionId:v,lineageId:id,releaseId:item.release.releaseId,grantId:crypto.randomUUID()});ensureVersion(v);
  if(!uuid(data.grantId)||!sha(data.grantDigest)||data.granted!==false||data.childVersionId!==id||data.parentVersionId!==v
    ||data.receipt?.lineageId!==id||data.receipt?.releaseId!==item.release.releaseId||data.receipt?.releaseDigest!==item.release.releaseDigest||!uuid(data.recipientId)||typeof data.childName!=='string')throw Error('The proposed fork permission changed.');
  setForkPreview({item,data});
 }
 async function grantFork(){
  if(!forkPreview||!forkConsent)return;const {item,data:p}=forkPreview,v=versionId;
  if(p.childVersionId!==forkId||p.parentVersionId!==v||!item.release)throw Error('The fork target changed. Review it again.');
  const data=await request({action:'fork_grant',versionId:v,lineageId:forkId,releaseId:item.release.releaseId,grantId:p.grantId,previewDigest:p.grantDigest});ensureVersion(v);
  if(data.granted!==true||data.grantId!==p.grantId||data.grantDigest!==p.grantDigest||data.childVersionId!==forkId)throw Error('The fork grant was not confirmed. Recheck its permissions before retrying.');
  await loadFork();setForkPreview(null);setForkConsent(false);setNote('This released example may guide this private fork only. No library or redistribution access was granted.');
 }
 async function withdrawFork(g:any){const v=versionId;
  const data=await request({action:'fork_withdraw',versionId:v,lineageId:forkId,releaseId:g.release_id,grantId:g.id,previewDigest:g.grant_digest});ensureVersion(v);
  if(data.grantId!==g.id||!data.withdrawnAt)throw Error('The withdrawal was not confirmed.');
  await loadFork();setScopePreview(null);setScopeConsent(false);setNote('Further disclosure to this fork is withdrawn. The original customer release is unchanged.');
 }
 async function prepareScope(g:any){
  const v=versionId,id=forkId;setScopePreview(null);setScopeConsent(false);
  const data=await request({action:'fork_scope_preview',versionId:v,lineageId:id,releaseId:g.release_id,grantId:g.id});ensureVersion(v);
  if(data.grantId!==g.id||data.childVersionId!==id||data.parentVersionId!==v||data.scope!=='compatible_successors'
    ||!sha(data.scopeDigest)||typeof data.scopeConfirmed!=='boolean'||!uuid(data.recipientId)||typeof data.childName!=='string'
    ||data.receipt?.contractVersion!=='agent-fork-successor-scope.v1'||data.receipt?.scope!=='compatible_successors'
    ||data.receipt?.grantDigest!==g.grant_digest||data.receipt?.lineageId!==id||data.receipt?.releaseId!==g.release_id
    ||data.receipt?.releaseDigest!==g.release_digest)throw Error('The proposed compatible-version permission changed.');
  if(data.scopeConfirmed){await loadFork();setNote('Compatible versions are already permitted for this example.');return;}
  setScopePreview({grant:g,data});
 }
 async function confirmScope(){
  if(!scopePreview||!scopeConsent)return;const {grant:g,data:p}=scopePreview,v=versionId;
  if(p.childVersionId!==forkId||p.parentVersionId!==v)throw Error('The fork target changed. Review it again.');
  const data=await request({action:'fork_scope_confirm',versionId:v,lineageId:forkId,releaseId:g.release_id,grantId:g.id,previewDigest:p.scopeDigest});ensureVersion(v);
  if(data.scopeConfirmed!==true||data.scopeDigest!==p.scopeDigest||data.grantId!==g.id||data.childVersionId!==forkId)
    throw Error('Compatible-version permission was not confirmed. Recheck it before retrying.');
  await loadFork();setScopePreview(null);setScopeConsent(false);setNote('This example may guide this private fork and its compatible versions. Withdrawal still ends all further disclosure.');
 }
 return <section className="rounded border border-ink-700 p-4 space-y-3" aria-label="Selected teachings for customers">
  <h2 className="font-semibold">Selected teachings for customers</h2><p>Only teachings you explicitly release here can guide customers of this exact public agent version. Your full library, recordings and private feedback remain private. Customers can inspect the selected image and guidance they receive; already delivered copies cannot be recalled.</p>
  {!activeVersionId&&forkPermission&&<p>Permission review for pinned parent version {versionId?.slice(0,8)}. Local training and source access remain unavailable in this browser. The server verifies publisher ownership and the exact fork.</p>}
  <button disabled={busy||!versionId} onClick={()=>work(async()=>{await load();})}>Load compatible teaching candidates</button>
  {listVersion&&<p>Showing up to 50 compatible owned records. Eligibility is not a promise of selection or application.</p>}
  <div className="rounded border border-ink-700 p-3 space-y-2"><h3>Permissions for one private fork</h3>
   <p>A customer release does not automatically permit forks. Each permission below applies only to the linked private child, while its release and privacy consent remain current.</p>
   <label>Fork reference<input aria-label="Fork reference" value={forkId} disabled={busy} onChange={e=>{setForkId(e.target.value);setForkGrants([]);setForkPreview(null);setForkConsent(false);setScopePreview(null);setScopeConsent(false);}} className="block w-full"/></label>
   <button disabled={busy||!uuid(forkId)} onClick={()=>work(async()=>{await loadFork();})}>Load fork permissions</button>
   {forkGrants.map(g=><div key={g.id}><span>Release {g.release_id.slice(0,8)}: {g.withdrawn_at?'withdrawn':g.successor_scope_digest?'permitted for this fork and compatible versions':'permitted for this fork version'}</span>
    {!g.withdrawn_at&&!g.successor_scope_digest&&<button disabled={busy} onClick={()=>work(()=>prepareScope(g))}>Review compatible versions {g.release_id.slice(0,8)}</button>}
    {!g.withdrawn_at&&<button disabled={busy} onClick={()=>work(()=>withdrawFork(g))}>Withdraw fork permission {g.release_id.slice(0,8)}</button>}</div>)}
  </div>
  {scopePreview&&<dialog open aria-label="Compatible fork versions permission" className="relative rounded border border-brand-500 bg-ink-950 p-4 space-y-3">
   <h3>Allow this example in compatible versions</h3>
   <p>Private child: {scopePreview.data.childName}. Recipient: {scopePreview.data.recipientId}. Release: {scopePreview.grant.release_id}.</p>
   <p>Compatible means the same task identity and Manager stage and property policies. The child’s instructions may change. This permits this exact example in those future versions; it does not share your library or customer-private preferences.</p>
   <p>This scope cannot be withdrawn separately. Withdrawing the original fork permission ends further disclosure to this version and all successors. Release, storage and privacy withdrawal remain immediate; delivered copies cannot be recalled.</p>
   <label><input type="checkbox" checked={scopeConsent} disabled={busy} onChange={e=>setScopeConsent(e.target.checked)}/>Allow this example in this private fork and its compatible future versions.</label>
   <button disabled={busy||!scopeConsent} onClick={()=>work(confirmScope)}>Allow compatible versions</button>
   <button disabled={busy} onClick={()=>{setScopePreview(null);setScopeConsent(false);}}>Cancel</button>
  </dialog>}
  {items.map(item=><div key={item.recordId} className="rounded border border-ink-700 p-3 space-y-2"><p>{item.projection.properties.join(', ')} · {item.projection.relation} · {item.recordDigest.slice(0,8)}</p>
   <p>Source machine: {item.sourceMachineId}. Original version: {item.baseVersionId.slice(0,8)}.</p><p>{item.release?.current?'Released for this version.':item.release&&!item.release.withdrawnAt?'Release currently unavailable.':'Not released.'}</p>
   <button disabled={busy||!item.eligible||listVersion!==versionId||!!item.release&&!item.release.withdrawnAt} onClick={()=>work(()=>review(item))}>Review teaching {item.recordDigest.slice(0,8)}</button>
   {item.release?.current&&<button disabled={busy||!uuid(forkId)||listVersion!==versionId||forkGrants.some(g=>g.release_id===item.release?.releaseId)} onClick={()=>work(()=>prepareFork(item))}>Review fork permission {item.recordDigest.slice(0,8)}</button>}
   {item.release&&!item.release.withdrawnAt&&<button disabled={busy} onClick={()=>work(()=>withdraw(item))}>Withdraw release {item.recordDigest.slice(0,8)}</button>}</div>)}
  {forkPreview&&<dialog open aria-modal="true" aria-label="Review exact fork permission" className="fixed inset-0 z-50 max-w-xl rounded border border-ink-600 p-5 shadow-xl space-y-3">
   <h3>Permit this released example in one private fork</h3><p>Child: {forkPreview.data.childName}. Parent version: {forkPreview.data.parentVersionId.slice(0,8)}.</p><p>Recipient account: {forkPreview.data.recipientId}. Fork reference: {forkPreview.data.childVersionId}.</p>
   <p>{forkPreview.item.projection.summary}</p><p>Exact image: {forkPreview.item.projection.derivative.sha256}. Release: {forkPreview.item.release?.releaseDigest}.</p>
   <p>This grants retrieval only to this child version. Withdrawal is final for this child version and this release; a replacement permission cannot revive an old run. The full library and customer-private preferences stay private. Release, storage or privacy withdrawal still blocks further access; delivered copies cannot be recalled.</p>
   <label><input type="checkbox" checked={forkConsent} disabled={busy} onChange={e=>setForkConsent(e.target.checked)}/>Allow this exact released example in this private child.</label>
   <button disabled={busy||!forkConsent} onClick={()=>work(grantFork)}>Allow example in this fork</button>
   <button disabled={busy} onClick={()=>{setForkPreview(null);setForkConsent(false);}}>Cancel</button>
  </dialog>}
  {selected&&<div className="rounded border border-brand-500 p-3 space-y-3"><h3>Exact teaching proposed for customer release</h3><img src={selected.image} alt="Exact admitted teaching proposed for release" className="w-full"/>
   <dl>{Object.entries(selected.item.decision).map(([key,value])=><div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>
   <pre className="whitespace-pre-wrap break-all text-sm">{JSON.stringify(preview?.projection||selected.item.projection,null,2)}</pre>
   {!selected.item.storage&&<><label><input type="checkbox" disabled={busy} checked={storeConsent} onChange={e=>setStoreConsent(e.target.checked)}/>Store this exact teaching image privately in Implexa, under its existing expiry. This alone does not release it.</label><button disabled={busy||!storeConsent} onClick={()=>work(store)}>Save exact image privately</button></>}
   {selected.item.storage&&<button disabled={busy} onClick={()=>work(prepare)}>Prepare exact release preview</button>}
   {preview&&<><p>Delivery: on question only. Released image expires {preview.receipt.retentionUntil}. Release receipt {preview.releaseDigest}.</p>
    <label><input type="checkbox" disabled={busy} checked={releaseConsent} onChange={e=>setReleaseConsent(e.target.checked)}/>I reviewed this exact image and guidance and release them to installed customers of this public agent version.</label>
    <button disabled={busy||!releaseConsent||preview.receipt.workflowVersionId!==versionId} onClick={()=>work(release)}>Release this exact teaching</button></>}
  </div>}
  {busy&&<p role="status">Checking selected teaching…</p>}{error&&<p role="alert">{error}</p>}{note&&<p role="status">{note}</p>}
 </section>;
}
