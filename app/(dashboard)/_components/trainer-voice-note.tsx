'use client';
import {useEffect,useRef,useState} from 'react';

export type VoiceNoteAttach={sourceKind:'recording'|'upload'|'run_artifact';sourceRef:string;mark:{startMs:number;endMs:number}|{frameMs:number;region:{x:number;y:number;width:number;height:number}}};
type NativeVoice={voiceNoteId:string;state:string;attach:VoiceNoteAttach;sha256:string|null;durationMs:number|null;failureReason:string|null};
type VoiceBridge={trainerCommentaryContractVersion?:string;reviewRecorder?:(operation:string,args:unknown)=>Promise<any>};
const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value);

/** One new capture mode of Desktop's recorder. Only edited text enters feedback. */
export default function TrainerVoiceNote({ownerId,attach,onInsert,maxLength=600,onDirtyChange,disabled=false}:{ownerId:string;attach:VoiceNoteAttach;onInsert:(text:string)=>void;maxLength?:number;onDirtyChange?:(dirty:boolean)=>void;disabled?:boolean}){
  const [available,setAvailable]=useState(false),[noteId,setNoteId]=useState<string|null>(null),[state,setState]=useState(''),[text,setText]=useState(''),[error,setError]=useState('');
  const [starting,setStarting]=useState(false);
  const identity=JSON.stringify({ownerId,attach}),latest=useRef(identity);latest.current=identity;
  const action=useRef(false),live=useRef(true),transcribed=useRef(new Set<string>());
  const dirtyCallback=useRef(onDirtyChange);dirtyCallback.current=onDirtyChange;
  useEffect(()=>{dirtyCallback.current?.(Boolean(starting||noteId&&!['failed','cancelled'].includes(state)||text.trim()));},[starting,noteId,state,text]);
  useEffect(()=>()=>{dirtyCallback.current?.(false);},[]);
  const bridge=()=>((window as unknown as {implexaDesktop?:VoiceBridge}).implexaDesktop);
  const call=async(operation:string,args:Record<string,unknown>)=>{
    const native=bridge();if(native?.trainerCommentaryContractVersion!=='1'||!native.reviewRecorder)throw Error('Update Implexa Desktop to add a voice note.');
    const result=await native.reviewRecorder(operation,{...args,expectedOwnerId:ownerId});if(!result?.ok)throw Error(result?.reason==='asr_unavailable'?'Voice transcription needs the recording tools. You can keep typing your feedback.':result?.reason==='no_speech'?'No speech was found. Try another voice note.':'The voice note could not be completed. Your typed feedback is unchanged.');return result;
  };
  useEffect(()=>{live.current=true;setAvailable(bridge()?.trainerCommentaryContractVersion==='1');return()=>{live.current=false;};},[]);
  useEffect(()=>{setNoteId(null);setState('');setText('');setError('');},[identity]);
  useEffect(()=>{
    if(!noteId||state==='ready'||state==='failed'||state==='cancelled')return;
    let stopped=false;const captured=identity;let timer:ReturnType<typeof setTimeout>;
    const poll=async()=>{try{
      const result=await call('getVoiceNote',{recordingId:noteId}),note:NativeVoice=result.voiceNote;
      if(stopped||!live.current||latest.current!==captured)return;
      if(note?.voiceNoteId!==noteId||JSON.stringify(note.attach)!==JSON.stringify(attach))throw Error('This voice note belongs to a different mark.');
      if(note.state==='ready'){
        if(!/^[a-f0-9]{64}$/.test(note.sha256||'')||!Number.isSafeInteger(note.durationMs)||!note.durationMs)throw Error('The saved voice note could not be verified.');
        if(transcribed.current.has(noteId))return;transcribed.current.add(noteId);setState('transcribing');
        try{const response=await call('transcribeVoiceNote',{recordingId:noteId}),transcript=response.transcript;
          if(stopped||!live.current||latest.current!==captured)return;
          if(transcript?.voiceNoteSha256!==note.sha256||typeof transcript.text!=='string'||!transcript.text.trim()||transcript.text.length>8000||!/^[a-f0-9]{64}$/.test(transcript.digest||''))throw Error('The transcript could not be matched to this voice note.');
          setText(transcript.text);setState('ready');
        }catch(caught){transcribed.current.delete(noteId);throw caught;}
        return;
      }
      if(['failed','cancelled'].includes(note.state)){setState(note.state);if(note.state==='failed')setError('The voice note did not save. Try again or type your feedback.');return;}
      setState(note.state);timer=setTimeout(poll,900);
    }catch(caught){if(!stopped&&latest.current===captured){setError(caught instanceof Error?caught.message:'Voice note unavailable.');setState('failed');}}};
    void poll();return()=>{stopped=true;clearTimeout(timer);};
    // Poll one note until ready; state labels must not restart transcription.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[noteId,identity]);
  async function start(){
    if(action.current||disabled)return;action.current=true;setStarting(true);const captured=identity;setError('');
    try{const value=await call('startVoiceNote',{attach});if(!uuid(value.voiceNoteId))throw Error('Voice note could not be started.');if(live.current&&latest.current===captured){setNoteId(value.voiceNoteId);setState('recording');setText('');}}
    catch(caught){if(latest.current===captured)setError(caught instanceof Error?caught.message:'Voice note unavailable.');}
    finally{action.current=false;if(live.current)setStarting(false);}
  }
  const active=starting||noteId&&!['ready','failed','cancelled'].includes(state);
  return <div className="mt-2 space-y-2 text-xs">
    <button type="button" disabled={disabled||!available||!!active} className="text-ink-400 hover:text-ink-100 disabled:opacity-40" onClick={()=>void start()}>{active?state==='transcribing'?'Transcribing on this Mac…':'Recording in the voice-note bar…':'◉ Add a voice note'}</button>
    {!available&&<span className="ml-2 text-ink-500">Update Desktop for voice notes</span>}
    {state==='ready'&&<div className="rounded-lg border border-ink-700 p-3"><label className="block text-ink-400">Your voice note<textarea aria-label="Voice note transcript" value={text} onChange={event=>setText(event.target.value)} rows={3} className="mt-2 w-full rounded-md border border-ink-700 bg-ink-950 p-2 text-sm text-ink-100"/></label>
      {text.trim().length>maxLength&&<p className="mt-2 text-amber-300">Shorten this to {maxLength} characters to fit the note. Nothing has been cut.</p>}
      <button type="button" disabled={disabled||!text.trim()||text.trim().length>maxLength} className="mt-2 text-brand-400 disabled:opacity-40" onClick={()=>{onInsert(text.trim());setText('');setState('');setNoteId(null);}}>Add to this note</button>
      <button type="button" className="ml-4 text-ink-500" onClick={()=>{setText('');setState('');setNoteId(null);}}>Dismiss voice note</button>
    </div>}
    {error&&<p role="alert" className="text-amber-300">{error}</p>}
  </div>;
}
