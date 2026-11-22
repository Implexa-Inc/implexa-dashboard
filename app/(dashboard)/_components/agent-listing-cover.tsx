
'use client';
import {useEffect,useState} from 'react';
import type {ListingSample} from '@/lib/approved-marketplace-listings';
import {sampleUrl} from '../training/[slug]/marketplace-samples';
/** Optional artwork loads independently; it never delays Run, Setup or the page. */
export default function AgentListingCover({familyId}:{familyId:string}){
 const [cover,setCover]=useState<ListingSample|null>(null),[failed,setFailed]=useState(false);
 useEffect(()=>{let current=true;const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),4000);setCover(null);setFailed(false);
  fetch(`/api/agent-training/marketplace-samples?action=cover&familyId=${encodeURIComponent(familyId)}`,{cache:'no-store',signal:controller.signal}).then(async r=>{if(!r.ok)return;const v=await r.json(),m=v.cover;if(!current||!v.ok||v.familyId!==familyId||!m)return;
   if(/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(m.id||'')&&m.kind==='uploaded'&&m.provenance==='trainer_uploaded'&&['image/jpeg','video/mp4'].includes(m.mediaType)&&typeof m.name==='string'&&m.name.length<=120)setCover(m);
  }).catch(()=>{}).finally(()=>clearTimeout(timer));return()=>{current=false;clearTimeout(timer);controller.abort();};
 },[familyId]);
 if(!cover||failed)return <div className="agent-sample-placeholder" role="img" aria-label="Sample preview unavailable"><span>Sample output</span><p>A sample preview is not available here yet.</p></div>;
 return <figure className="agent-listing-cover">{cover.mediaType==='video/mp4'?<video controls playsInline preload="none" src={sampleUrl(cover.id,'preview')} poster={sampleUrl(cover.id)} onError={()=>setFailed(true)}/>:<img src={sampleUrl(cover.id,'preview')} alt={cover.name} onError={()=>setFailed(true)}/>}<figcaption>Trainer-provided example</figcaption></figure>;
}
