import {createClient} from '@/lib/supabase/server';
import {redirect} from 'next/navigation';
import TrainingSource from './training-source';
import {getMyAgents} from '@/lib/agents-home';
export default async function Page({params,searchParams}:{params:{slug:string};searchParams?:{installationId?:string;forkId?:string;forkParentVersionId?:string;recordingId?:string;momentId?:string}}) {
 const {data:{user}}=await createClient().auth.getUser();
 if(!user)redirect('/login');
 const recordingId=searchParams?.recordingId,momentId=searchParams?.momentId;
 const installationId=searchParams?.installationId;
 const forkId=searchParams?.forkId,parentVersionId=searchParams?.forkParentVersionId;
 const uuid=(v:string|undefined)=>!!v&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
 if((forkId!==undefined||parentVersionId!==undefined)&&(!uuid(forkId)||!uuid(parentVersionId)||installationId!==undefined))return <main>Fork permission review unavailable.</main>;
 if((recordingId!==undefined||momentId!==undefined)&&(!uuid(recordingId)||(momentId!==undefined&&!uuid(momentId))||installationId!==undefined))return <main>Recording selection unavailable.</main>;
 const forkPermission=forkId&&parentVersionId?{lineageId:forkId,parentVersionId}:undefined;
 if(installationId!==undefined&&!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(installationId))return <main>Private preferences unavailable.</main>;
 const feed=installationId?null:await getMyAgents();
 const agent=feed?.status==='ready'?[...feed.active,...feed.needsActivation,...feed.drafts].find(a=>a.slug===params.slug):null;
 return <TrainingSource key={`${params.slug}:${installationId||'owner'}:${user.id}`} slug={params.slug} ownerId={user.id} lastRunId={agent?.lastRun?.id} recordingSelection={recordingId?{recordingId,momentId:momentId||null}:undefined} installationId={installationId} forkPermission={forkPermission}/>;
}
