'use client';
import {useEffect,useRef,useState} from 'react';

export type VoiceNoteAttach={sourceKind:'recording'|'upload'|'run_artifact';sourceRef:string;mark:{startMs:number;endMs:number}|{frameMs:number;region:{x:number;y:number;width:number;height:number}}};
type NativeVoice={voiceNoteId:string;state:string;attach:VoiceNoteAttach;sha256:string|null;durationMs:number|null;failureReason:string|null;createdAt?:string};
type VoiceEvent={ownerId:string;recordingId:string;origin?:string;state:string;failure?:{reason?:string}};
type VoiceBridge={trainerCommentaryContractVersion?:string;reviewRecorder?:(operation:string,args:unknown)=>Promise<any>;onReviewRecorderChanged?:(callback:(event:unknown)=>void)=>(()=>void)};
const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value);
const MAX=1000000;

/** Native rectangles use integer millionths. Rounding must never put the far edge outside the frame. */
export function normalizeVoiceAttach(attach:VoiceNoteAttach):VoiceNoteAttach{
 if('startMs' in attach.mark)return {sourceKind:attach.sourceKind,sourceRef:attach.sourceRef,mark:{startMs:attach.mark.startMs,endMs:attach.mark.endMs}};
 const clamp=(value:number,lo:number,hi:number)=>Math.min(hi,Math.max(lo,Math.round(value)));
 const x=clamp(attach.mark.region.x,0,MAX-1),y=clamp(attach.mark.region.y,0,MAX-1);
 return {sourceKind:attach.sourceKind,sourceRef:attach.sourceRef,mark:{frameMs:attach.mark.frameMs,region:{x,y,width:clamp(attach.mark.region.width,1,MAX-x),height:clamp(attach.mark.region.height,1,MAX-y)}}};
}
/** Native JSON property order is not part of a mark's identity. */
export function sameVoiceAttach(value:unknown,expected:VoiceNoteAttach){
 const actual=value as VoiceNoteAttach|null;
 if(!actual||actual.sourceKind!==expected.sourceKind||actual.sourceRef!==expected.sourceRef||!actual.mark)return false;
 if('startMs' in expected.mark)return 'startMs' in actual.mark&&actual.mark.startMs===expected.mark.startMs&&actual.mark.endMs===expected.mark.endMs;
 if(!('frameMs' in actual.mark)||actual.mark.frameMs!==expected.mark.frameMs||!actual.mark.region)return false;
 const region=actual.mark.region,wanted=expected.mark.region;
 return region.x===wanted.x&&region.y===wanted.y&&region.width===wanted.width&&region.height===wanted.height;
}
class VoiceError extends Error{constructor(public reason:string,message:string){super(message);}}
const voiceMessage=(reason:string)=>reason==='asr_unavailable'?'Voice transcription needs the recording tools. You can keep typing your feedback.':reason==='no_speech'?'No speech was found. Try another voice note.':reason==='microphone_unavailable'?'The microphone is unavailable. Check Implexa’s microphone access, then try again.':'The voice note could not be completed. Your typed feedback is unchanged.';

