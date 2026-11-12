import {NextResponse} from 'next/server';
import {createClient} from '@/lib/supabase/server';
import {UUID} from '@/lib/trainer-questions';
const BACKEND=(process.env.NEXT_PUBLIC_IMPLEXA_API_URL||'https://core.implexa.ai').replace(/\/$/,'');
export async function POST(request:Request){
 const {data:{session}}=await createClient().auth.getSession();if(!session?.access_token)return NextResponse.json({ok:false,reason:'unauthorized'},{status:401});
 const q=new URL(request.url).searchParams,id=q.get('sessionId');
 if(!UUID.test(id||'')||[...q.keys()].some(k=>k!=='sessionId'))return NextResponse.json({ok:false,reason:'invalid_request'},{status:400});
 try{
  const reader=request.body?.getReader();if(!reader)return NextResponse.json({ok:false,reason:'invalid_request'},{status:400});
  const chunks:Uint8Array[]=[];let size=0;for(;;){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>10000){await reader.cancel();return NextResponse.json({ok:false,reason:'invalid_request'},{status:413});}chunks.push(r.value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  const body=JSON.parse(new TextDecoder().decode(bytes));
  const response=await fetch(`${BACKEND}/api/v2/agent-training/sessions/${id}/chat-edit`,{method:'POST',headers:{authorization:`Bearer ${session.access_token}`,'content-type':'application/json'},body:JSON.stringify(body),cache:'no-store',signal:AbortSignal.any([request.signal,AbortSignal.timeout(8000)])});
  return NextResponse.json(await response.json(),{status:response.status,headers:{'Cache-Control':'no-store'}});
 }catch{return NextResponse.json({ok:false,reason:'training_chat_edit_unconfirmed'},{status:503});}
}
