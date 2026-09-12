import TrainingSource from './training-source';
export default function Page({params}:{params:{slug:string}}) { return <TrainingSource slug={params.slug}/>; }
