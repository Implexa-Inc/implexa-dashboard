'use client';

import {useEffect,useRef,type ReactNode,type RefObject} from 'react';

/** Shared conversation presentation; each caller retains its own saved context and actions. */
export function ChatFrame({children,composer,title='Chat with AI',subtitle,onClose,details,embedded=false,contentSized=false,scrollKey}:{contentSized?:boolean;scrollKey?:string|number;children:ReactNode;composer:ReactNode;title?:string;subtitle?:string;onClose?:()=>void;details?:ReactNode;embedded?:boolean}){
 const messages=useRef<HTMLDivElement>(null);
 useEffect(()=>{const box=messages.current;if(box)box.scrollTop=box.scrollHeight;},[scrollKey]);
 return <section aria-label={title} className={`flex flex-col overflow-hidden rounded-2xl border border-ink-700 bg-ink-950 ${contentSized?'max-h-[max(420px,min(760px,calc(100dvh-6rem)))]':`min-h-[420px] ${embedded?'h-[min(720px,calc(100dvh-7rem))]':'h-[min(760px,calc(100dvh-10rem))]'}`}`}>
  <header className="flex shrink-0 items-start justify-between gap-3 border-b border-ink-800 px-5 py-4"><div><h2 className="text-base font-medium">✦ {title}</h2>{subtitle&&<p className="mt-1 text-xs text-ink-500">{subtitle}</p>}</div><div className="flex items-center gap-2">{details&&<details className="relative text-xs text-ink-400"><summary aria-label="Chat details" className="cursor-pointer list-none rounded-full px-2 py-1">ⓘ</summary><div className="absolute right-0 top-8 z-10 max-h-80 w-72 overflow-y-auto rounded-xl border border-ink-700 bg-ink-900 p-4 leading-5 shadow-xl">{details}</div></details>}{onClose&&<button type="button" aria-label="Close chat" onClick={onClose} className="rounded-lg px-2 py-1 text-ink-500 hover:text-ink-100">×</button>}</div></header>
  <div ref={messages} className="min-h-20 flex-1 space-y-5 overflow-y-auto overscroll-contain px-5 py-5 text-sm leading-6">{children}</div>
  <div className="shrink-0 border-t border-ink-800 bg-ink-900/20 p-3">{composer}</div>
 </section>;
}

export function ChatMessage({role,children}:{role:'user'|'assistant';children:ReactNode}){
 return <div className={role==='user'?'ml-6 rounded-xl bg-ink-800/60 px-4 py-3':'mr-2 space-y-3'}><span className="sr-only">{role==='user'?'You':'AI'}: </span>{children}</div>;
}
export type ChatChoice={label:string;value:string};
export function ChatChoices({question,choices,onChoose,disabled=false}:{question:string;choices:ChatChoice[];onChoose:(value:string)=>void;disabled?:boolean}){
 return <fieldset disabled={disabled} className="space-y-3 rounded-xl border border-ink-700 p-4"><legend className="px-1 text-sm font-medium">{question}</legend><div className="flex flex-wrap gap-2">{choices.map(choice=><button key={choice.label} type="button" onClick={()=>onChoose(choice.value)} className="rounded-lg border border-ink-700 px-3 py-2 text-left text-xs text-ink-200 hover:border-brand-500 hover:bg-brand-500/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500 disabled:opacity-40">{choice.label}</button>)}</div></fieldset>;
}
export function ChatComposer({id='agent-chat-message',value,onChange,onSend,disabled=false,sending=false,sendDisabled=false,placeholder='What would you like to change?',attachments,textareaRef,standalone=false,details}:{standalone?:boolean;details?:ReactNode;id?:string;value:string;onChange:(value:string)=>void;onSend:()=>void;disabled?:boolean;sending?:boolean;sendDisabled?:boolean;placeholder?:string;attachments?:ReactNode;textareaRef?:RefObject<HTMLTextAreaElement>}){
 const input=<label className="block" htmlFor={id}><span className="sr-only">Message AI</span><textarea ref={textareaRef} id={id} rows={3} maxLength={2000} value={value} disabled={disabled||sending} onChange={event=>onChange(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing){event.preventDefault();if(!disabled&&!sending&&!sendDisabled&&value.trim())onSend();}}} placeholder={placeholder} className="block max-h-48 min-h-20 w-full resize-y rounded-xl border-0 bg-transparent px-3 py-2 text-sm text-ink-100 outline-none placeholder:text-ink-500 focus-visible:ring-1 focus-visible:ring-brand-500 disabled:opacity-50"/></label>;
 const submit=<div className="flex items-center justify-end"><button type="button" aria-label="Send message" title="Send message" disabled={disabled||sending||sendDisabled||!value.trim()} onClick={onSend} className="btn-primary px-4 py-2 text-sm disabled:opacity-40">{sending?'Thinking…':standalone?'↑':'Send'}</button></div>;
 return <div className="space-y-2">
  {standalone?<div className="space-y-2 rounded-2xl border border-ink-700 bg-ink-950 p-3 focus-within:border-brand-500">{input}{submit}</div>:<>{attachments}{input}{submit}</>}
  {standalone&&<div className="flex items-start justify-between gap-3"><div className="min-w-0">{attachments}</div>{details&&<details className="relative mt-2 text-xs text-ink-400"><summary aria-label="Chat details" className="cursor-pointer list-none rounded-full px-2 py-1">ⓘ</summary><div className="absolute right-0 top-8 z-10 max-h-80 w-72 overflow-y-auto rounded-xl border border-ink-700 bg-ink-900 p-4 leading-5 shadow-xl">{details}</div></details>}</div>}
 </div>;
}
