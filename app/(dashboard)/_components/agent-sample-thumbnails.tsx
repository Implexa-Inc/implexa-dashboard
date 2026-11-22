'use client';
import {useEffect,useState} from 'react';
import type {ListingSample} from '@/lib/approved-marketplace-listings';
import {sampleUrl} from '../training/[slug]/marketplace-samples';
export type CoverMap=Record<string,ListingSample>;
const uuid=/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
/** Account-keyed collection parents remount this state on sign-in changes.
 * Optional images load in bounded batches, independently of roster readiness. */
export function useAgentSampleThumbnails(families:(string|undefined)[]){
 const key=JSON.stringify([...new Set(families.filter((id):id is string=>typeof id==='string'&&uuid.test(id)))].sort().slice(0,200));
 const [value,setValue]=useState<{key:string;map:CoverMap}>({key:'',map:{}});
 useEffect(()=>{const ids=JSON.parse(key) as string[];if(!ids.length)return;let current=true;const controller=new AbortController();const map:CoverMap={};
  void (async()=>{for(let offset=0;offset<ids.length&&current;offset+=50){const batch=ids.slice(offset,offset+50);const timer=setTimeout(()=>controller.abort(),5000);
   try{const response=await fetch(`/api/agent-training/marketplace-samples?action=covers&familyIds=${batch.join(',')}`,{cache:'no-store',signal:controller.signal});if(!response.ok)return;const result=await response.json();if(!current||!result.ok||!Array.isArray(result.items)||result.items.length>batch.length)return;
    const seen=new Set();for(const item of result.items){if(!batch.includes(item?.familyId)||seen.has(item.familyId))return;seen.add(item.familyId);const m=item.cover;if(m===null)continue;if(!m||!uuid.test(m.id||'')||m.kind!=='uploaded'||m.provenance!=='trainer_uploaded'||!['image/jpeg','video/mp4'].includes(m.mediaType))return;map[item.familyId]={id:m.id,kind:'uploaded',name:'Trainer-provided example',mediaType:m.mediaType,width:m.width,height:m.height,durationMs:m.durationMs,provenance:'trainer_uploaded'};}
    if(current)setValue({key,map:{...map}});
   }catch{return;}finally{clearTimeout(timer);}
  }})();return()=>{current=false;controller.abort();};
 },[key]);
 return value.key===key?value.map:{};
}
export function AgentSampleThumbnail({cover,icon='agents'}:{cover?:ListingSample;icon?:string}){
 const [failed,setFailed]=useState(false);useEffect(()=>setFailed(false),[cover?.id]);
 return cover&&!failed?<img src={sampleUrl(cover.id)} alt="Trainer-provided example" loading="lazy" className="h-full w-full rounded-[inherit] object-cover" onError={()=>setFailed(true)}/>:<svg aria-hidden="true"><use href={`/brand/tukido-icons.svg#${icon}`}/></svg>;
}
