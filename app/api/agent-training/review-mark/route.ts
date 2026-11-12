import {NextResponse} from 'next/server';
import {createClient} from '@/lib/supabase/server';
import {UUID} from '@/lib/trainer-questions';
const BACKEND=(process.env.NEXT_PUBLIC_IMPLEXA_API_URL||'https://core.implexa.ai').replace(/\/$/,'');
export const dynamic='force-dynamic';
async function forward(request:Request,write:boolean){
 const {data:{session}}=await createClient().auth.getSession();
 const reply=(value:unknown,status=200)=>NextResponse.json(value,{status,headers:{'Cache-Control':'no-store'}});
 if(!session?.access_token)return reply({ok:false,reason:'unauthorized'},401);
 try{
  const query=new URL(request.url).searchParams,id=query.get('sessionId'),operation=write?query.get('operation'):'context';
  const allowed=write?['sessionId','operation']:['sessionId','sourceId','reviewSessionId','issueId'];
  if(!UUID.test(id||'')||query.getAll('sessionId').length!==1||[...query.keys()].some(key=>!allowed.includes(key))
   ||write&&(!['source','apply'].includes(operation||'')||query.getAll('operation').length!==1))return reply({ok:false,reason:'invalid_request'},400);
  const headers:Record<string,string>={authorization:`Bearer ${session.access_token}`,'content-type':'application/json'};
  let path=`/api/v2/agent-training/sessions/${id}/review-mark`,body:unknown;
  if(write){
   const reader=request.body?.getReader();if(!reader)return reply({ok:false,reason:'invalid_request'},400);
   const chunks:Uint8Array[]=[];let size=0;
   for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>16000){await reader.cancel();return reply({ok:false,reason:'request_too_large'},413);}chunks.push(part.value);}
   const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
   try{body=JSON.parse(new TextDecoder().decode(bytes));}catch{return reply({ok:false,reason:'invalid_request'},400);}
   if(operation==='source'){
    const v=body as Record<string,unknown>;
    if(!v||Object.keys(v).sort().join(',')!=='artifactId,runId'||!UUID.test(String(v.runId||''))||!UUID.test(String(v.artifactId||'')))return reply({ok:false,reason:'invalid_request'},400);
    path=`/api/v2/agent-training/sessions/${id}/sources`;
   }else{
    const key=request.headers.get('Idempotency-Key');if(!key||key.length<8||key.length>180)return reply({ok:false,reason:'invalid_request'},400);
    headers['Idempotency-Key']=key;
   }
  }else{
   const named=['sourceId','reviewSessionId','issueId'];
   if(named.some(name=>query.getAll(name).length!==1||!UUID.test(query.get(name)||'')))return reply({ok:false,reason:'invalid_request'},400);
   path+=`?${new URLSearchParams(Object.fromEntries(named.map(name=>[name,query.get(name)!])))}`;
  }
  const response=await fetch(`${BACKEND}${path}`,{method:write?'POST':'GET',headers,...(write?{body:JSON.stringify(body)}:{}),cache:'no-store',signal:AbortSignal.any([request.signal,AbortSignal.timeout(10000)])});
  return reply(await response.json(),response.status);
 }catch{return reply({ok:false,reason:'training_review_unavailable'},503);}
}
export function GET(request:Request){return forward(request,false);}
export function POST(request:Request){return forward(request,true);}
