import {createClient} from '@/lib/supabase/server';
import {redirect} from 'next/navigation';
import TrainingSource from './training-source';
import {getAgentDetail} from '@/lib/agent-detail';
import {getReviewPacket} from '@/lib/review';
import type {TrainingRun} from './training-workspace';
export default async function Page({params,searchParams}:{params:{slug:string};searchParams?:{installationId?:string;forkId?:string;forkParentVersionId?:string;recordingId?:string;momentId?:string}}) {
 const supabase=createClient();
 const [{data:{user}},{data:{session}}]=await Promise.all([supabase.auth.getUser(),supabase.auth.getSession()]);
 if(!user||!session||session.user.id!==user.id)redirect('/login');
 const recordingId=searchParams?.recordingId,momentId=searchParams?.momentId;
 const installationId=searchParams?.installationId;
 const forkId=searchParams?.forkId,parentVersionId=searchParams?.forkParentVersionId;
 const uuid=(v:string|undefined)=>!!v&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
 if((forkId!==undefined||parentVersionId!==undefined)&&(!uuid(forkId)||!uuid(parentVersionId)||installationId!==undefined))return <main>Fork permission review unavailable.</main>;
 if((recordingId!==undefined||momentId!==undefined)&&(!uuid(recordingId)||(momentId!==undefined&&!uuid(momentId))||installationId!==undefined))return <main>Recording selection unavailable.</main>;
 const forkPermission=forkId&&parentVersionId?{lineageId:forkId,parentVersionId}:undefined;
 if(installationId!==undefined&&!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(installationId))return <main>Private preferences unavailable.</main>;
 // Reuse the existing owner-scoped agent/read and Review Room artifact contracts.
 const detail=installationId?null:await getAgentDetail(params.slug,session.access_token,{source:'generated'});
 const runsUnavailable=!!detail&&(detail.status!=='ready'||detail.detail.isUnavailable('runs'));
 const recent=detail?.status==='ready'&&!runsUnavailable?detail.detail.runs.filter(r=>r.slug===params.slug).sort((a,b)=>b.ran_at.localeCompare(a.ran_at)).slice(0,3):[];
 const recentRuns:TrainingRun[]=await Promise.all(recent.map(async run=>{
  const packet=await getReviewPacket(run.id);
  const artifact=packet.live&&packet.run?.id===run.id&&packet.run.slug===params.slug?packet.artifacts.find(a=>a.runId===run.id&&a.role==='final_output'&&a.status==='validated'&&a.sha256&&/\.(mp4|png|jpe?g|webp)$/i.test(a.relativePath))||null:null;
  return {id:run.id,date:run.ran_at,status:run.state.label,artifact};
 }));
 return <TrainingSource key={`${params.slug}:${installationId||'owner'}:${user.id}`} slug={params.slug} ownerId={user.id} lastRunId={recentRuns[0]?.id} recentRuns={recentRuns} runsUnavailable={runsUnavailable} recordingSelection={recordingId?{recordingId,momentId:momentId||null}:undefined} installationId={installationId} forkPermission={forkPermission}/>;
}
