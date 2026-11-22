import ReviewRoomPage from '../../../../_components/review-room-page';
import {notFound} from 'next/navigation';
import TrainingAnnotationPage from '../../training-annotation-page';
import {UUID} from '@/lib/trainer-questions';
export const dynamic='force-dynamic';
export default function Page({params,searchParams}:{params:{slug:string;runId:string};searchParams?:{artifact?:string;issueId?:string;mode?:string}}){
 if(!UUID.test(params.runId)||searchParams?.issueId!==undefined&&!UUID.test(searchParams.issueId))notFound();
 if(searchParams?.mode==='revise')return ReviewRoomPage({params,searchParams,trainingSlug:params.slug});
 return TrainingAnnotationPage({slug:params.slug,target:{kind:'result',runId:params.runId,...(searchParams?.issueId?{issueId:searchParams.issueId}:{}),...(searchParams?.artifact?{artifactId:searchParams.artifact}:{})}});
}
