import {NextResponse} from 'next/server';
import {createClient} from '@/lib/supabase/server';
const BACKEND=(process.env.NEXT_PUBLIC_IMPLEXA_API_URL||'https://core.implexa.ai').replace(/\/$/,'');
export const maxDuration=45;
export async function POST(request:Request){
 const {data:{session}}=await createClient().auth.getSession();
 if(!session?.access_token)return NextResponse.json({ok:false,reason:'unauthorized'},{status:401});
 try{
  const body=await request.json();
  if(new URL(request.url).search||!body||!['context','share','list','read','draft','prepare','withdraw','dismiss'].includes(body.action))return NextResponse.json({ok:false,reason:'invalid_request'},{status:400});
  const key=request.headers.get('Idempotency-Key');
  const response=await fetch(`${BACKEND}/api/v2/agent-training/customer-contributions`,{method:'POST',cache:'no-store',
   headers:{authorization:`Bearer ${session.access_token}`,'content-type':'application/json',...(key?{'Idempotency-Key':key}:{})},body:JSON.stringify(body),signal:AbortSignal.any([request.signal,AbortSignal.timeout(35000)])});
  return NextResponse.json(await response.json(),{status:response.status,headers:{'Cache-Control':'no-store'}});
 }catch{return NextResponse.json({ok:false,reason:'customer_contribution_unavailable'},{status:503});}
}

export async function GET(request:Request){
 const query=new URL(request.url).searchParams,slug=query.get('slug');
 if([...query.keys()].length!==1||!/^[a-zA-Z0-9_-]{1,200}$/.test(slug||''))return NextResponse.json({ok:false,reason:'invalid_request'},{status:400});
 return POST(new Request(new URL('/api/agent-training/customer-contributions',request.url),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'list',slug}),signal:request.signal}));
}
