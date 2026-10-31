import {NextResponse} from 'next/server';
import {createClient} from '@/lib/supabase/server';
import {UUID} from '@/lib/trainer-questions';
export const maxDuration=45;
const BACKEND=(process.env.NEXT_PUBLIC_IMPLEXA_API_URL||'https://core.implexa.ai').replace(/\/$/,'');
async function forward(request:Request,write:boolean){
 const {data:{session}}=await createClient().auth.getSession();
 if(!session?.access_token)return NextResponse.json({ok:false,reason:'unauthorized'},{status:401});
 try{
  const q=new URL(request.url).searchParams,id=q.get('sessionId'),source=q.get('sourceId');
  if(!UUID.test(id||'')||[...q.keys()].some(k=>k!=='sessionId'&&(write||k!=='sourceId'))||(!write&&source!==null&&!UUID.test(source)))
   return NextResponse.json({ok:false,reason:'invalid_request'},{status:400});
  let body:unknown;
  if(write){
   const reader=request.body?.getReader();if(!reader)return NextResponse.json({ok:false,reason:'invalid_request'},{status:400});
   const chunks:Uint8Array[]=[];let size=0;
   for(;;){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>16000){await reader.cancel();return NextResponse.json({ok:false,reason:'training_chat_message_too_large'},{status:413});}chunks.push(r.value);}
   const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}body=JSON.parse(new TextDecoder().decode(bytes));
  }
  const r=await fetch(`${BACKEND}/api/v2/agent-training/sessions/${id}/chat${!write&&source?`?sourceId=${source}`:''}`,{
   method:write?'POST':'GET',headers:{authorization:`Bearer ${session.access_token}`,'content-type':'application/json'},
   ...(write?{body:JSON.stringify(body)}:{}),cache:'no-store',signal:AbortSignal.any([request.signal,AbortSignal.timeout(write?35000:8000)])});
  return NextResponse.json(await r.json(),{status:r.status,headers:{'Cache-Control':'no-store'}});
 }catch{return NextResponse.json({ok:false,reason:write?'training_chat_response_unconfirmed':'training_chat_unavailable'},{status:503});}
}
export function GET(request:Request){return forward(request,false);}
export function POST(request:Request){return forward(request,true);}
