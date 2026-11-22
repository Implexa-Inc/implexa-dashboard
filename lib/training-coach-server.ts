import 'server-only';
import {coachPage,type CoachRead} from './training-coach';
const BACKEND=(process.env.NEXT_PUBLIC_IMPLEXA_API_URL||'https://core.implexa.ai').replace(/\/$/,'');
/** Optional background read: streamed independently of the page shell and teaching controls.
 * The5s transport bound includes margin above the backend4.5s / database4s limits. */
export async function readTrainingCoach(jwt:string,familyId?:string,contractVersion='training-coach-decisions.v1'):Promise<CoachRead>{
 const query=new URLSearchParams({...(familyId?{familyId}:{}),...(contractVersion==='training-coach-decisions.v2'?{contractVersion}:{})});
 const signal=AbortSignal.timeout(5000),read=(q:URLSearchParams)=>fetch(`${BACKEND}/api/v2/agent-training/coach${q.size?`?${q}`:''}`,{headers:{authorization:`Bearer ${jwt}`},cache:'no-store',signal});
 try{
  let response=await read(query);
  // Known old-server query refusal can serve the same scoped legacy cards;
  // it never grants save-to-Coach readiness or widens the requested family.
  if(contractVersion==='training-coach-decisions.v2'&&response.status===400){const refusal=await response.json();if(refusal?.reason!=='invalid_request')return{status:'unavailable'};query.delete('contractVersion');response=await read(query);}
  if(!response.ok)return{status:'unavailable'};const page=coachPage(await response.json());return page?{status:'ready',page}:{status:'unavailable'};
 }catch{return{status:'unavailable'};}
}
