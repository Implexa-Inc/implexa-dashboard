import {NextResponse} from 'next/server';
import {createClient} from '@/lib/supabase/server';
const BASE=(process.env.NEXT_PUBLIC_IMPLEXA_API_URL||'https://core.implexa.ai').replace(/\/$/,'');
async function forward(request:Request,write:boolean){
 const {data:{session}}=await createClient().auth.getSession();
 if(!session?.access_token)return NextResponse.json({ok:false,reason:'unauthorized'},{status:401});
 const id=new URL(request.url).searchParams.get('id');
 try{
  const res=await fetch(`${BASE}/api/v2/admin/marketplace-submissions${id?`?id=${encodeURIComponent(id)}`:''}`,{method:write?'POST':'GET',headers:{authorization:`Bearer ${session.access_token}`,'Content-Type':'application/json'},...(write?{body:JSON.stringify(await request.json())}:{}),cache:'no-store',signal:AbortSignal.timeout(20000)});
  return NextResponse.json(await res.json(),{status:res.status,headers:{'Cache-Control':'no-store'}});
 }catch{return NextResponse.json({ok:false,reason:'marketplace_review_unavailable'},{status:503});}
}
export function GET(req:Request){return forward(req,false);}
export function POST(req:Request){return forward(req,true);}
