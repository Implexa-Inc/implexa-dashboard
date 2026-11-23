'use client';
import {useEffect,useRef,useState,type PointerEvent as ReactPointerEvent,type ReactNode,type Ref} from 'react';
import {formatMediaTime} from '@/lib/review-anchor';

const DRAG_PX=4;
export type TimelineRange={startMs:number;endMs:number};
export type TimelineEdge='startMs'|'endMs';
export type TimelineMark={id:string;startMs:number;endMs:number|null;selected?:boolean;resizable?:boolean;title?:string};

/** Snapped, clamped, ordered. Callers with their own limits pass `toRange`. */
export function timelineRange(anchorMs:number,headMs:number,durationMs:number,snapMs:number):TimelineRange|null{
 if(![anchorMs,headMs,durationMs].every(Number.isFinite)||durationMs<=0)return null;
 const fit=(value:number)=>Math.max(0,Math.min(Math.round(durationMs),Math.round(snapMs>0?Math.round(value/snapMs)*snapMs:value)));
 const a=fit(anchorMs),b=fit(headMs);
 return {startMs:Math.min(a,b),endMs:Math.max(a,b)};
}

export function AnnotationTimelineTicks({durationMs}:{durationMs:number}){
 const interval=Math.max(1000,Math.ceil(durationMs/60000)*1000);
 return <div className="recording-ticks" aria-hidden="true">{Array.from({length:Math.floor(durationMs/interval)+1},(_,i)=><span key={i} style={{left:`${i*interval/Math.max(1,durationMs)*100}%`}}>{i%5===0?formatMediaTime(i*interval).replace('.000',''):''}</span>)}</div>;
}

/** One decoder for an already-authorized preview: the frame under the pointer,
 * without moving the player. Anonymous CORS keeps the sampling honest; a preview
 * that cannot be sampled reports `unavailable` instead of showing a wrong frame. */
export function useTimelineFramePreview(url:string|null,hoverMs:number|null){
 const [image,setImage]=useState<{second:number;url:string}|null>(null),[unavailable,setUnavailable]=useState(false);
 const decoder=useRef<HTMLVideoElement|null>(null),wanted=useRef<number|null>(null);
 useEffect(()=>{
  if(!url)return;
  const video=document.createElement('video');video.crossOrigin='anonymous';video.muted=true;video.preload='metadata';
  decoder.current=video;setImage(null);setUnavailable(false);let live=true;
  const fail=()=>{if(live)setUnavailable(true);};
  const capture=()=>{
   if(!live||wanted.current===null||!video.videoWidth||!video.videoHeight||Math.abs(video.currentTime-wanted.current)>.2)return;
   try{const canvas=document.createElement('canvas');canvas.width=Math.min(1280,video.videoWidth);canvas.height=Math.max(1,Math.round(canvas.width*video.videoHeight/video.videoWidth));const context=canvas.getContext('2d');if(!context)return;context.drawImage(video,0,0,canvas.width,canvas.height);setImage({second:wanted.current,url:canvas.toDataURL('image/jpeg',.65)});}
   catch{fail();}
  };
  const seekWanted=()=>{if(wanted.current!==null)video.currentTime=Math.min(wanted.current,Math.max(0,video.duration-.01));};
  video.addEventListener('loadedmetadata',seekWanted);video.addEventListener('loadeddata',capture);video.addEventListener('seeked',capture);video.addEventListener('error',fail);
  return()=>{live=false;decoder.current=null;video.removeEventListener('loadedmetadata',seekWanted);video.removeEventListener('loadeddata',capture);video.removeEventListener('seeked',capture);video.removeEventListener('error',fail);if(video.getAttribute('src')){video.removeAttribute('src');video.load();}};
 },[url]);
 const second=hoverMs===null?null:Math.round(hoverMs/100)/10;
 useEffect(()=>{
  wanted.current=second;
  if(second===null||!url||unavailable)return;
  const timer=window.setTimeout(()=>{const video=decoder.current;if(!video)return;if(!video.getAttribute('src'))video.src=url;else if(video.readyState>=1)video.currentTime=Math.min(second,Math.max(0,video.duration-.01));},180);
  return()=>window.clearTimeout(timer);
 },[second,url,unavailable]);
 return {image:second!==null&&image?.second===second?image:null,anyImage:image,unavailable};
}

