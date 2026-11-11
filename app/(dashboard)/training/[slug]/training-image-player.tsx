'use client';
import {useRef,useState} from 'react';
import ReviewSpatialOverlay from '../../_components/review-spatial-overlay';
import TrainerVoiceNote from '../../_components/trainer-voice-note';
import type {DraftSpatial} from '@/lib/review-timestamp-feedback';

export default function TrainingImagePlayer({ownerId,sourceId,image,timeMs,text,disabled,onChange,onDone,onVoiceDirtyChange}:{
 ownerId:string;sourceId:string;image:string;timeMs:number;text:string;disabled:boolean;
 onChange:(text:string,spatial:DraftSpatial|null)=>void;onDone:()=>void;onVoiceDirtyChange?:(dirty:boolean)=>void;
}){
 const element=useRef<HTMLImageElement|null>(null),[spatial,setSpatial]=useState<DraftSpatial|null>(null),[voicePending,setVoicePending]=useState(false);
 const region=spatial?.geometry.kind==='rect'?{x:Math.round(spatial.geometry.x*1000000),y:Math.round(spatial.geometry.y*1000000),width:Math.round(spatial.geometry.width!*1000000),height:Math.round(spatial.geometry.height!*1000000)}:{x:0,y:0,width:1000000,height:1000000};
 return <section aria-label="Teach from an image" className="space-y-4 rounded-xl border border-ink-800 p-4">
  <div className="relative"><img ref={element} src={image} alt="Your training example" className="max-h-[60vh] w-full rounded-lg object-contain"/><ReviewSpatialOverlay mediaKind="image" controlsMode="external" mediaEl={()=>element.current} enabled={!disabled&&!voicePending} pins={[]} draftSpatial={spatial} freezeMedia={()=>null}
   onAnnotate={({spatial})=>{setSpatial(spatial);onChange(text,spatial);}}
   onNudgeDraft={point=>{if(spatial){const next={...spatial,geometry:{...spatial.geometry,...point}};setSpatial(next);onChange(text,next);}}}
   onCancelDraft={()=>{setSpatial(null);onChange(text,null);}} onOpenIssue={()=>{}}/>
  </div>
  <p className="text-xs text-ink-500">Click or drag on the picture to mark what matters.</p>
  <textarea aria-label="Your feedback on this image" placeholder="What should your agent learn from this?" value={text} disabled={disabled} rows={3} maxLength={600} onChange={event=>onChange(event.target.value,spatial)} className="w-full rounded-lg border border-ink-700 bg-ink-950 p-3 text-sm"/>
  <TrainerVoiceNote disabled={disabled} onDirtyChange={dirty=>{setVoicePending(dirty);onVoiceDirtyChange?.(dirty);}} ownerId={ownerId} attach={{sourceKind:'upload',sourceRef:sourceId,mark:{frameMs:timeMs,region}}} maxLength={Math.max(0,600-text.trim().length-(text.trim()?2:0))} onInsert={spoken=>onChange([text.trim(),spoken].filter(Boolean).join('\n\n'),spatial)}/>
  <button type="button" className="btn-primary" disabled={disabled||voicePending||!text.trim()} onClick={onDone}>Done teaching</button>
 </section>;
}
