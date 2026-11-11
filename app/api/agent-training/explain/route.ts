import {NextResponse} from 'next/server';
import {createClient} from '@/lib/supabase/server';
import {UUID} from '@/lib/trainer-questions';

export const maxDuration=45;
const BACKEND=(process.env.NEXT_PUBLIC_IMPLEXA_API_URL||'https://core.implexa.ai').replace(/\/$/,'');
/** Presentation-only explanation. The backend reads one saved teaching; no admission. */
export async function POST(request:Request){
  const reply=(value:unknown,status=200)=>NextResponse.json(value,{status,headers:{'Cache-Control':'no-store'}});
  try{
    const {data:{session}}=await createClient().auth.getSession();
    if(!session?.access_token)return reply({ok:false,reason:'unauthorized'},401);
    const query=new URL(request.url).searchParams,id=query.get('sessionId');
    if(query.getAll('sessionId').length!==1||[...query.keys()].some(key=>key!=='sessionId')||!UUID.test(id||''))return reply({ok:false,reason:'invalid_request'},400);
    const raw=await request.text();if(raw.length>500)return reply({ok:false,reason:'invalid_request'},400);
    const body=JSON.parse(raw);
    if(!body||Array.isArray(body)||Object.keys(body).length!==2||!UUID.test(body.recordId||'')||!/^[a-f0-9]{64}$/.test(body.recordDigest||''))return reply({ok:false,reason:'invalid_request'},400);
    const result=await fetch(`${BACKEND}/api/v2/agent-training/sessions/${id}/explain`,{
      method:'POST',headers:{authorization:`Bearer ${session.access_token}`,'content-type':'application/json'},body:JSON.stringify(body),cache:'no-store',
      signal:AbortSignal.any([request.signal,AbortSignal.timeout(35000)])});
    return reply(await result.json(),result.status);
  }catch{return reply({ok:false,reason:'training_explanation_unavailable'},503);}
}
