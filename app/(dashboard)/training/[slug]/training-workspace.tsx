'use client';

import Link from 'next/link';
import Modal from '../../_components/modal';
import {createPortal} from 'react-dom';
import {useEffect,useLayoutEffect,useId,useRef,useState,type ComponentProps,type ReactNode} from 'react';
import {parsePreviewUrl,requestPreview,revokePreview,previewKind} from '@/lib/review-preview';
import {teachingFrame,teachingDigest} from '@/lib/training-teaching-draft';
import type {ReviewArtifact} from '@/lib/review';

export type TrainingView='start'|'teach'|'history'|'settings';
export type TrainingRun={id:string;date:string;status:string;artifact:ReviewArtifact|null};

/** Training panels remain mounted while hidden; interruptions stay outside those panels. */
export function TrainingDialog(props:ComponentProps<typeof Modal>){
 const [mounted,setMounted]=useState(false);useEffect(()=>setMounted(true),[]);
 return mounted?createPortal(<Modal {...props}/>,document.body):null;
}

export type TrainingStep=1|2|3;
export function TrainingSteps({active,pending,onSelect}:{active:TrainingStep;pending:number;onSelect:(step:TrainingStep)=>void}){
 const labels=['Teach Agent','Review training','Apply & Test'] as const;
 return <nav aria-label="Training steps" className="flex flex-wrap items-center gap-3 sm:gap-5">{labels.map((label,index)=>{const step=(index+1) as TrainingStep;return <button key={step} type="button" aria-current={active===step?'step':undefined} onClick={()=>onSelect(step)} className={`rounded-lg px-3 py-2 text-left transition-colors ${active===step?'bg-brand-500/10 text-lg font-medium text-brand-400':'text-sm text-ink-500 hover:text-ink-200'}`}><span className="mr-2">Step {step}:</span>{label}{step===3&&pending>0&&<span className="ml-2 inline-block rounded-full bg-brand-500/10 px-2 py-1 text-xs text-brand-400">{pending} unapplied learning{pending===1?'':'s'}</span>}</button>;})}</nav>;
}
/** New bullet responses stay readable; older prose is preserved as plain text. */
export function TrainingExplanation({text}:{text:string}){
 const lines=text.split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
 return lines.length>0&&lines.every(line=>line.startsWith('- '))?<ul className="list-disc space-y-2 pl-5">{lines.map((line,index)=><li key={index}>{line.slice(2)}</li>)}</ul>:<p className="whitespace-pre-wrap">{text}</p>;
}
/** Applicability is labelled by the card, not repeated inside its saved sentence. */
export function trainingApplicability(text:string){return text.replace(/^(?:applies\s+when\s*:?\s*)+/i,'');}

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

/** One source picker. Existing Training, recorder and Review Room still own each action. */
export function TrainingEntry({slug,lastRunId,runs=[],runsUnavailable=false,actions,onChat,chatExpanded=false,chatDisabled=false,onSelectRun,selectedRunId,sourceActive=false}:{slug:string;lastRunId?:string|null;runs?:TrainingRun[];runsUnavailable?:boolean;actions?:ReactNode;onChat?:()=>void;chatExpanded?:boolean;chatDisabled?:boolean;onSelectRun?:(run:TrainingRun)=>void;selectedRunId?:string|null;sourceActive?:boolean}){
 const [resultsOpen,setResultsOpen]=useState(!sourceActive);
 useEffect(()=>{if(sourceActive)setResultsOpen(false);},[sourceActive,selectedRunId]);
 const pickerClass='inline-flex items-center gap-2 rounded-lg border border-ink-700 px-4 py-2.5 text-sm text-ink-200 hover:border-ink-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500 disabled:opacity-40';
 return <section className="space-y-4 py-3" aria-label="Teach this agent">
  <div className="flex flex-wrap items-start gap-2" aria-label="Choose a training source">
   {actions}
   <button type="button" aria-expanded={resultsOpen} aria-controls="training-recent-results" onClick={()=>setResultsOpen(!resultsOpen)} className={pickerClass}>▧ Recent results</button>
   {onChat&&<button id="training-chat-toggle" type="button" className={`${pickerClass} sm:ml-auto`} disabled={chatDisabled} aria-expanded={chatExpanded} aria-controls="training-companion" onClick={onChat}>✧ {chatExpanded?'Close chat':'Chat with Implexa'}</button>}
  </div>
  <div id="training-recent-results" hidden={!resultsOpen} className="rounded-xl border border-ink-800 bg-ink-900/20 p-4">
   {resultsOpen&&<><div className="mb-3 flex items-baseline justify-between gap-4"><h2 className="text-sm font-medium text-ink-200">Choose a result</h2><Link className="text-xs text-ink-400 hover:text-ink-100" href={`/training/${encodeURIComponent(slug)}/runs`}>All runs →</Link></div>
   {runs.length?<div className="flex snap-x gap-3 overflow-x-auto pb-1">{runs.map((run,index)=>{
    const content=<>
     {run.artifact?<RunImage artifact={run.artifact}/>:<span className="flex aspect-video items-center justify-center rounded-lg bg-ink-900 text-xs text-ink-500">No preview</span>}
     <span className="flex items-baseline justify-between gap-2 text-xs"><span>{index===0?'Latest result':`Result ${index+1}`}</span><span className="text-ink-500">{run.status}</span></span>
     <time dateTime={run.date} className="block text-[11px] text-ink-500">{new Date(run.date).toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'UTC'})}</time>
    </>;
    const className=`w-40 shrink-0 snap-start space-y-2 rounded-xl p-1 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500 sm:w-44 ${selectedRunId===run.id?'ring-1 ring-brand-500':'hover:bg-ink-800/30'}`;
    return onSelectRun?<button key={run.id} type="button" aria-pressed={selectedRunId===run.id} aria-label={`Teach from ${index===0?'latest result':`result ${index+1}`}`} className={className} onClick={()=>onSelectRun(run)}>{content}</button>:<Link key={run.id} href={`/training/${encodeURIComponent(slug)}/review/${encodeURIComponent(run.id)}`} className={className}>{content}</Link>;
   })}</div>:<p className="text-sm text-ink-500">{runsUnavailable?'Recent results couldn’t load. ':lastRunId?'Open your latest result to give feedback. ':'Record or upload an example, or run your agent to review its work. '}{lastRunId&&<Link href={`/training/${encodeURIComponent(slug)}/review/${encodeURIComponent(lastRunId)}`} className="text-ink-300 underline underline-offset-4">Latest result →</Link>}</p>}</>}
  </div>
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