/** The one annotation timeline, for results and recordings.
 * Click jumps. Dragging the round playhead handle scrubs. Dragging across empty
 * bar marks a range (when `onRange` is given; otherwise it scrubs). Moving over
 * the bar previews the time. Resizable marks have draggable, arrow-key ends.
 * The native slider in the transport stays the screen-reader seek path. */
export default function AnnotationTimeline({durationMs,playheadMs,marks,onSeek,onOpen,onRange,onRangeDraft,toRange,onResizeStart,onResize,onResizeEnd,onResizeKey,resizeDisabled=false,onHover,hoverContent,label,noun='Note',snapMs=100,playLineRef,children}:{
 durationMs:number;playheadMs:number;marks:TimelineMark[];
 onSeek:(ms:number)=>void;onOpen:(id:string)=>void;
 onRange?:(range:TimelineRange)=>void;onRangeDraft?:(range:TimelineRange|null)=>void;
 toRange?:(anchorMs:number,headMs:number)=>TimelineRange|null;
 onResizeStart?:(id:string,edge:TimelineEdge)=>void;onResize?:(id:string,edge:TimelineEdge,ms:number)=>void;
 onResizeEnd?:(id:string,edge:TimelineEdge,cancelled:boolean)=>void;onResizeKey?:(id:string,edge:TimelineEdge,direction:-1|1)=>void;
 resizeDisabled?:boolean;onHover?:(ms:number|null)=>void;hoverContent?:(ms:number)=>ReactNode;
 label?:string;noun?:string;snapMs?:number;playLineRef?:Ref<HTMLDivElement>;
 children?:(pctOf:(ms:number)=>string)=>ReactNode;
}){
 const bar=useRef<HTMLDivElement>(null),gesture=useRef<{anchorMs:number;startX:number;dragging:boolean}|null>(null);
 const scrubbing=useRef(false),resizing=useRef<{id:string;edge:TimelineEdge}|null>(null);
 const [hoverMs,setHoverMs]=useState<number|null>(null),[draft,setDraft]=useState<TimelineRange|null>(null);
 const total=Math.max(1,durationMs),pctOf=(ms:number)=>`${ms/total*100}%`;
 const at=(clientX:number)=>{const rect=bar.current?.getBoundingClientRect();return !rect||rect.width<=0||durationMs<=0?0:Math.min(durationMs,Math.max(0,(clientX-rect.left)/rect.width*durationMs));};
 const range=(anchorMs:number,headMs:number)=>toRange?toRange(anchorMs,headMs):timelineRange(anchorMs,headMs,durationMs,snapMs);
 const hover=(ms:number|null)=>{setHoverMs(ms);onHover?.(ms);};
 const showDraft=(next:TimelineRange|null)=>{setDraft(next);onRangeDraft?.(next);};
 const down=(e:ReactPointerEvent<HTMLDivElement>)=>{
  if(durationMs<=0||e.button!==0)return;
  e.currentTarget.setPointerCapture?.(e.pointerId);
  gesture.current={anchorMs:at(e.clientX),startX:e.clientX,dragging:false};
 };
 const move=(e:ReactPointerEvent<HTMLDivElement>)=>{
  hover(Math.round(at(e.clientX)));
  const g=gesture.current;if(!g||durationMs<=0)return;
  if(!g.dragging&&Math.abs(e.clientX-g.startX)<=DRAG_PX)return;
  g.dragging=true;
  if(onRange)showDraft(range(g.anchorMs,at(e.clientX)));else onSeek(Math.round(at(e.clientX)));
 };
 const up=(e:ReactPointerEvent<HTMLDivElement>)=>{
  const g=gesture.current;gesture.current=null;if(!g||durationMs<=0)return;
  if(!g.dragging){onSeek(Math.round(g.anchorMs));return;}
  if(!onRange){onSeek(Math.round(at(e.clientX)));return;}
  const next=range(g.anchorMs,at(e.clientX));showDraft(null);
  if(next&&next.endMs>next.startMs)onRange(next);
 };
 const lower=noun.toLowerCase();
 return <div ref={bar} className={`recording-timeline relative mt-3 h-16 select-none rounded bg-ink-800/70 ${onRange?'cursor-text':'cursor-pointer'}`} role="group"
  aria-label={label||(onRange?'Timeline. Click to jump, drag to mark a range, drag the round handle to scrub.':'Timeline. Click to jump, drag to scrub.')}
  onPointerDown={down} onPointerMove={move} onPointerLeave={()=>hover(null)} onPointerUp={up}
  onPointerCancel={()=>{gesture.current=null;showDraft(null);}}>
  <AnnotationTimelineTicks durationMs={durationMs}/>
  {hoverMs!==null&&<><div className="timeline-ghost" aria-hidden="true" style={{left:pctOf(hoverMs)}}/><output className="timeline-hover" style={{left:pctOf(hoverMs)}}>{hoverContent?.(hoverMs)}{formatMediaTime(hoverMs)}</output></>}
  {children?.(pctOf)}
  {marks.map((mark,i)=>{const end=Math.max(mark.startMs,mark.endMs??mark.startMs);return <div key={mark.id} className={`recording-moment-bar absolute top-2 bottom-2 rounded-sm ${mark.selected?'is-selected':''}`}
   style={{left:pctOf(mark.startMs),width:`max(28px, ${pctOf(end-mark.startMs)})`}}>
   <button type="button" className="h-full w-full" aria-label={`${noun} ${i+1} at ${formatMediaTime(mark.startMs)}`} title={mark.title}
    onPointerDown={e=>e.stopPropagation()} onClick={()=>onOpen(mark.id)}>{i+1}</button>
   {mark.resizable&&onResize&&(['startMs','endMs'] as const).map(edge=><button key={edge} type="button" className={`moment-resize ${edge==='startMs'?'start':'end'}`}
    aria-label={`${edge==='startMs'?'Start':'End'} of ${lower} ${i+1}`} title="Drag to adjust; arrow keys adjust by 0.1 second" disabled={resizeDisabled}
    onPointerDown={e=>{e.stopPropagation();if(e.button!==0)return;resizing.current={id:mark.id,edge};onResizeStart?.(mark.id,edge);e.currentTarget.setPointerCapture?.(e.pointerId);}}
    onPointerMove={e=>{e.stopPropagation();const g=resizing.current;if(g?.id===mark.id&&g.edge===edge)onResize(mark.id,edge,at(e.clientX));}}
    onPointerUp={e=>{e.stopPropagation();if(resizing.current){resizing.current=null;onResizeEnd?.(mark.id,edge,false);}}}
    onPointerCancel={e=>{e.stopPropagation();if(resizing.current){resizing.current=null;onResizeEnd?.(mark.id,edge,true);}}}
    onKeyDown={e=>{if(e.key!=='ArrowLeft'&&e.key!=='ArrowRight')return;e.preventDefault();e.stopPropagation();onResizeKey?.(mark.id,edge,e.key==='ArrowLeft'?-1:1);}}/>)}
  </div>;})}
  {draft&&<div className="pointer-events-none absolute top-0 bottom-0 rounded-sm border-2 border-sky-300 bg-sky-300/20" style={{left:pctOf(draft.startMs),width:pctOf(draft.endMs-draft.startMs)}}/>}
  <div ref={playLineRef} className="recording-playhead pointer-events-none absolute top-0 bottom-0 w-px" style={{left:pctOf(playheadMs)}}>
   {/* Mouse/touch scrub. Not focusable: the transport's native slider is the keyboard path. */}
   <span className="timeline-playhead-handle" aria-hidden="true" title="Drag to scrub"
    onPointerDown={e=>{e.stopPropagation();if(e.button!==0||durationMs<=0)return;scrubbing.current=true;e.currentTarget.setPointerCapture?.(e.pointerId);}}
    onPointerMove={e=>{e.stopPropagation();if(scrubbing.current)onSeek(Math.round(at(e.clientX)));}}
    onPointerUp={e=>{e.stopPropagation();scrubbing.current=false;}}
    onPointerCancel={e=>{e.stopPropagation();scrubbing.current=false;}}/>
  </div>
 </div>;
}
