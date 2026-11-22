'use client';
import {useEffect,useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import {inDesktopApp} from '@/lib/review-preview';
import Modal from './modal';

/** Full-page image/result drafts need the same link guard as recording notes. */
export default function AnnotationLeaveGuard({dirty}:{dirty:boolean}){
 const router=useRouter(),[href,setHref]=useState<string|null>(null);
 const traversal=useRef<null|(()=>void)>(null),allowTraversal=useRef(false);
 useEffect(()=>{
  // Cancel a browser Back/Forward traversal before Next commits it. Confirming
  // repeats that exact history entry rather than inventing a replacement URL.
  type TraversalEvent=Event&{navigationType:string;destination:{key:string;url:string}};
  const navigation=(window as unknown as {navigation?:EventTarget&{traverseTo:(key:string)=>unknown}}).navigation;
  if(!navigation||!dirty)return;
  const navigate=(raw:Event)=>{const event=raw as TraversalEvent;
   if(event.navigationType!=='traverse'||!event.cancelable)return;
   if(allowTraversal.current){allowTraversal.current=false;return;}
   event.preventDefault();traversal.current=()=>{allowTraversal.current=true;navigation.traverseTo(event.destination.key);};setHref(event.destination.url);
  };
  navigation.addEventListener('navigate',navigate);return()=>navigation.removeEventListener('navigate',navigate);
 },[dirty]);
 useEffect(()=>{
  if(!dirty)return;
  const before=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};
  const click=(event:MouseEvent)=>{
   if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
   const link=(event.target as Element|null)?.closest<HTMLAnchorElement>('a[href]');
   if(!link||link.target==='_blank'||link.hasAttribute('download'))return;
   const next=new URL(link.href,window.location.href);
   if(next.origin!==window.location.origin||next.pathname+next.search===window.location.pathname+window.location.search)return;
   event.preventDefault();event.stopPropagation();traversal.current=null;setHref(next.pathname+next.search+next.hash);
  };
  if(!inDesktopApp())window.addEventListener('beforeunload',before);
  document.addEventListener('click',click,true);
  return()=>{window.removeEventListener('beforeunload',before);document.removeEventListener('click',click,true);};
 },[dirty]);
 return <Modal open={href!==null} onClose={()=>{traversal.current=null;setHref(null);}} title="Leave without saving?">
  <p>Your current note or teaching is not finished. Keep editing to preserve it.</p>
  <div className="mt-5 flex justify-end gap-3"><button type="button" className="btn-outline" onClick={()=>{traversal.current=null;setHref(null);}}>Keep editing</button><button type="button" className="btn-danger" onClick={()=>{const target=href,go=traversal.current;traversal.current=null;setHref(null);if(go)go();else if(target)router.push(target);}}>Leave without saving</button></div>
 </Modal>;
}
