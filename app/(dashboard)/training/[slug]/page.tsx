import TrainingSource from './training-source';
export default function Page({params,searchParams}:{params:{slug:string};searchParams?:{installationId?:string}}) {
 const installationId=searchParams?.installationId;
 if(installationId!==undefined&&!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(installationId))return <main>Private preferences unavailable.</main>;
 return <TrainingSource key={`${params.slug}:${installationId||'owner'}`} slug={params.slug} installationId={installationId}/>;
}
