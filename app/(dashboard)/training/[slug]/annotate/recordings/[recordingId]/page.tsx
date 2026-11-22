import {notFound} from 'next/navigation';
import {UUID} from '@/lib/trainer-questions';
import TrainingAnnotationPage from '../../../training-annotation-page';
export const dynamic='force-dynamic';
export default function Page({params,searchParams}:{params:{slug:string;recordingId:string};searchParams?:{momentId?:string;sessionId?:string;sourceId?:string;analyze?:string}}){
 if(!UUID.test(params.recordingId)||(searchParams?.momentId!==undefined&&!UUID.test(searchParams.momentId))||(searchParams?.sessionId!==undefined&&!UUID.test(searchParams.sessionId))||(searchParams?.sourceId!==undefined&&!UUID.test(searchParams.sourceId))||Boolean(searchParams?.sessionId)!==Boolean(searchParams?.sourceId))notFound();
 return TrainingAnnotationPage({slug:params.slug,target:{kind:'recording',recordingId:params.recordingId,...(searchParams?.momentId?{momentId:searchParams.momentId}:{}),...(searchParams?.sessionId?{sessionId:searchParams.sessionId,sourceId:searchParams.sourceId}:{}),analyze:searchParams?.analyze==='1'}});
}
