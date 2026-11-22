import {notFound} from 'next/navigation';
import {UUID} from '@/lib/trainer-questions';
import TrainingAnnotationPage from '../../../training-annotation-page';
export const dynamic='force-dynamic';
export default function Page({params,searchParams}:{params:{slug:string;annotationId:string};searchParams?:{sessionId?:string;digest?:string}}){
 if(!UUID.test(params.annotationId)||!UUID.test(searchParams?.sessionId||'')||!/^[a-f0-9]{64}$/.test(searchParams?.digest||''))notFound();
 return TrainingAnnotationPage({slug:params.slug,target:{kind:'feedback',annotationId:params.annotationId,annotationDigest:searchParams!.digest!,sessionId:searchParams!.sessionId!}});
}
