import Link from 'next/link';
import {getReviewPacket} from '@/lib/review';
import {redirect,notFound} from 'next/navigation';
import {createClient} from '@/lib/supabase/server';
import {readMyWorkflows} from '@/lib/workflow-catalog';
import {getAgentDetail,agentActionContext} from '@/lib/agent-detail';
import type {TrainingAnnotationTarget} from '@/lib/training-annotation-routing';
import {TrainingRouteConfig} from './training-route-host';

/** Existing Train controller, on the annotation routes with no chat/Train columns. */
export default async function TrainingAnnotationPage({slug,target}:{slug:string;target:TrainingAnnotationTarget}){
 const db=createClient();const {data:{session}}=await db.auth.getSession();
 if(!session?.user)redirect('/login');
 const owned=await readMyWorkflows(session.access_token);
 if(owned.status!=='ready'||!owned.workflows.some(agent=>agent.slug===slug&&agent.source==='generated'))return <main className="app-page"><h1>Training annotation unavailable</h1><p>We couldn’t verify this agent belongs to you.</p><Link href="/training">Return to Coach</Link></main>;
 if(target.kind==='result'&&target.runId){const packet=await getReviewPacket(target.runId);if(packet.live&&packet.run?.slug!==slug)notFound();if(packet.live&&packet.run?.holdKind==='approval_before_action')redirect(`/review/${encodeURIComponent(target.runId)}`);}
 const detail=await getAgentDetail(slug,session.access_token,{source:'generated'});
 return <TrainingRouteConfig value={{slug,familyId:detail.status==='ready'?detail.detail.workflow.id:undefined,ownerId:session.user.id,runContext:agentActionContext(detail),annotationTarget:target}}/>;
}
