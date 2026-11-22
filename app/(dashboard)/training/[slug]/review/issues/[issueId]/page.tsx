import {notFound} from 'next/navigation';
import {UUID} from '@/lib/trainer-questions';
import TrainingAnnotationPage from '../../../training-annotation-page';
export const dynamic='force-dynamic';
export default function Page({params}:{params:{slug:string;issueId:string}}){
 if(!UUID.test(params.issueId))notFound();
 return TrainingAnnotationPage({slug:params.slug,target:{kind:'result',issueId:params.issueId}});
}
