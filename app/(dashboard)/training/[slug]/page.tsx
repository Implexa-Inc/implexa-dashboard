import TrainingSource from './training-source';
export default function Page({params,searchParams}:{params:{slug:string};searchParams?:{installationId?:string;forkId?:string;forkParentVersionId?:string}}) {
 const installationId=searchParams?.installationId;
 const forkId=searchParams?.forkId,parentVersionId=searchParams?.forkParentVersionId;
 const uuid=(v:string|undefined)=>!!v&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
 if((forkId!==undefined||parentVersionId!==undefined)&&(!uuid(forkId)||!uuid(parentVersionId)||installationId!==undefined))return <main>Fork permission review unavailable.</main>;
 const forkPermission=forkId&&parentVersionId?{lineageId:forkId,parentVersionId}:undefined;
 if(installationId!==undefined&&!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(installationId))return <main>Private preferences unavailable.</main>;
 return <TrainingSource key={`${params.slug}:${installationId||'owner'}`} slug={params.slug} installationId={installationId} forkPermission={forkPermission}/>;
}
