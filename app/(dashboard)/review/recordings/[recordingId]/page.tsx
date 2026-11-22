import {createClient} from '@/lib/supabase/server';
import {redirect} from 'next/navigation';
import {trainingAnnotationHref} from '@/lib/training-annotation-routing';
import {UUID} from '@/lib/trainer-questions';
import {readMyWorkflows} from '@/lib/workflow-catalog';
import RecordingPlayer from './recording-player';

export const dynamic = 'force-dynamic';

/**
 * /review/recordings/[recordingId] — play a recording from the local library and mark
 * draft moments on it (spec §3.3, §5). NET NEW.
 *
 * The id is opaque and is the only thing handed to Implexa Desktop; the video plays
 * from the `implexa-artifact://preview/<token>` URL the Desktop mints for it. Moments
 * stay drafts in the library: turning them into review issues or learnings is a later
 * slice (L2/L3), not this page.
 */
export default async function RecordingPlayerPage({ params,searchParams }: { params: { recordingId: string }; searchParams?:{trainingSlug?:string;sessionId?:string;sourceId?:string;analyze?:string} }) {
  const {data:{user}}=await createClient().auth.getUser();
  if(!user)redirect('/login');
  const trainingSlug=searchParams?.trainingSlug;
  if(trainingSlug!==undefined&&!/^[a-zA-Z0-9_-]{1,200}$/.test(trainingSlug))return <main>Training context unavailable.</main>;
  if(trainingSlug){
    if(!UUID.test(params.recordingId)||(searchParams?.sessionId!==undefined&&!UUID.test(searchParams.sessionId))||(searchParams?.sourceId!==undefined&&!UUID.test(searchParams.sourceId))||Boolean(searchParams?.sessionId)!==Boolean(searchParams?.sourceId))return <main>Recording context unavailable.</main>;
    const {data:{session}}=await createClient().auth.getSession();
    if(!session||session.user.id!==user.id)redirect('/login');
    const owned=await readMyWorkflows(session.access_token);
    if(owned.status!=='ready'||!owned.workflows.some(agent=>agent.slug===trainingSlug&&agent.source==='generated'))return <main>Training context unavailable.</main>;
    redirect(trainingAnnotationHref(trainingSlug,{kind:'recording',recordingId:params.recordingId,...(searchParams?.sessionId?{sessionId:searchParams.sessionId,sourceId:searchParams.sourceId}:{}),analyze:searchParams?.analyze==='1'}));
  }
  return <RecordingPlayer recordingId={params.recordingId} ownerId={user.id} trainingSlug={trainingSlug}/>;
}
