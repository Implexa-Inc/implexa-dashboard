'use client';

import Link from 'next/link';
import {createPortal} from 'react-dom';
import {useEffect,useLayoutEffect,useId,useRef,useState,type ReactNode} from 'react';
import {parsePreviewUrl,requestPreview,revokePreview,previewKind} from '@/lib/review-preview';
import {teachingFrame,teachingDigest} from '@/lib/training-teaching-draft';
import type {ReviewArtifact} from '@/lib/review';

export type TrainingView='start'|'teach'|'history'|'settings';
export type TrainingRun={id:string;date:string;status:string;artifact:ReviewArtifact|null};

/** Explanations are available to hover, keyboard and touch without filling the page. */
export function TrainingInfo({label,children}:{label:string;children:ReactNode}){
 const id=useId(),[pinned,setPinned]=useState(false),[hover,setHover]=useState(false);
 const open=pinned||hover,button=useRef<HTMLButtonElement>(null),tooltip=useRef<HTMLSpanElement>(null);
 const [position,setPosition]=useState({left:12,top:12});
 useLayoutEffect(()=>{
  if(!open)return;
  const place=()=>{if(!button.current||!tooltip.current)return;const rect=button.current.getBoundingClientRect(),height=tooltip.current.offsetHeight,width=tooltip.current.offsetWidth;
   setPosition({left:Math.max(12,Math.min(rect.right-width,window.innerWidth-width-12)),top:rect.bottom+8+height>window.innerHeight-12?Math.max(12,rect.top-height-8):rect.bottom+8});};
  place();window.addEventListener('resize',place);window.addEventListener('scroll',place,true);
  return()=>{window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true);};
 },[open]);
 return <span className="relative inline-flex align-middle" onMouseEnter={()=>setHover(true)} onMouseLeave={()=>setHover(false)} onKeyDown={e=>{if(e.key==='Escape'&&open){e.stopPropagation();setPinned(false);setHover(false);}}}>
  <button ref={button} type="button" aria-label={label} aria-expanded={open} aria-controls={id} onClick={()=>setPinned(!pinned)} onBlur={e=>{if(!e.currentTarget.parentElement?.contains(e.relatedTarget as Node))setPinned(false);}} className="inline-flex h-6 w-6 items-center justify-center rounded-full text-xs text-ink-500 hover:text-ink-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500">ⓘ</button>
  <span ref={tooltip} id={id} role="tooltip" hidden={!open} style={position} className="fixed z-50 w-64 max-w-[75vw] rounded-xl border border-ink-700 bg-ink-900 p-4 text-left text-xs font-normal leading-5 text-ink-300 shadow-xl">{children}</span>
 </span>;
}

/** Uses the Review Room's existing short-lived, revocable local-file preview. */
function RunImage({artifact}:{artifact:ReviewArtifact}){
 const [image,setImage]=useState<{identity:string;url:string}|null>(null),[failed,setFailed]=useState(false);
 const identity=`${artifact.runId}:${artifact.id}:${artifact.sha256}`;
 useEffect(()=>{
  let live=true,token:string|null=null;setImage(null);setFailed(false);
  if(artifact.status==='validated'&&artifact.sha256&&['image','video'].includes(previewKind(artifact.relativePath)))void (async()=>{
   const result=await requestPreview(artifact.runId,artifact.id) as {ok?:boolean;url?:string};
   const parsed=result.ok&&parsePreviewUrl(result.url);if(!parsed)return;
   token=parsed.token;if(!live){await revokePreview(token);return;}setImage({identity,url:result.url!});
  })();
  return()=>{live=false;void revokePreview(token);};
 },[identity,artifact.status]);
 if(!image||image.identity!==identity||failed)return null;
 return previewKind(artifact.relativePath)==='video'?<video aria-label="Result preview" src={image.url} muted playsInline preload="metadata" onLoadedMetadata={event=>{const video=event.currentTarget;if(Number.isFinite(video.duration)&&video.duration>0)try{video.currentTime=Math.min(1,video.duration/2);}catch{/* The first decoded frame is still a usable preview. */}}} onError={()=>setFailed(true)} className="aspect-video w-full rounded-xl bg-ink-900 object-cover"/>:<img src={image.url} alt="Result preview" onError={()=>setFailed(true)} className="aspect-video w-full rounded-xl object-cover"/>;
}

