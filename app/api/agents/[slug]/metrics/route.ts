import {NextResponse} from 'next/server';
import {createClient} from '@/lib/supabase/server';
const BACKEND=(process.env.NEXT_PUBLIC_IMPLEXA_API_URL||'https://core.implexa.ai').replace(/\/$/,'');
export async function GET(request:Request,{params}:{params:{slug:string}}){
 const {data:{session}}=await createClient().auth.getSession();
 if(!session?.access_token)return NextResponse.json({ok:false,code:'unauthorized'},{status:401});
 const q=new URL(request.url).searchParams;
 if(!/^[a-zA-Z0-9_-]{1,200}$/.test(params.slug)||[...q.keys()].some(k=>k!=='source')||q.getAll('source').length>1||q.has('source')&&!/^[a-zA-Z0-9_-]{1,100}$/.test(q.get('source')!))return NextResponse.json({ok:false,code:'invalid_request'},{status:400});
 try{const r=await fetch(`${BACKEND}/api/v2/me/agents/${encodeURIComponent(params.slug)}/metrics${q.has('source')?`?source=${q.get('source')}`:''}`,{headers:{authorization:`Bearer ${session.access_token}`},cache:'no-store',signal:AbortSignal.any([request.signal,AbortSignal.timeout(6000)])});
  return NextResponse.json(await r.json(),{status:r.status,headers:{'Cache-Control':'no-store'}});
 }catch{return NextResponse.json({ok:false,code:'unavailable'},{status:503,headers:{'Cache-Control':'no-store'}});}
}
