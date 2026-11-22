'use client';
import {useRef,useState} from 'react';
import AnnotationWorkspace from '../../_components/annotation-workspace';
import {useAnnotationNotePlacement} from '../../_components/use-annotation-note-placement';
import ReviewSpatialOverlay from '../../_components/review-spatial-overlay';
import TrainerVoiceNote from '../../_components/trainer-voice-note';
import type {DraftSpatial} from '@/lib/review-timestamp-feedback';

export default function TrainingImagePlayer({ownerId,sourceId,image,timeMs,text,disabled,readOnly=false,doneUnavailable,initialSpatial=null,onChange,onDone,onVoiceDirtyChange}:{
 ownerId:string;sourceId:string;image:string;timeMs:number;text:string;disabled:boolean;
 doneUnavailable?:string;readOnly?:boolean;initialSpatial?:DraftSpatial|null;onChange:(text:string,spatial:DraftSpatial|null)=>void;onDone:()=>void;onVoiceDirtyChange?:(dirty:boolean)=>void;
}){
 const noteRef=useRef<HTMLDivElement>(null);
 const element=useRef<HTMLImageElement|null>(null),[spatial,setSpatial]=useState<DraftSpatial|null>(initialSpatial),[voicePending,setVoicePending]=useState(false);
 const position=useAnnotationNotePlacement(element,noteRef,!!spatial,spatial?.geometry||null,sourceId);
 const region=spatial?.geometry.kind==='rect'?{x:Math.round(spatial.geometry.x*1000000),y:Math.round(spatial.geometry.y*1000000),width:Math.min(Math.round(spatial.geometry.width!*1000000),1000000-Math.round(spatial.geometry.x*1000000)),height:Math.min(Math.round(spatial.geometry.height!*1000000),1000000-Math.round(spatial.geometry.y*1000000))}:{x:0,y:0,width:1000000,height:1000000};
 return <section aria-label="Teach from an image"><AnnotationWorkspace>
 <div className="recording-stage"><div className="relative recording-picture">
  <img ref={element} src={image} alt="Your training example" className="max-h-[60vh] w-full rounded-lg object-contain"/><ReviewSpatialOverlay mediaKind="image" appearance="teaching" controlsMode="external" mediaEl={()=>element.current} enabled={!disabled&&!readOnly&&!voicePending} pins={[]} draftSpatial={spatial} freezeMedia={()=>null}
   onAnnotate={({spatial})=>{setSpatial(spatial);onChange(text,spatial);}}
   onNudgeDraft={point=>{if(spatial){const next={...spatial,geometry:{...spatial.geometry,...point}};setSpatial(next);onChange(text,next);}}}
   onCancelDraft={()=>{setSpatial(null);onChange(text,null);}} onOpenIssue={()=>{}}/>
  </div>
  <p className="mt-3 text-xs text-ink-500">{readOnly?'Original saved frame and marked region.':'Click or drag on the picture to mark what matters.'}</p></div>
  <aside className="recording-moments"><div ref={noteRef} className="recording-note result-note" data-floating={!!position} style={position||undefined}><h2 className="mb-4 font-medium">Your teaching note</h2><div className="recording-comment-box"><textarea aria-label="Your feedback on this image" placeholder="What should your agent learn from this?" value={text} readOnly={readOnly} disabled={disabled} rows={3} maxLength={600} onChange={event=>onChange(event.target.value,spatial)} className="w-full rounded-lg border border-ink-700 bg-ink-950 p-3 text-sm"/>
  {!readOnly&&<TrainerVoiceNote compact disabled={disabled} onDirtyChange={dirty=>{setVoicePending(dirty);onVoiceDirtyChange?.(dirty);}} ownerId={ownerId} attach={{sourceKind:'upload',sourceRef:sourceId,mark:{frameMs:timeMs,region}}} maxLength={Math.max(0,600-text.trim().length-(text.trim()?2:0))} onInsert={spoken=>onChange([text.trim(),spoken].filter(Boolean).join('\n\n'),spatial)}/>}
  </div>{readOnly&&!text.trim()&&spatial&&<p className="mt-3 text-xs text-ink-400">This saved example has a marked region and no written note. Review any extracted suggestion before applying it.</p>}{!readOnly&&<p className="mt-3 text-xs text-ink-400">Your note, marked region and file hashes are saved privately on the server. The original stays on this computer. AI analysis comes later.</p>}<button type="button" className="btn-primary mt-4" disabled={disabled||voicePending||!text.trim()&&!(readOnly&&spatial)||!readOnly&&!!doneUnavailable} onClick={onDone}>{readOnly?'Extract training':'Done teaching'}</button>{!readOnly&&doneUnavailable&&<p role="status" className="mt-3 text-xs text-ink-400">{doneUnavailable}</p>}
 </div></aside></AnnotationWorkspace></section>;
}