let frameQueue:Promise<void>=Promise.resolve();

/** Only a digest-verified saved frame, never a new capture of a teaching's source. */
export function TrainingImage({token,recordId,recordDigest,frameSha256,alt,enabled=true,context='',expandable=false}:{token:string;recordId:string;recordDigest:string;frameSha256:string;alt:string;enabled?:boolean;context?:string;expandable?:boolean}){
 const previewId=useId();
 const [enlarged,setEnlarged]=useState(false),[previewPosition,setPreviewPosition]=useState({left:16,top:16,width:480});
 const [frame,setFrame]=useState<{identity:string;image:string}|null>(null);
 useEffect(()=>{if(!enabled)setEnlarged(false);},[enabled,token,recordId,recordDigest,frameSha256,context]);
 const identity=`${context}:${token}:${recordId}:${recordDigest}:${frameSha256}`;
 const marker=useRef<HTMLSpanElement>(null),attempted=useRef<string|null>(null),[visible,setVisible]=useState(false);
 useEffect(()=>{
  if(!marker.current||typeof IntersectionObserver==='undefined')return;
  const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){setVisible(true);observer.disconnect();}},{rootMargin:'100px'});
  observer.observe(marker.current);return()=>observer.disconnect();
 },[identity]);
 useEffect(()=>{
  let live=true;
  const local=(window as unknown as {implexaDesktop?:{trainingLocal?:(op:string,args:unknown)=>Promise<any>}}).implexaDesktop?.trainingLocal;
  if(local&&visible&&enabled&&frame?.identity!==identity&&attempted.current!==identity)frameQueue=frameQueue.then(async()=>{if(!live)return;attempted.current=identity;try{
   const value=await local('decisionPreview',{token,recordId});
   if(!live||!value.ok||value.recordId!==recordId||value.recordDigest!==recordDigest||typeof value.image!=='string')return;
   const bytes=teachingFrame(value.image);if(await teachingDigest(bytes)!==frameSha256||!live)return;
   setFrame({identity,image:value.image});
  }catch{/* Unavailable evidence remains a text row; the original review can explain it. */}});
  return()=>{live=false;};
 },[identity,visible,enabled,frame?.identity]);
 function enlarge(target:HTMLElement){const box=target.getBoundingClientRect(),width=Math.min(560,window.innerWidth-32),height=width*9/16;setPreviewPosition({width,left:Math.max(16,Math.min(box.left,window.innerWidth-width-16)),top:Math.max(16,Math.min(box.bottom+8,window.innerHeight-height-16))});setEnlarged(true);}
 return <span ref={marker} className="inline-flex min-h-px min-w-px shrink-0">{frame&&frame.identity===identity&&enabled&&(!expandable?<img src={frame.image} alt={alt} loading="lazy" className="aspect-video w-28 shrink-0 rounded-lg object-cover sm:w-36"/>:<>
  <button type="button" aria-label={`Enlarge ${alt.toLowerCase()}`} aria-expanded={enlarged} aria-describedby={enlarged?previewId:undefined} onMouseEnter={e=>enlarge(e.currentTarget)} onMouseLeave={()=>setEnlarged(false)} onFocus={e=>enlarge(e.currentTarget)} onBlur={()=>setEnlarged(false)} onClick={e=>{e.preventDefault();e.stopPropagation();enlarge(e.currentTarget);}} onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();setEnlarged(false);}}} className="rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500"><img src={frame.image} alt={alt} loading="lazy" className="aspect-video w-28 shrink-0 rounded-lg object-cover sm:w-36"/></button>
  {enlarged&&createPortal(<span id={previewId} role="tooltip" aria-label="Enlarged training image" style={previewPosition} className="pointer-events-none fixed z-50 overflow-hidden rounded-xl border border-ink-700 bg-ink-950 shadow-2xl"><img src={frame.image} alt={`${alt} — enlarged`} className="aspect-video w-full object-contain"/></span>,document.body)}
 </>)}</span>;
}

