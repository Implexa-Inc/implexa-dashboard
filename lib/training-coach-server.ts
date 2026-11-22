import 'server-only';
import {coachPage,type CoachRead} from './training-coach';
const BACKEND=(process.env.NEXT_PUBLIC_IMPLEXA_API_URL||'https://core.implexa.ai').replace(/\/$/,'');
/** Independent of the old roster and full training history reads. */
export async function readTrainingCoach(jwt:string,familyId?:string):Promise<CoachRead>{
 try{const response=await fetch(`${BACKEND}/api/v2/agent-training/coach${familyId?`?familyId=${encodeURIComponent(familyId)}`:''}`,{headers:{authorization:`Bearer ${jwt}`},cache:'no-store',signal:AbortSignal.timeout(3000)});if(!response.ok)return{status:'unavailable'};const page=coachPage(await response.json());return page?{status:'ready',page}:{status:'unavailable'};}catch{return{status:'unavailable'};}
}
