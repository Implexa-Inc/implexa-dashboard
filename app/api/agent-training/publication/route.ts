import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
const BACKEND=(process.env.NEXT_PUBLIC_IMPLEXA_API_URL||'https://core.implexa.ai').replace(/\/$/,'');
async function forward(request:Request,write:boolean) {
  const {data:{session}}=await createClient().auth.getSession();
  if(!session?.access_token)return NextResponse.json({ok:false,reason:'unauthorized'},{status:401});
  const slug=new URL(request.url).searchParams.get('slug');
  if(!slug||slug.length>200)return NextResponse.json({ok:false,reason:'slug_required'},{status:400});
  try {
    const response=await fetch(`${BACKEND}/api/v2/agent-training/agents/${encodeURIComponent(slug)}/publication`,{
      method:write?'POST':'GET',headers:{authorization:`Bearer ${session.access_token}`,'Content-Type':'application/json'},
      ...(write?{body:JSON.stringify(await request.json())}:{}),cache:'no-store',signal:AbortSignal.timeout(15000),
    });
    return NextResponse.json(await response.json(),{status:response.status,headers:{'Cache-Control':'no-store'}});
  }catch{return NextResponse.json({ok:false,reason:'agent_publication_unavailable'},{status:503});}
}
export function GET(request:Request){return forward(request,false);}
export function POST(request:Request){return forward(request,true);}
