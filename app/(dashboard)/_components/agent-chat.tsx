'use client';

import ChatDictation from './chat-dictation';
import {useEffect,useRef,useState,type ReactNode,type RefObject} from 'react';

/** Shared conversation presentation; each caller retains its own saved context and actions. */
export function ChatFrame({children,composer,title='Chat with AI',subtitle,onClose,details,embedded=false,contentSized=false,scrollKey,hideHeader=false}:{hideHeader?:boolean;contentSized?:boolean;scrollKey?:string|number;children:ReactNode;composer:ReactNode;title?:string;subtitle?:string;onClose?:()=>void;details?:ReactNode;embedded?:boolean}){
 const messages=useRef<HTMLDivElement>(null);
 useEffect(()=>{const box=messages.current;if(box)box.scrollTop=box.scrollHeight;},[scrollKey]);
 return <section aria-label={title} className={`flex flex-col overflow-hidden rounded-2xl border border-ink-700 bg-ink-900 ${contentSized?'max-h-[max(420px,min(760px,calc(100dvh-6rem)))]':`min-h-[420px] ${embedded?'h-[min(720px,calc(100dvh-7rem))]':'h-[min(760px,calc(100dvh-10rem))]'}`}`}>
  {!hideHeader&&<header className="flex shrink-0 items-start justify-between gap-3 border-b border-ink-800 px-5 py-4"><div><h2 className="text-base font-medium">✦ {title}</h2>{subtitle&&<p className="mt-1 text-secondary text-ink-500">{subtitle}</p>}</div><div className="flex items-center gap-2">{details&&<details className="relative text-secondary text-ink-400"><summary aria-label="Chat details" className="cursor-pointer list-none rounded-full px-2 py-1">ⓘ</summary><div className="absolute right-0 top-8 z-10 max-h-80 w-72 overflow-y-auto rounded-xl border border-ink-700 bg-ink-900 p-4 leading-5 shadow-xl">{details}</div></details>}{onClose&&<button type="button" aria-label="Close chat" onClick={onClose} className="rounded-lg px-2 py-1 text-ink-500 hover:text-ink-100">×</button>}</div></header>}
  <div ref={messages} className="min-h-20 flex-1 space-y-5 overflow-y-auto overscroll-contain px-5 py-5 text-reading">{children}</div>
  <div className="shrink-0 border-t border-ink-800 bg-ink-900/20 p-3">{composer}{hideHeader&&details&&<details className="mt-3 px-2 text-secondary text-ink-400"><summary>Conversation details</summary><div className="mt-3 space-y-3">{details}</div></details>}</div>
 </section>;
}

