export const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const DIGEST=/^[a-f0-9]{64}$/;
export type Contribution={id:string;agentFamilyId:string;producingVersionId:string;shareDigest:string;excerpt:string;
 evidence:{evidenceId:string;sha256:string;sizeBytes:number;width:number;height:number;mediaType:'image/png';timeMs:number|null};
 teaching?:{recordId:string;recordDigest:string}|null;createdAt:string;expiresAt:string;storedAt:string|null;withdrawnAt:string|null;dismissedAt:string|null;referenceOnly:true};
export function isContribution(v:any):v is Contribution{return !!v&&UUID.test(v.id||'')&&UUID.test(v.agentFamilyId||'')&&UUID.test(v.producingVersionId||'')
 &&DIGEST.test(v.shareDigest||'')&&typeof v.excerpt==='string'&&!!v.excerpt.trim()&&v.excerpt.length<=2000&&v.referenceOnly===true
 &&UUID.test(v.evidence?.evidenceId||'')&&DIGEST.test(v.evidence?.sha256||'')&&Number.isSafeInteger(v.evidence.sizeBytes)&&v.evidence.sizeBytes>=33&&v.evidence.sizeBytes<=2097152
 &&Number.isInteger(v.evidence.width)&&v.evidence.width>0&&v.evidence.width<=2560&&Number.isInteger(v.evidence.height)&&v.evidence.height>0&&v.evidence.height<=2560
 &&v.evidence.mediaType==='image/png'&&Number.isFinite(Date.parse(v.expiresAt));}
export async function contributionRequest(body:Record<string,unknown>,key?:string){
 const r=body.action==='list'?await fetch(`/api/agent-training/customer-contributions?slug=${encodeURIComponent(String(body.slug))}`,{cache:'no-store'}):await fetch('/api/agent-training/customer-contributions',{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json',...(key?{'Idempotency-Key':key}:{})},body:JSON.stringify(body)});
 const value=await r.json();if(!r.ok||value?.ok!==true)throw Error(value?.reason==='contribution_withdrawn'?'This shared example has been withdrawn.':value?.reason==='contribution_already_prepared'?'This example already has a teaching suggestion. Review saved training.':'This action could not be confirmed. Your feedback is still saved.');return value;
}
