import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { UUID } from '@/lib/trainer-questions';

const BACKEND=(process.env.NEXT_PUBLIC_IMPLEXA_API_URL||'https://core.implexa.ai').replace(/\/$/,'');
// One scoped context/opener. No publisher home, arbitrary path or corpus proxy.
async function forward(request:Request,write:boolean){
 const {data:{session}}=await createClient().auth.getSession();
 if(!session?.access_token)return NextResponse.json({ok:false,reason:'unauthorized'},{status:401});
 try{
  const query=new URL(request.url).searchParams,installationId=query.get('installationId'),sessionId=query.get('sessionId');
  if([...query.keys()].some(k=>!['installationId',...(write?[]:['sessionId'])].includes(k))
   ||!UUID.test(installationId||'')||(sessionId!==null&&!UUID.test(sessionId)))
   return NextResponse.json({ok:false,reason:'invalid_request'},{status:400});
  const headers:Record<string,string>={authorization:`Bearer ${session.access_token}`,'content-type':'application/json'};
  let body;
  if(write){body=await request.json();const key=request.headers.get('Idempotency-Key');
   if(!body||Object.keys(body).join()!=='expectedVersionId'||!UUID.test(body.expectedVersionId||'')||!key||key.length<8||key.length>180)
    return NextResponse.json({ok:false,reason:'invalid_request'},{status:400});
   headers['Idempotency-Key']=key;
  }
  const suffix=!write&&sessionId?`?sessionId=${sessionId}`:'';
  const response=await fetch(`${BACKEND}/api/v2/agent-training/installations/${installationId}/preferences${suffix}`,{
   method:write?'POST':'GET',headers,...(write?{body:JSON.stringify(body)}:{}),cache:'no-store',signal:AbortSignal.timeout(8000)});
  return NextResponse.json(await response.json(),{status:response.status,headers:{'Cache-Control':'no-store'}});
 }catch{return NextResponse.json({ok:false,reason:'installation_preference_unavailable'},{status:503});}
}
export function GET(request:Request){return forward(request,false);}
export function POST(request:Request){return forward(request,true);}