/** The existing trusted recorder owns audio and deletion; only edited text enters feedback. */
export default function TrainerVoiceNote({ownerId,attach,onInsert,maxLength=600,onDirtyChange,disabled=false}:{ownerId:string;attach:VoiceNoteAttach;onInsert:(text:string)=>void;maxLength?:number;onDirtyChange?:(dirty:boolean)=>void;disabled?:boolean}){
 const bound=normalizeVoiceAttach(attach),identity=JSON.stringify({ownerId,attach:bound}),latest=useRef(identity);latest.current=identity;
 const [available,setAvailable]=useState(false),[noteId,setNoteId]=useState<string|null>(null),[state,setState]=useState(''),[text,setText]=useState(''),[error,setError]=useState('');
 const [starting,setStarting]=useState(false),[saved,setSaved]=useState<string|null>(null),[recoverable,setRecoverable]=useState<NativeVoice[]>([]),[deleting,setDeleting]=useState(false);
 const action=useRef(false),live=useRef(true),transcribed=useRef(new Set<string>()),sequence=useRef(0),currentNote=useRef(noteId);currentNote.current=noteId;
 const events=useRef(new Map<string,VoiceEvent>()),dirtyCallback=useRef(onDirtyChange);dirtyCallback.current=onDirtyChange;
 const bridge=()=>((window as unknown as {implexaDesktop?:VoiceBridge}).implexaDesktop);
 async function call(operation:string,args:Record<string,unknown>){
  const native=bridge();if(native?.trainerCommentaryContractVersion!=='1'||!native.reviewRecorder)throw new VoiceError('update_required','Update Implexa Desktop to add a voice note.');
  const result=await native.reviewRecorder(operation,{...args,expectedOwnerId:ownerId});
  if(!result?.ok)throw new VoiceError(result?.reason||'recorder_failed',voiceMessage(result?.reason));return result;
 }
 const terminal=(event:VoiceEvent)=>{
  if(['cancelled','discarded'].includes(event.state)){setNoteId(null);setState('cancelled');setText('');setError('');return true;}
  if(event.state==='start_failed'){setNoteId(null);setState('failed');setError(voiceMessage(event.failure?.reason||'recorder_failed'));return true;}return false;
 };
 useEffect(()=>{dirtyCallback.current?.(Boolean(starting||noteId&&!['failed','cancelled'].includes(state)||text.trim()));},[starting,noteId,state,text]);
 useEffect(()=>{live.current=true;setAvailable(bridge()?.trainerCommentaryContractVersion==='1');return()=>{live.current=false;dirtyCallback.current?.(false);};},[]);
 useEffect(()=>{
  const captured=identity,read=++sequence.current;setNoteId(null);setState('');setText('');setError('');setSaved(null);setRecoverable([]);
  if(bridge()?.trainerCommentaryContractVersion==='1')void (async()=>{try{
   const value=await call('listVoiceNotes',{sourceRef:bound.sourceRef});
   if(!live.current||latest.current!==captured||sequence.current!==read)return;
   if(!Array.isArray(value.voiceNotes)||value.voiceNotes.length>200)return;
   setRecoverable(value.voiceNotes.filter((note:NativeVoice)=>uuid(note?.voiceNoteId)&&sameVoiceAttach(note.attach,bound)&&['ready','recording','finalizing','choosing'].includes(note.state)));
  }catch{/* Older Desktop builds can still record; an unavailable local list grants nothing. */}})();
 },[identity]);
 useEffect(()=>{
  const off=bridge()?.onReviewRecorderChanged?.((raw:unknown)=>{
   const event=raw as VoiceEvent;if(!event||event.ownerId!==ownerId||event.origin!=='voice_note'||!uuid(event.recordingId)||typeof event.state!=='string')return;
   events.current.set(event.recordingId,event);if(events.current.size>16)events.current.delete(events.current.keys().next().value!);
   if(event.recordingId===currentNote.current)terminal(event);
  });return()=>{if(typeof off==='function')off();};
 },[ownerId]);
 useEffect(()=>{
  if(!noteId||state==='ready'||state==='failed'||state==='cancelled')return;
  const early=events.current.get(noteId);if(early&&terminal(early))return;
  let stopped=false;const captured=identity;let timer:ReturnType<typeof setTimeout>;
  const poll=async()=>{try{
   const result=await call('getVoiceNote',{recordingId:noteId}),note:NativeVoice=result.voiceNote;
   if(stopped||!live.current||latest.current!==captured)return;
   if(note?.voiceNoteId!==noteId||!sameVoiceAttach(note.attach,bound))throw Error('This voice note belongs to a different mark.');
   if(note.state==='ready'){
    if(!/^[a-f0-9]{64}$/.test(note.sha256||'')||!Number.isSafeInteger(note.durationMs)||!note.durationMs)throw Error('The saved voice note could not be verified.');
    if(transcribed.current.has(noteId))return;transcribed.current.add(noteId);setState('transcribing');
    try{const response=await call('transcribeVoiceNote',{recordingId:noteId}),transcript=response.transcript;
     if(stopped||!live.current||latest.current!==captured)return;
     if(transcript?.voiceNoteSha256!==note.sha256||typeof transcript.text!=='string'||!transcript.text.trim()||transcript.text.length>8000||!/^[a-f0-9]{64}$/.test(transcript.digest||''))throw Error('The transcript could not be matched to this voice note.');
     setText(transcript.text);setState('ready');
    }catch(caught){transcribed.current.delete(noteId);throw caught;}return;
   }
   if(['failed','cancelled','discarded','interrupted'].includes(note.state)){setState(note.state==='interrupted'?'failed':note.state);if(['failed','interrupted'].includes(note.state))setError('The voice note did not finish. Try again or type your feedback.');return;}
   setState(note.state);timer=setTimeout(poll,900);
  }catch(caught){if(!stopped&&latest.current===captured){if(caught instanceof VoiceError&&caught.reason==='recording_not_found'){setNoteId(null);setState('cancelled');setError('');}else{setError(caught instanceof Error?caught.message:'Voice note unavailable.');setState('failed');}}}};
  void poll();return()=>{stopped=true;clearTimeout(timer);};
  // State labels must not restart transcription.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[noteId,identity]);
 async function start(){
  if(action.current||disabled)return;action.current=true;++sequence.current;setStarting(true);const captured=identity;setError('');
  try{const value=await call('startVoiceNote',{attach:bound});if(!uuid(value.voiceNoteId))throw Error('Voice note could not be started.');if(live.current&&latest.current===captured){setNoteId(value.voiceNoteId);setState('recording');setText('');}}
  catch(caught){if(latest.current===captured)setError(caught instanceof Error?caught.message:'Voice note unavailable.');}
  finally{action.current=false;if(live.current)setStarting(false);}
 }
 function finish(insert:boolean){if(!noteId)return;if(insert)onInsert(text.trim());setSaved(noteId);setRecoverable(previous=>previous.filter(note=>note.voiceNoteId!==noteId));setText('');setState('');setNoteId(null);}
 async function removeSaved(){
  if(!saved||deleting)return;const id=saved,captured=identity;setDeleting(true);setError('');
  try{await call('delete',{recordingId:id});if(latest.current===captured)setSaved(null);}
  catch(caught){if(latest.current===captured&&!(caught instanceof VoiceError&&caught.reason==='delete_cancelled'))setError(caught instanceof Error?caught.message:'Voice note could not be deleted.');}
  finally{if(live.current)setDeleting(false);}
 }
 const active=starting||noteId&&!['ready','failed','cancelled','discarded'].includes(state);
 return <div className="mt-2 space-y-2 text-xs">
  <button type="button" disabled={disabled||!available||!!active} className="text-ink-400 hover:text-ink-100 disabled:opacity-40" onClick={()=>void start()}>{active?state==='transcribing'?'Transcribing on this Mac…':'Recording in the voice-note bar…':'◉ Add a voice note'}</button>
  {!available&&<span className="ml-2 text-ink-500">Update Desktop for voice notes</span>}
  {!noteId&&recoverable.length>0&&<details className="text-ink-400"><summary className="cursor-pointer">Saved voice notes for this mark ({recoverable.length})</summary>{recoverable.map(note=><button key={note.voiceNoteId} type="button" disabled={disabled||starting} className="mt-2 block underline underline-offset-4" onClick={()=>{++sequence.current;transcribed.current.delete(note.voiceNoteId);setNoteId(note.voiceNoteId);setState('recovering');setError('');}}>Recover voice note{note.createdAt?` · ${new Date(note.createdAt).toLocaleString()}`:''}</button>)}</details>}
  {state==='ready'&&<div className="rounded-lg border border-ink-700 p-3"><label className="block text-ink-400">Your voice note<textarea aria-label="Voice note transcript" value={text} onChange={event=>setText(event.target.value)} rows={3} className="mt-2 w-full rounded-md border border-ink-700 bg-ink-950 p-2 text-sm text-ink-100"/></label>
   {text.trim().length>maxLength&&<p className="mt-2 text-amber-300">Shorten this to {maxLength} characters to fit the note. Nothing has been cut.</p>}
   <button type="button" disabled={disabled||!text.trim()||text.trim().length>maxLength} className="mt-2 text-brand-400 disabled:opacity-40" onClick={()=>finish(true)}>Add to this note</button>
   <button type="button" className="ml-4 text-ink-500" onClick={()=>finish(false)}>Dismiss voice note</button>
  </div>}
  {saved&&<p className="text-ink-500">Audio stays saved on this Mac. <button type="button" disabled={deleting} className="underline underline-offset-4 disabled:opacity-40" onClick={()=>void removeSaved()}>{deleting?'Deleting…':'Delete saved voice note…'}</button></p>}
  {error&&<p role="alert" className="text-amber-300">{error}</p>}
 </div>;
}
