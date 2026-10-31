import {NextResponse} from 'next/server';
import {createClient} from '@/lib/supabase/server';
import {UUID} from '@/lib/trainer-questions';
const BACKEND=(process.env.NEXT_PUBLIC_IMPLEXA_API_URL||'https://core.implexa.ai').replace(/\/$/,'');
async function forward(request:Request,write:boolean){
 const {data:{session}}=await createClient().auth.getSession();
 if(!session?.access_token)return NextResponse.json({ok:false,reason:'unauthorized'},{status:401});
 try{
  const q=new URL(request.url).searchParams,id=q.get('sessionId'),operation=q.get('operation');
  if(!UUID.test(id||'')||[...q.keys()].some(k=>k!=='sessionId'&&(!write||k!=='operation'))
   ||write&&!['policy','records','withdraw','creation-import','tests/prepare'].includes(operation||''))return NextResponse.json({ok:false,reason:'invalid_request'},{status:400});
  const headers:Record<string,string>={authorization:`Bearer ${session.access_token}`,'content-type':'application/json'};
  let body;
  if(write){const key=request.headers.get('Idempotency-Key');
   if(!key||key.length<8||key.length>180||Number(request.headers.get('content-length')||0)>16000)return NextResponse.json({ok:false,reason:'invalid_request'},{status:400});
   const reader=request.body?.getReader();if(!reader)throw Error('missing body');
   const chunks:Uint8Array[]=[];let size=0;
   for(;;){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>16000){await reader.cancel();return NextResponse.json({ok:false,reason:'request_too_large'},{status:413});}chunks.push(r.value);}
   const bytes=new Uint8Array(size);let pos=0;for(const chunk of chunks){bytes.set(chunk,pos);pos+=chunk.length;}
   body=JSON.parse(new TextDecoder().decode(bytes));headers['Idempotency-Key']=key;
  }
  const r=await fetch(`${BACKEND}/api/v2/agent-training/sessions/${id}/changes${write?`/${operation}`:''}`,{
   method:write?'POST':'GET',headers,...(write?{body:JSON.stringify(body)}:{}),cache:'no-store',signal:AbortSignal.any([request.signal,AbortSignal.timeout(10000)])});
  return NextResponse.json(await r.json(),{status:r.status,headers:{'Cache-Control':'no-store'}});
 }catch{return NextResponse.json({ok:false,reason:'training_changes_unavailable'},{status:503});}
}
export function GET(request:Request){return forward(request,false);}
export function POST(request:Request){return forward(request,true);}
