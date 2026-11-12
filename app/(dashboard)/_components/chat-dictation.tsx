'use client';
import {useEffect,useRef,useState} from 'react';
import {createClient} from '@/lib/supabase/client';

type Bridge={chatDictationContractVersion?:string;reviewRecorder?:(operation:string,args:unknown)=>Promise<any>};
/** Shared local dictation: edits the draft only; Send remains the caller's action. */
export default function ChatDictation({scope,disabled,onInsert,onBusy}:{scope:string;disabled:boolean;onInsert:(text:string)=>void;onBusy:(busy:boolean)=>void}){
 const [available,setAvailable]=useState(false),[state,setState]=useState(''),[error,setError]=useState('');
 const capture=useRef<{ownerId:string;id:string;composerId:string}|null>(null);
 const discard=()=>{const note=capture.current;capture.current=null;if(note)void (window as unknown as {implexaDesktop?:Bridge}).implexaDesktop?.reviewRecorder?.('discardChatDictation',{expectedOwnerId:note.ownerId,recordingId:note.id,composerId:note.composerId}).catch(()=>{});};
 const generation=useRef(0),active=useRef(false),insert=useRef(onInsert),busy=useRef(onBusy);insert.current=onInsert;busy.current=onBusy;
 useEffect(()=>{const native=(window as unknown as {implexaDesktop?:Bridge}).implexaDesktop;setAvailable(native?.chatDictationContractVersion==='1'&&!!native.reviewRecorder);},[]);
 useEffect(()=>{generation.current++;discard();active.current=false;setState('');setError('');busy.current(false);return()=>{generation.current++;discard();busy.current(false);};},[scope]);
 async function start(){if(disabled||active.current)return;active.current=true;const seq=generation.current;setError('');setState('Opening microphone');busy.current(true);
  const current=()=>seq===generation.current;
  try{
   const {data:{user}}=await createClient().auth.getUser();if(!user)throw Error('Sign in again to use the microphone.');if(!current())return;
   const bridge=(window as unknown as {implexaDesktop?:Bridge}).implexaDesktop;
   const composerId=`chat-${crypto.randomUUID()}`;
   const call=async(op:string,args:Record<string,unknown>)=>{if(!current())throw Error('Conversation changed.');const value=await bridge!.reviewRecorder!(op,{...args,expectedOwnerId:user.id});if(!value?.ok)throw Error(value?.reason||'Microphone unavailable.');return value;};
   const started=await call('startChatDictation',{composerId});if(!/^[a-f0-9-]{36}$/.test(started.voiceNoteId||''))throw Error('Could not start recording.');
   capture.current={ownerId:user.id,id:started.voiceNoteId,composerId};
   if(!current()){discard();return;}
   setState('Use the recorder bar to start and finish speaking');
   for(let n=0;n<300&&current();n++){
    await new Promise(resolve=>setTimeout(resolve,700));if(!current())return;
    const result=await call('getVoiceNote',{recordingId:started.voiceNoteId}),note=result.voiceNote;
    if(note?.attach?.sourceKind!=='composer'||note.attach.sourceRef!==composerId)throw Error('Recording belongs to another conversation.');
    if(note.state==='ready'){
     setState('Turning speech into text');const result=await call('transcribeChatDictation',{recordingId:started.voiceNoteId,composerId});
     if(!current())return;const text=result.transcript?.text;
     if(typeof text!=='string'||!text.trim()||text.length>8000)throw Error('Could not transcribe this note.');
     capture.current=null;insert.current(text.trim());setState('Speech is ready. Review your message, then send.');return;
    }
    if(['failed','cancelled','discarded','interrupted'].includes(note.state))throw Error(note.state==='cancelled'?'Recording cancelled.':'Could not finish recording. Check the microphone.');
   }
   if(current())throw Error('Recording timed out. You can keep typing.');
  }catch(e){if(current())setError((e instanceof Error?e.message:'Voice unavailable.').replaceAll('_',' '));}
  finally{if(current()){discard();active.current=false;busy.current(false);}}
 }
 if(!available)return null;
 return <div className="text-xs"><button type="button" aria-label="Dictate message" title="Dictate message" disabled={disabled||active.current} onClick={()=>void start()} className="rounded-lg border border-ink-700 px-3 py-2 text-ink-300 hover:text-ink-100 disabled:opacity-40">🎙 {active.current?'Listening…':'Voice'}</button>{error?<p role="alert" className="mt-2 text-amber-300">{error}</p>:state&&<p role="status" className="mt-2 text-ink-400">{state}</p>}</div>;
}
