import {NextResponse} from 'next/server';
import {createClient} from '@/lib/supabase/server';
import {readTrainingCoach} from '@/lib/training-coach-server';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 const respond=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
 const q=new URL(request.url).searchParams;
 if([...q.keys()].some(k=>!['familyId','contractVersion'].includes(k))||q.getAll('familyId').length>1||q.getAll('contractVersion').length>1||q.has('contractVersion')&&!['training-coach-decisions.v1','training-coach-decisions.v2'].includes(q.get('contractVersion')||'')||q.has('familyId')&&!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(q.get('familyId')||''))return respond({ok:false,reason:'invalid_request'},400);
 const {data:{session}}=await createClient().auth.getSession();
 if(!session?.access_token)return respond({ok:false,reason:'unauthorized'},401);
 const value=await readTrainingCoach(session.access_token,q.get('familyId')||undefined,q.get('contractVersion')||'training-coach-decisions.v1');
 return value.status==='ready'?respond(value.page):respond({ok:false,reason:'training_coach_unavailable'},503);
}