export function ChatMessage({role,children}:{role:'user'|'assistant';children:ReactNode}){
 return <div className={role==='user'?'ml-6 rounded-xl bg-ink-800/60 px-4 py-3':'mr-2 space-y-3'}><span className="sr-only">{role==='user'?'You':'AI'}: </span>{children}</div>;
}
export type ChatChoice={label:string;value:string};
export function ChatChoices({question,choices,onChoose,disabled=false}:{question:string;choices:ChatChoice[];onChoose:(value:string)=>void;disabled?:boolean}){
 return <fieldset disabled={disabled} className="space-y-3 rounded-xl border border-ink-700 p-4"><legend className="px-1 text-reading font-medium">{question}</legend><div className="flex flex-wrap gap-2">{choices.map(choice=><button key={choice.label} type="button" onClick={()=>onChoose(choice.value)} className="rounded-lg border border-ink-700 px-3 py-2 text-left text-ui text-ink-200 hover:border-brand-500 hover:bg-brand-500/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500 disabled:opacity-40">{choice.label}</button>)}</div></fieldset>;
}
export function ChatComposer({maxLength=2000,id='agent-chat-message',value,onChange,onSend,disabled=false,sending=false,sendDisabled=false,placeholder='What would you like to change?',attachments,textareaRef,standalone=false,details,voiceScope,micIcon=false,attachedMessage=false,inlineAttachments=false,attachmentPreview}:{attachmentPreview?:ReactNode;attachedMessage?:boolean;inlineAttachments?:boolean;micIcon?:boolean;maxLength?:number;voiceScope?:string;standalone?:boolean;details?:ReactNode;id?:string;value:string;onChange:(value:string)=>void;onSend:()=>void;disabled?:boolean;sending?:boolean;sendDisabled?:boolean;placeholder?:string;attachments?:ReactNode;textareaRef?:RefObject<HTMLTextAreaElement>}){
 const [dictating,setDictating]=useState(false),[voiceOverflow,setVoiceOverflow]=useState('');
 useEffect(()=>setVoiceOverflow(''),[voiceScope||id]);
 const latestValue=useRef(value);latestValue.current=value;
 const voice=<ChatDictation micIcon={micIcon} scope={voiceScope||id} disabled={disabled||sending} onBusy={setDictating} onInsert={text=>{const next=[latestValue.current.trim(),text].filter(Boolean).join(' ');if(next.length<=maxLength)onChange(next);else setVoiceOverflow(text);}}/>;
 const input=<label className="block" htmlFor={id}><span className="sr-only">Message AI</span><textarea ref={textareaRef} id={id} rows={3} maxLength={Number.isFinite(maxLength)?maxLength:undefined} value={value} disabled={disabled||sending} onChange={event=>onChange(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing){event.preventDefault();if(!disabled&&!sending&&!dictating&&!sendDisabled&&(value.trim()||attachedMessage))onSend();}}} placeholder={placeholder} className={`block max-h-48 min-h-20 w-full resize-y rounded-xl border-0 bg-transparent px-3 py-2 text-ui text-ink-100 outline-none placeholder:text-ink-500 disabled:opacity-50 ${standalone?'':'focus-visible:ring-1 focus-visible:ring-brand-500'}`}/></label>;
 const submitButton=<button type="button" aria-label="Send message" title="Send message" disabled={disabled||sending||dictating||sendDisabled||(!value.trim()&&!attachedMessage)} onClick={onSend}
  className={inlineAttachments?'flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ink-100 text-ink-950 disabled:opacity-40':'btn-primary ml-auto px-4 py-2 text-ui disabled:opacity-40'}>
  {inlineAttachments?<><span className="sr-only">{sending?'Thinking…':'Send'}</span><svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5m-6 6 6-6 6 6"/></svg></>:sending?'Thinking…':standalone?'↑':'Send'}
 </button>;
 const submit=inlineAttachments?<div className="flex items-end justify-between gap-2">
  {attachments}<div className="ml-auto flex min-w-0 items-start gap-1">{voice}{submitButton}</div>
 </div>:<div className="flex flex-wrap items-end gap-2">{!standalone&&attachments}{voice}{submitButton}</div>;
 return <div className="space-y-2">
  {voiceOverflow&&<div className="space-y-2 rounded-lg border border-ink-700 p-3"><p className="text-secondary text-state-needs">This voice note is too long to add. Shorten it below; your message is unchanged.</p><textarea aria-label="Shorten voice transcript" value={voiceOverflow} onChange={e=>setVoiceOverflow(e.target.value)} className="w-full bg-transparent text-ui"/><button type="button" disabled={disabled||sending||([value.trim(),voiceOverflow.trim()].filter(Boolean).join(' ').length>maxLength)} onClick={()=>{onChange([value.trim(),voiceOverflow.trim()].filter(Boolean).join(' '));setVoiceOverflow('');}} className="text-ui text-action-accent">Add to message</button><button type="button" onClick={()=>setVoiceOverflow('')} className="ml-3 text-ui text-ink-500">Discard transcript</button></div>}
  <div className="space-y-2 rounded-2xl border border-ink-700 bg-ink-950 p-3 focus-within:border-brand-500">{input}{attachmentPreview}{submit}</div>
  {standalone&&<div className="flex items-start justify-between gap-3"><div className="min-w-0">{!inlineAttachments&&attachments}</div>{details&&<details className="relative mt-2 text-secondary text-ink-400"><summary aria-label="Chat details" className="cursor-pointer list-none rounded-full px-2 py-1">ⓘ</summary><div className="absolute right-0 top-8 z-10 max-h-80 w-72 overflow-y-auto rounded-xl border border-ink-700 bg-ink-900 p-4 leading-5 shadow-xl">{details}</div></details>}</div>}
 </div>;
}
