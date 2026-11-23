import {NextResponse} from 'next/server';
import {createClient} from '@/lib/supabase/server';
import {UUID} from '@/lib/trainer-questions';
export const maxDuration=45;
const BACKEND=(process.env.NEXT_PUBLIC_IMPLEXA_API_URL||'https://core.implexa.ai').replace(/\/$/,'');
async function forward(request:Request,write:boolean){
 const started=Date.now();let phase='auth',upstreamStatus:number|null=null,deadline:AbortSignal|null=null;
 const {data:{session}}=await createClient().auth.getSession().catch(error=>{
  if(!write)try{console.warn('training_chat_proxy_read',{phase:'auth',outcome:'exception',elapsedMs:Math.max(0,Date.now()-started)});}catch{}
  throw error;
 });
 if(!session?.access_token){
  if(!write)try{console.warn('training_chat_proxy_read',{phase:'auth',outcome:'unauthorized',elapsedMs:Math.max(0,Date.now()-started)});}catch{}
  return NextResponse.json({ok:false,reason:'unauthorized'},{status:401});
 }
 phase='request';
 try{
  const q=new URL(request.url).searchParams,id=q.get('sessionId'),source=q.get('sourceId'),direction=q.get('directionScopeContract');
  if(!UUID.test(id||'')||[...q.keys()].some(k=>!(write?['sessionId']:['sessionId','sourceId','directionScopeContract']).includes(k)||q.getAll(k).length!==1)||direction!==null&&direction!=='training-direction-scope.v1'||(!write&&source!==null&&!UUID.test(source)))
   return NextResponse.json({ok:false,reason:'invalid_request'},{status:400});
  let body:unknown;
  if(write){
   const reader=request.body?.getReader();if(!reader)return NextResponse.json({ok:false,reason:'invalid_request'},{status:400});
   const chunks:Uint8Array[]=[];let size=0;
   for(;;){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>16000){await reader.cancel();return NextResponse.json({ok:false,reason:'training_chat_message_too_large'},{status:413});}chunks.push(r.value);}
   const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}body=JSON.parse(new TextDecoder().decode(bytes));
  }
  const params=new URL(request.url).searchParams;params.delete('sessionId');
  phase='fetch';deadline=AbortSignal.timeout(write?35000:8000);
  const r=await fetch(`${BACKEND}/api/v2/agent-training/sessions/${id}/chat${!write&&params.toString()?`?${params}`:''}`,{
   method:write?'POST':'GET',headers:{authorization:`Bearer ${session.access_token}`,'content-type':'application/json'},
   ...(write?{body:JSON.stringify(body)}:{}),cache:'no-store',signal:AbortSignal.any([request.signal,deadline])});
  upstreamStatus=r.status;phase='decode';const value=await r.json();
  if(!write)try{console.info('training_chat_proxy_read',{phase:'complete',upstreamStatus,elapsedMs:Math.max(0,Date.now()-started)});}catch{}
  return NextResponse.json(value,{status:r.status,headers:{'Cache-Control':'no-store'}});
 }catch{
  if(!write)try{console.warn('training_chat_proxy_read',{phase,upstreamStatus,elapsedMs:Math.max(0,Date.now()-started),
   deadlineExpired:deadline?.aborted===true,callerAborted:request.signal.aborted});}catch{}
  return NextResponse.json({ok:false,reason:write?'training_chat_response_unconfirmed':'training_chat_unavailable'},{status:503});
 }
}
export function GET(request:Request){return forward(request,false);}
export function POST(request:Request){return forward(request,true);}
