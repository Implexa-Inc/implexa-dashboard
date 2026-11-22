import {NextResponse} from 'next/server';
import {createClient} from '@/lib/supabase/server';
export const maxDuration=120;
const CORE=(process.env.NEXT_PUBLIC_IMPLEXA_API_URL||'https://core.implexa.ai').replace(/\/$/,'');
const uuid=/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
export async function POST(request:Request){
 const {data:{session}}=await createClient().auth.getSession();
 if(!session?.access_token)return NextResponse.json({ok:false,reason:'unauthorized'},{status:401});
 const q=new URL(request.url).searchParams,action=q.get('action'),id=q.get('id'),slug=q.get('slug');
 const allowed=action==='reserve'?['action','slug']:['action','id'];
 if(q.size!==2||[...q.keys()].some(key=>!allowed.includes(key)))return NextResponse.json({ok:false,reason:'invalid_request'},{status:400});
 const target=action==='reserve'&&slug&&/^[a-zA-Z0-9_-]{1,200}$/.test(slug)?`agents/${encodeURIComponent(slug)}/marketplace-samples`:['prepare','remove'].includes(action||'')&&uuid.test(id||'')?`marketplace-samples/${id}/${action}`:null;
 if(!target)return NextResponse.json({ok:false,reason:'invalid_request'},{status:400});
 try{
  const text=await request.text();if(text.length>16384)return NextResponse.json({ok:false,reason:'invalid_request'},{status:413});const body=JSON.parse(text);
  const r=await fetch(`${CORE}/api/v2/agent-training/${target}`,{method:'POST',headers:{authorization:`Bearer ${session.access_token}`,'Content-Type':'application/json',...(action==='reserve'?{'Idempotency-Key':request.headers.get('Idempotency-Key')||''}:{})},body:JSON.stringify(body),cache:'no-store',signal:AbortSignal.any([request.signal,AbortSignal.timeout(action==='prepare'?115000:20000)])});
  return NextResponse.json(await r.json(),{status:r.status,headers:{'Cache-Control':'no-store'}});
 }catch{return NextResponse.json({ok:false,reason:'sample_request_unconfirmed'},{status:503});}
}
export async function GET(request:Request){
 const {data:{session}}=await createClient().auth.getSession();
 if(!session?.access_token)return new Response(null,{status:401});
 const q=new URL(request.url).searchParams,id=q.get('id'),variant=q.get('variant');
 if(q.get('action')==='cover'){
  const familyId=q.get('familyId');if(q.size!==2||[...q.keys()].some(key=>!['action','familyId'].includes(key))||!uuid.test(familyId||''))return new Response(null,{status:400});
  try{const r=await fetch(`${CORE}/api/v2/agent-training/marketplace-samples/cover/${familyId}`,{headers:{authorization:`Bearer ${session.access_token}`},cache:'no-store',signal:AbortSignal.any([request.signal,AbortSignal.timeout(3000)])});return NextResponse.json(await r.json(),{status:r.status,headers:{'Cache-Control':'private, no-store'}});}catch{return NextResponse.json({ok:false,reason:'sample_storage_unavailable'},{status:503});}
 }

 // Originals are never proxied through Vercel. Only bounded normalised media.
 if(q.size!==2||[...q.keys()].some(key=>!['id','variant'].includes(key))||!uuid.test(id||'')||!['preview','poster'].includes(variant||''))return new Response(null,{status:400});
 try{
  const r=await fetch(`${CORE}/api/v2/agent-training/marketplace-samples/${id}/${variant}`,{headers:{authorization:`Bearer ${session.access_token}`,...(request.headers.has('Range')?{Range:request.headers.get('Range')!}:{})},cache:'no-store',signal:AbortSignal.any([request.signal,AbortSignal.timeout(15000)])});
  const headers=new Headers({'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});
  for(const key of ['Content-Type','Content-Length','Content-Range','Accept-Ranges'])if(r.headers.has(key))headers.set(key,r.headers.get(key)!);
  return new Response(r.body,{status:r.status,headers});
 }catch{return new Response(null,{status:503,headers:{'Cache-Control':'no-store'}});}
}
