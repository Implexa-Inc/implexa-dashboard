'use client';
import {formatMediaTime} from '@/lib/review-anchor';

export function AnnotationTimelineTicks({durationMs}:{durationMs:number}){
 const interval=Math.max(1000,Math.ceil(durationMs/60000)*1000);
 return <div className="recording-ticks" aria-hidden="true">{Array.from({length:Math.floor(durationMs/interval)+1},(_,i)=><span key={i} style={{left:`${i*interval/Math.max(1,durationMs)*100}%`}}>{i%5===0?formatMediaTime(i*interval).replace('.000',''):''}</span>)}</div>;
}
export default function AnnotationTimeline({durationMs,playheadMs,marks,onSeek,onOpen}:{durationMs:number;playheadMs:number;marks:Array<{id:string;startMs:number;endMs:number|null}>;onSeek:(ms:number)=>void;onOpen:(id:string)=>void}){
 return <div className="recording-timeline relative mt-3 cursor-pointer select-none rounded bg-ink-800/70" role="group" aria-label="Result timeline. Click to seek."
  onClick={event=>{const r=event.currentTarget.getBoundingClientRect();if(r.width&&durationMs>0)onSeek(Math.max(0,Math.min(durationMs,(event.clientX-r.left)/r.width*durationMs)));}}>
  <AnnotationTimelineTicks durationMs={durationMs}/>
  {marks.map((mark,i)=><button key={mark.id} type="button" className="recording-moment-bar absolute rounded-sm" style={{left:`${mark.startMs/Math.max(1,durationMs)*100}%`,width:`max(28px, ${(Math.max(mark.startMs,mark.endMs??mark.startMs)-mark.startMs)/Math.max(1,durationMs)*100}%)`}} aria-label={`Note ${i+1} at ${formatMediaTime(mark.startMs)}`} onClick={event=>{event.stopPropagation();onOpen(mark.id);}}>{i+1}</button>)}
  <div className="recording-playhead pointer-events-none absolute top-0 bottom-0 w-px" style={{left:`${playheadMs/Math.max(1,durationMs)*100}%`}}/>
 </div>;
}
