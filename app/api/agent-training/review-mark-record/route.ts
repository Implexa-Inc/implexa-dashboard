import {NextResponse} from 'next/server';
import {createClient} from '@/lib/supabase/server';
import {UUID} from '@/lib/trainer-questions';
import {trainingReviewMarkRecord} from '@/lib/training-review-mark';
const BACKEND=(process.env.NEXT_PUBLIC_IMPLEXA_API_URL||'https://core.implexa.ai').replace(/\/$/,'');
const SHA=/^[a-f0-9]{64}$/;
export const dynamic='force-dynamic';
const reply=(value:unknown,status=200)=>NextResponse.json(value,{status,headers:{'Cache-Control':'no-store'}});
const unavailable=()=>reply({ok:false,reason:'training_review_record_unavailable'},503);
async function boundedJson(body:ReadableStream<Uint8Array>|null,max:number):Promise<any>{
 if(!body)throw Error('missing body');const reader=body.getReader(),chunks:Uint8Array[]=[];let size=0;
 for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>max){await reader.cancel();throw Error('body too large');}chunks.push(part.value);}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return JSON.parse(new TextDecoder().decode(bytes));
}
async function approved(request:Request,token:string,sessionId:string,recordId:string,digest:string){
 const response=await fetch(`${BACKEND}/api/v2/agent-training/sessions/${sessionId}/review-mark-record?${new URLSearchParams({recordId,expectedRecordDigest:digest})}`,{
  method:'GET',headers:{authorization:`Bearer ${token}`},cache:'no-store',signal:AbortSignal.any([request.signal,AbortSignal.timeout(10000)])});
 const value=await boundedJson(response.body,32000);
 if(response.ok&&trainingReviewMarkRecord(value,{recordId,recordDigest:digest}))return {value};
 const reasons=new Set(['training_review_record_not_found','teaching_changed','training_review_record_unavailable','training_local_disabled']);
 return {refusal:reply({ok:false,reason:reasons.has(value?.reason)?value.reason:'training_review_record_unavailable'},!response.ok&&[404,409,503].includes(response.status)?response.status:503)};
}
/** Read the frozen owner-approved acknowledgment, without expanding image custody. */
export async function GET(request:Request){
 const {data:{session}}=await createClient().auth.getSession();if(!session?.access_token)return reply({ok:false,reason:'unauthorized'},401);
 try{
  const query=new URL(request.url).searchParams,sessionId=query.get('sessionId'),recordId=query.get('recordId'),digest=query.get('expectedRecordDigest'),names=['sessionId','recordId','expectedRecordDigest'];
  if(names.some(name=>query.getAll(name).length!==1)||[...query.keys()].some(name=>!names.includes(name))||!UUID.test(sessionId||'')||!UUID.test(recordId||'')||!SHA.test(digest||''))return reply({ok:false,reason:'invalid_request'},400);
  const result=await approved(request,session.access_token,sessionId!,recordId!,digest!);return result.refusal||reply(result.value);
 }catch{return unavailable();}
}
/** The only write is the existing discard action, scoped by a fresh owner-authorized read. */
export async function POST(request:Request){
 const {data:{session}}=await createClient().auth.getSession();if(!session?.access_token)return reply({ok:false,reason:'unauthorized'},401);
 try{
  const query=new URL(request.url).searchParams,sessionId=query.get('sessionId'),key=request.headers.get('Idempotency-Key');
  if(query.getAll('sessionId').length!==1||[...query.keys()].some(name=>name!=='sessionId')||!UUID.test(sessionId||'')||!key||key.length<8||key.length>180||key.startsWith('commit:'))return reply({ok:false,reason:'invalid_request'},400);
  const body=await boundedJson(request.body,2000);
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==3||body.action!=='discard'||!UUID.test(body.recordId||'')||!SHA.test(body.expectedRecordDigest||''))return reply({ok:false,reason:'invalid_request'},400);
  const result=await approved(request,session.access_token,sessionId!,body.recordId,body.expectedRecordDigest);if(result.refusal)return result.refusal;
  const response=await fetch(`${BACKEND}/api/v2/agent-training/sessions/${result.value!.trainingSessionId}/competence/${body.recordId}/discard`,{
   method:'POST',headers:{authorization:`Bearer ${session.access_token}`,'content-type':'application/json','Idempotency-Key':key},body:JSON.stringify({expectedDigest:body.expectedRecordDigest}),cache:'no-store',signal:AbortSignal.any([request.signal,AbortSignal.timeout(10000)])});
  const receipt=await boundedJson(response.body,4000);
  if(response.ok&&receipt?.ok===true&&Object.keys(receipt).length===5&&typeof receipt.created==='boolean'&&receipt.recordId===body.recordId&&UUID.test(receipt.eventId||'')&&receipt.action==='discard')return reply(receipt);
  const reasons=new Set(['competence_not_found','competence_digest_conflict','idempotency_key_conflict','training_local_disabled']);
  return reply({ok:false,reason:reasons.has(receipt?.reason)?receipt.reason:'training_review_record_unavailable'},!response.ok&&[400,404,409,503].includes(response.status)?response.status:503);
 }catch{return unavailable();}
}