/** Presentation only: existing Training, recorder and Review Room own all actions. */
export function TrainingEntry({slug,lastRunId,runs=[],runsUnavailable=false,actions,onChat,chatExpanded=false,chatDisabled=false}:{slug:string;lastRunId?:string|null;runs?:TrainingRun[];runsUnavailable?:boolean;actions?:ReactNode;onChat?:()=>void;chatExpanded?:boolean;chatDisabled?:boolean}){
 return <section className="space-y-8 py-3" aria-label="Teach this agent">
  <div>
   <div className="mb-4 flex items-baseline justify-between gap-4"><h2 className="text-lg font-medium">Give feedback on recent runs</h2><Link className="text-xs text-ink-400 hover:text-ink-100" href={`/workflows/${encodeURIComponent(slug)}?source=generated&tab=runs`}>All runs →</Link></div>
   {runs.length?<div className="flex snap-x gap-5 overflow-x-auto pb-2">{runs.map((run,index)=><Link key={run.id} href={`/review/${encodeURIComponent(run.id)}`} className="w-52 shrink-0 snap-start space-y-3 rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500 sm:w-60">
    {run.artifact&&<RunImage artifact={run.artifact}/>}
    <span className="flex items-baseline justify-between gap-2 text-sm"><span>{index===0?'Latest result':`Result ${index+1}`}</span><span className="text-xs text-ink-500">{run.status}</span></span>
    <time dateTime={run.date} className="block text-xs text-ink-500">{new Date(run.date).toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'UTC'})}</time>
   </Link>)}</div>:<p className="text-sm text-ink-500">{runsUnavailable?'Recent results couldn’t load. ':lastRunId?'Open your latest result to give feedback. ':'Teach with an example, or run your agent to review its work. '}{lastRunId&&<Link href={`/review/${encodeURIComponent(lastRunId)}`} className="text-ink-300 underline underline-offset-4">Latest result →</Link>}</p>}
  </div>
  {actions}
  {onChat&&<section className="space-y-3 border-b border-ink-800 pb-6" aria-labelledby="training-conversation-heading"><h2 id="training-conversation-heading" className="text-lg font-medium">Chat with Implexa</h2><p className="max-w-2xl text-sm leading-6 text-ink-400">Discuss an idea, ask a question, or describe what you’d change.</p><button id="training-chat-toggle" type="button" className="rounded-lg border border-ink-700 px-4 py-2.5 text-sm text-ink-200 hover:border-ink-500 disabled:opacity-40" disabled={chatDisabled} aria-expanded={chatExpanded} aria-controls="training-companion" onClick={onChat}>{chatExpanded?'Close chat':'Start chatting'}</button></section>}
 </section>;
}

export function TrainingDetails({title,children,open=false}:{title:string;children:ReactNode;open?:boolean}){
 return <details open={open} className="rounded-xl border border-ink-800 bg-ink-900/20"><summary className="cursor-pointer px-4 py-3 text-sm font-medium text-ink-200">{title}</summary><div className="space-y-5 border-t border-ink-800 p-4 text-sm leading-6 [&_button]:rounded-md [&_button]:border [&_button]:border-ink-700 [&_button]:px-3 [&_button]:py-1.5 [&_button]:text-xs [&_button:disabled]:opacity-40">{children}</div></details>;
}

export function revealTrainingElement(id:string){
 const el=document.getElementById(id);if(!el)return;
 let parent:HTMLElement|null=el;
 while(parent){if(parent instanceof HTMLDetailsElement)parent.open=true;parent=parent.parentElement;}
 el.scrollIntoView({block:'center',behavior:'smooth'});
}
