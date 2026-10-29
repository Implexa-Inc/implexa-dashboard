'use client';
// A fork is a private definition, not an automatic run or inherited permission.
import { useRef, useState, useEffect } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { callBackend } from '@/lib/api';

export default function ForkRunCta({skillSlug,versionId,source}:{skillSlug:string;versionId?:string|null;source?:string}) {
 const [authed,setAuthed]=useState<boolean|null>(null),[busy,setBusy]=useState(false),[msg,setMsg]=useState('');
 const [created,setCreated]=useState<{slug:string;lineageId:string;parentVersionId:string}|null>(null);
 const mutation=useRef<string|null>(null),pending=useRef(false),supabase=createClient();
 useEffect(()=>{supabase.auth.getSession().then(({data})=>setAuthed(!!data.session)).catch(()=>setAuthed(false));},[]);
 async function fork(){if(pending.current)return;pending.current=true;setBusy(true);setMsg('');
  try {mutation.current ||= crypto.randomUUID();const {data:{session}}=await supabase.auth.getSession();
   const res=await callBackend('/api/v2/me/fork-agent',{jwt:session?.access_token,method:'POST',
    body:{slug:skillSlug,source:source||null,expectedVersionId:versionId||null,mutationId:mutation.current}});
   if(!res?.ok||!res.forkedSlug||!res.lineageId||!res.parentVersionId)throw Error(res?.error||'Could not create a private fork. Install the parent first.');
   setCreated({slug:res.forkedSlug,lineageId:res.lineageId,parentVersionId:res.parentVersionId});
  }catch(e){setMsg(e instanceof Error?e.message:'Could not fork this agent.');}finally{pending.current=false;setBusy(false);}
 }
 if(!authed)return <Link href={`/signup?intent=adopt&agent=${encodeURIComponent(skillSlug)}`} className="btn-success inline-block px-4 py-2 text-sm">Use this agent →</Link>;
 if(created)return <div className="rounded border border-ink-700 p-3 text-sm space-y-2" role="status">
  <p>Private fork created. The parent is unchanged. Review setup before running; no permissions or private customer preferences were copied.</p>
  <Link href={`/workflows/${encodeURIComponent(created.slug)}?source=generated`}>Open private fork</Link>
  <p>Inherited teachings need the trainer’s permission for this fork:</p>
  <Link href={`/training/${encodeURIComponent(skillSlug)}?forkId=${created.lineageId}&forkParentVersionId=${created.parentVersionId}`}>Trainer permission review link</Link>
 </div>;
 return <div><button type="button" disabled={busy} onClick={fork} className="rounded border border-ink-600 px-3 py-2 text-sm disabled:opacity-60">{busy?'Creating private fork…':'Make a private fork'}</button>
  {msg&&<p role="alert" className="text-sm text-amber-500">{msg}</p>}</div>;
}
