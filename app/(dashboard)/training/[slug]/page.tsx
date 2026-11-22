import {createClient} from '@/lib/supabase/server';
import {redirect} from 'next/navigation';
import {TrainingRouteConfig} from './training-route-host';
import {getAgentDetail,agentActionContext} from '@/lib/agent-detail';
import {getReviewPacket} from '@/lib/review';
import {trainingAnnotationHref} from '@/lib/training-annotation-routing';
import {readMyWorkflows,ownedGeneratedWorkflow} from '@/lib/workflow-catalog';
import type {TrainingRun} from './training-workspace';
export default async function Page({params,searchParams}:{params:{slug:string};searchParams?:{installationId?:string;forkId?:string;forkParentVersionId?:string;recordingId?:string;momentId?:string;annotateRecording?:string;chat?:string}}) {
 const supabase=createClient();
 const [{data:{user}},{data:{session}}]=await Promise.all([supabase.auth.getUser(),supabase.auth.getSession()]);
 if(!user||!session||session.user.id!==user.id)redirect('/login');
 const annotateRecording=searchParams?.annotateRecording;
 const recordingId=searchParams?.recordingId,momentId=searchParams?.momentId;
 const installationId=searchParams?.installationId;
 const forkId=searchParams?.forkId,parentVersionId=searchParams?.forkParentVersionId;
 const uuid=(v:string|undefined)=>!!v&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
 if((forkId!==undefined||parentVersionId!==undefined)&&(!uuid(forkId)||!uuid(parentVersionId)||installationId!==undefined))return <main>Fork permission review unavailable.</main>;
 if((recordingId!==undefined||momentId!==undefined)&&(!uuid(recordingId)||(momentId!==undefined&&!uuid(momentId))||installationId!==undefined))return <main>Recording selection unavailable.</main>;
 if(annotateRecording!==undefined&&!uuid(annotateRecording))return <main>Recording unavailable.</main>;
 if(annotateRecording)redirect(trainingAnnotationHref(params.slug,{kind:'recording',recordingId:annotateRecording}));
 if(recordingId)redirect(trainingAnnotationHref(params.slug,{kind:'recording',recordingId,...(momentId?{momentId}:{})}));
 const forkPermission=forkId&&parentVersionId?{lineageId:forkId,parentVersionId}:undefined;
 if(installationId!==undefined&&!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(installationId))return <main>Private preferences unavailable.</main>;
 // Reuse the existing owner-scoped agent/read and Review Room artifact contracts.
 const [owned,readDetail]=await Promise.all([
  installationId?null:readMyWorkflows(session.access_token),
  installationId?null:getAgentDetail(params.slug,session.access_token,{source:'generated'}),
 ]);
 const ownedAgent=ownedGeneratedWorkflow(owned,params.slug);
 const matches=owned?.status==='ready'?owned.workflows.filter(row=>row.slug===params.slug&&row.source==='generated'):[];
 const conflictingCatalog=matches.length>1||matches.length===1&&!ownedAgent;
 // A hidden agent or an unavailable library must not erase working detail UI.
 // The existing positive own-generated proof can bind its family pointer;
 // public visibility or unknown ownership cannot. Writers still authorize it.
 const detailOwned=readDetail?.status==='ready'&&readDetail.detail.canInspectOwnLearningInfluence===true&&readDetail.detail.workflow.slug===params.slug&&readDetail.detail.workflow.source==='generated'&&uuid(readDetail.detail.workflow.id);
 const familyId=ownedAgent?.workflow_id||(!conflictingCatalog&&detailOwned&&readDetail?.status==='ready'?readDetail.detail.workflow.id:undefined);
 const detail=conflictingCatalog||readDetail?.status==='ready'&&familyId&&readDetail.detail.workflow.id!==familyId?{status:'unavailable' as const}:readDetail;
 const runsUnavailable=!!detail&&(detail.status!=='ready'||detail.detail.isUnavailable('runs'));
 const recent=detail?.status==='ready'&&!runsUnavailable?detail.detail.runs.filter(r=>r.slug===params.slug).sort((a,b)=>b.ran_at.localeCompare(a.ran_at)).slice(0,3):[];
 const recentRuns:TrainingRun[]=await Promise.all(recent.map(async run=>{
  const packet=await getReviewPacket(run.id);
  const artifact=packet.live&&packet.run?.id===run.id&&packet.run.slug===params.slug?packet.artifacts.find(a=>a.runId===run.id&&a.role==='final_output'&&a.status==='validated'&&a.sha256&&/\.(mp4|png|jpe?g|webp)$/i.test(a.relativePath))||null:null;
  return {id:run.id,date:run.ran_at,status:run.state.label,artifact};
 }));
 return <TrainingRouteConfig value={{slug:params.slug,familyId,ownerId:user.id,runContext:installationId?undefined:agentActionContext(detail||{status:'unavailable'}),initialRecordingId:annotateRecording,initialChat:searchParams?.chat==='edit',lastRunId:recentRuns[0]?.id,recentRuns,runsUnavailable,installationId,forkPermission}}/>;
}
