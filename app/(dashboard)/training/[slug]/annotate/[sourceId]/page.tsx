import {notFound} from 'next/navigation';
import {UUID} from '@/lib/trainer-questions';
import TrainingAnnotationPage from '../../training-annotation-page';
export const dynamic='force-dynamic';
export default function Page({params,searchParams}:{params:{slug:string;sourceId:string};searchParams?:{sessionId?:string;feedback?:string;details?:string}}){
 if(!UUID.test(params.sourceId)||!UUID.test(searchParams?.sessionId||'')||searchParams?.feedback!==undefined&&!/^[a-f0-9]{64}$/.test(searchParams.feedback))notFound();
 return TrainingAnnotationPage({slug:params.slug,target:{kind:'image',sourceId:params.sourceId,sessionId:searchParams!.sessionId!,details:searchParams?.details==='1',...(searchParams?.feedback?{feedback:searchParams.feedback}:{})}});
}
