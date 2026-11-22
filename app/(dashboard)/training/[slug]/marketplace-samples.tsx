
'use client';
import {useEffect,useRef,useState} from 'react';
import {createClient} from '@/lib/supabase/client';
import {TrainingDialog as Modal} from './training-workspace';
export type UploadedSample={id:string;kind:'uploaded';name:string;date:string;mediaType:string;width:number|null;height:number|null;durationMs:number|null;sizeBytes:number|null;sha256:string|null;posterSha256:string|null;provenance:'trainer_uploaded';state?:string;intentKey?:string;sourceSha256?:string;sourceSizeBytes?:number;sourceMediaType?:string};
export const sampleUrl=(id:string,variant:'preview'|'poster'='poster')=>`/api/agent-training/marketplace-samples?id=${encodeURIComponent(id)}&variant=${variant}`;
const messages:Record<string,string>={sample_limit:'You can store up to three uploads. Remove one before adding another.',sample_processing:'This example is still being prepared. Try again shortly.',sample_storage_unavailable:'Storage is unavailable. Your draft is safe; retry this upload.',sample_bytes_mismatch:'The upload did not arrive intact. Choose the same file to retry.',invalid_media:'Use a JPG, PNG, WebP, MP4 or MOV within the size limits.',invalid_excerpt:'Choose an excerpt between one and sixty seconds.',sample_already_prepared:'This excerpt has already been prepared. Remove the example to choose a different excerpt.'};
async function json(action:string,args:Record<string,string>,body:unknown,key?:string){
 const r=await fetch(`/api/agent-training/marketplace-samples?${new URLSearchParams({action,...args})}`,{method:'POST',headers:{'Content-Type':'application/json',...(key?{'Idempotency-Key':key}:{})},body:JSON.stringify(body)}),v=await r.json();
 if(!r.ok||!v.ok||v.contractVersion&&v.contractVersion!=='marketplace-sample-media.v1')throw Error(v.reason||'sample_request_unconfirmed');return v;
}
export default function MarketplaceSamples({slug,versionId,uploads,onChanged,onBusy}:{slug:string;versionId:string;uploads:UploadedSample[];onChanged:(id?:string)=>Promise<void>;onBusy:(busy:boolean)=>void}){
 const [file,setFile]=useState<File|null>(null),[url,setUrl]=useState(''),[seconds,setSeconds]=useState<number|null>(null),[start,setStart]=useState(0),[end,setEnd]=useState(60),[attested,setAttested]=useState(false),[status,setStatus]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[unsupported,setUnsupported]=useState(false);
 const [removing,setRemoving]=useState<string|null>(null);
 const input=useRef<HTMLInputElement>(null),epoch=useRef(0),xhr=useRef<XMLHttpRequest|null>(null),intent=useRef<{file:File;key:string;id?:string}|null>(null);
 useEffect(()=>{epoch.current++;return()=>{epoch.current++;xhr.current?.abort();};},[slug,versionId]);
 useEffect(()=>{if(!file){setUrl('');return;}const object=URL.createObjectURL(file);setUrl(object);return()=>URL.revokeObjectURL(object);},[file]);
 const video=!!file&&(/video/.test(file.type)||/\.(mov|mp4)$/i.test(file.name));
 function choose(next:File|undefined){if(!next)return;const image=/\.(png|jpe?g|webp)$/i.test(next.name),movie=/\.(mp4|mov)$/i.test(next.name);if(!image&&!movie||next.size>(image?10:100)*1024*1024){setError(messages.invalid_media);return;}setFile(next);setAttested(false);setSeconds(null);setStart(0);setEnd(60);setUnsupported(false);setError('');setStatus('');intent.current={file:next,key:crypto.randomUUID()};}
 async function run(){
  if(!file||!attested||busy)return;const captured=epoch.current,current=file;setBusy(true);onBusy(true);setError('');
  const alive=()=>captured===epoch.current;
  try{
   if(video&&(!Number.isFinite(start)||!Number.isFinite(end)||end-start<1||end-start>60||start<0||seconds!==null&&end>seconds+.05))throw Error('invalid_excerpt');
   setStatus('Checking your file…');const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await current.arrayBuffer()))).map(x=>x.toString(16).padStart(2,'0')).join('');if(!alive())return;
   const mediaType=video?(/\.mov$/i.test(current.name)?'video/quicktime':'video/mp4'):/\.png$/i.test(current.name)?'image/png':/\.webp$/i.test(current.name)?'image/webp':'image/jpeg';
   const prior=uploads.find(s=>s.sourceSha256===hash&&s.sourceSizeBytes===current.size&&s.name===current.name&&s.sourceMediaType===mediaType&&s.state!=='deleting');
   const key=prior?.intentKey||(intent.current?.file===current?intent.current.key:crypto.randomUUID());intent.current={file:current,key};
   const reserved=await json('reserve',{slug},{expectedVersionId:versionId,metadata:{name:current.name,mediaType,sha256:hash,sizeBytes:current.size,attestation:true}},key);if(!alive())return;const id=reserved.sample.id;intent.current={file:current,key,id};
   if(!['uploaded','processing','ready'].includes(reserved.sample.state)){
    const {data:{session}}=await createClient().auth.getSession();if(!session?.access_token)throw Error('unauthorized');if(!alive())return;
    const core=(process.env.NEXT_PUBLIC_IMPLEXA_API_URL||'https://core.implexa.ai').replace(/\/$/,'');
    await new Promise<void>((resolve,reject)=>{const request=new XMLHttpRequest();xhr.current=request;request.open('PUT',`${core}/api/v2/agent-training/marketplace-samples/${id}/upload`);request.setRequestHeader('Authorization',`Bearer ${session.access_token}`);request.setRequestHeader('Content-Type','application/octet-stream');request.timeout=150000;request.upload.onprogress=e=>{if(alive())setStatus(e.lengthComputable?`Uploading your example… ${Math.round(e.loaded/e.total*100)}%`:'Uploading your example…');};request.onload=()=>{try{const result=JSON.parse(request.responseText);request.status>=200&&request.status<300&&result.ok?resolve():reject(Error(result.reason||'sample_request_unconfirmed'));}catch{reject(Error('sample_request_unconfirmed'));}};request.onerror=request.ontimeout=request.onabort=()=>reject(Error('sample_request_unconfirmed'));request.send(current);});
   }
   if(!alive())return;setStatus('Preparing your preview… This can take about a minute.');await json('prepare',{id},{startMs:video?Math.round(start*1000):0,endMs:video?Math.round(end*1000):0});if(!alive())return;
   await onChanged(id);if(!alive())return;setFile(null);intent.current=null;setStatus('Example ready. It stays private until your listing is approved.');
  }catch(e){if(alive()){setError(messages[(e as Error).message]||'We could not confirm the upload. Retry with the same file; completed work will be reused.');await onChanged().catch(()=>{});}}
  finally{if(alive()){setBusy(false);onBusy(false);xhr.current=null;}}
 }
 async function remove(id:string){if(busy)return;const captured=epoch.current;setBusy(true);onBusy(true);setError('');try{await json('remove',{id},{});if(captured===epoch.current){await onChanged();setRemoving(null);}}catch{if(captured===epoch.current)setError('Removal is not confirmed yet. Retry to finish deleting its stored copy.');}finally{if(captured===epoch.current){setBusy(false);onBusy(false);}}}
 return <div className="space-y-4">
  <input ref={input} type="file" hidden accept="image/png,image/jpeg,image/webp,video/mp4,video/quicktime,.mov,.mp4,.png,.jpg,.jpeg,.webp" onChange={e=>{choose(e.target.files?.[0]);e.target.value='';}}/>
  <button type="button" className="btn-outline" disabled={busy||uploads.length>=3&&!uploads.some(s=>s.state!=='ready'&&s.state!=='deleting')} onClick={()=>input.current?.click()}>＋ Upload an example</button>
  <p className="text-xs text-ink-400">Up to 3 uploads. Images up to 10 MB; videos up to 100 MB, with a preview up to 60 seconds.</p>
  {file&&<div className="rounded-xl border border-ink-700 p-4 space-y-4"><strong className="block break-all text-sm">{file.name}</strong>{video?<video src={url} controls preload="metadata" className="max-h-56 w-full rounded-lg" onError={()=>setUnsupported(true)} onLoadedMetadata={e=>{const d=e.currentTarget.duration;if(Number.isFinite(d)&&d>0){setSeconds(d);setEnd(Math.min(60,d));}}}/>:<img src={url} alt="Your selected example" className="max-h-56 rounded-lg"/>}
   {video&&<><p className="text-sm text-ink-400">{unsupported?'Your browser cannot play this format. You can still choose its excerpt by time.':'Choose the part customers will see.'}</p><div className="flex flex-wrap gap-4">{([['Start',start,setStart],['End',end,setEnd]] as const).map(([label,value,set])=><label key={label} className="text-sm">{label} (seconds)<input type="number" className="mt-1 block w-28 rounded-md border border-ink-700 bg-ink-900 p-2" min={0} step={.1} disabled={busy} value={value} onChange={e=>set(Number(e.target.value))}/></label>)}</div></>}
   <label className="flex gap-3 text-sm text-ink-300"><input type="checkbox" checked={attested} disabled={busy} onChange={e=>setAttested(e.target.checked)}/>I own this example and it contains no customer material.</label>
   <div className="flex gap-3"><button type="button" className="btn-primary" disabled={!attested||busy} onClick={()=>void run()}>{busy?'Preparing…':'Add example'}</button><button type="button" className="btn-outline" disabled={busy} onClick={()=>setFile(null)}>Cancel</button></div>
  </div>}
  {status&&<p role="status" className="text-sm text-ink-400">{status}</p>}{error&&<p role="alert" className="text-sm text-state-needs">{error}</p>}
  {uploads.length>0&&<details className="text-sm text-ink-400"><summary className="cursor-pointer">Manage stored uploads ({uploads.length})</summary><div className="mt-3 space-y-3">{uploads.map(s=><div key={s.id} className="flex flex-wrap justify-between gap-3 text-xs text-ink-400"><span className="break-all">{s.name}{s.state!=='ready'?` · ${s.state==='deleting'?'Removal pending':s.state==='processing'?'Preparing preview':s.state==='failed'?'Upload unfinished':'Upload unfinished; choose the same file to retry'}`:''}</span><button type="button" disabled={busy} className="underline" onClick={()=>setRemoving(s.id)}>Remove stored upload</button></div>)}</div></details>}
 <Modal open={removing!==null} onClose={()=>{if(!busy)setRemoving(null);}} title="Delete this example?"><p className="text-sm text-ink-300">Delete the uploaded example and its stored original. This cannot be undone.</p><div className="mt-5 flex gap-3"><button type="button" className="btn-primary" disabled={busy} onClick={()=>{if(removing)void remove(removing);}}>{busy?'Deleting…':'Delete stored copy'}</button><button type="button" className="btn-outline" disabled={busy} onClick={()=>setRemoving(null)}>Cancel</button></div></Modal>
 </div>;
}
