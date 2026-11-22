export type ListingSample={id:string;kind:'uploaded';name:string;mediaType:'image/jpeg'|'video/mp4';width:number;height:number;durationMs:number;provenance:'trainer_uploaded'};
export type ApprovedListing={id:string;slug:string;versionId:string;revision:number;name:string;studioName:string;category:string;input:string;output:string;servicePriceCents:number;pricePeriod:'per_run'|'per_month';engines:string[];sampleCount:number;samplePlayback:'not_hosted'|'hosted_examples';samples?:ListingSample[];cover?:ListingSample|null;billing:'not_enabled';funding:'not_activated';tools:{id:string;mode:string;maximumChargeCents:number|null;validUntil:string|null}[]};
export type ApprovedRead={status:'ready';listings:ApprovedListing[]}|{status:'unavailable';listings:[]};
export function parseApprovedListings(value:any):ApprovedRead{
 if(value?.ok!==true||!Array.isArray(value.listings))return {status:'unavailable',listings:[]};
 const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
 const text=(s:any,max:number)=>typeof s==='string'&&s.trim().length>0&&s.length<=max;
 const sample=(m:any)=>m&&uuid.test(m.id||'')&&m.kind==='uploaded'&&text(m.name,120)&&['image/jpeg','video/mp4'].includes(m.mediaType)&&[m.width,m.height].every(n=>Number.isInteger(n)&&n>=1&&n<=1280)&&Number.isInteger(m.durationMs)&&m.durationMs>=0&&m.durationMs<=60000&&m.provenance==='trainer_uploaded';
 const valid=value.listings.every((x:any)=>uuid.test(x?.id||'')&&uuid.test(x?.versionId||'')&&/^[a-z0-9][a-z0-9-]{0,199}$/.test(x.slug||'')
  &&Number.isSafeInteger(x.revision)&&x.revision>0&&text(x.name,120)&&text(x.studioName,100)&&text(x.category,80)&&text(x.input,600)&&text(x.output,600)
  &&Number.isSafeInteger(x.servicePriceCents)&&x.servicePriceCents>=0&&x.servicePriceCents<=1000000&&['per_run','per_month'].includes(x.pricePeriod)
  &&Array.isArray(x.engines)&&x.engines.every((e:any)=>['claude','codex'].includes(e))&&Number.isSafeInteger(x.sampleCount)&&x.sampleCount>=1&&x.sampleCount<=3
  &&['not_hosted','hosted_examples'].includes(x.samplePlayback)&&(x.samples===undefined||Array.isArray(x.samples)&&x.samples.length<=3&&x.samples.every(sample))&&(x.cover==null||sample(x.cover)&&x.samples?.some((m:any)=>m.id===x.cover.id))&&x.billing==='not_enabled'&&x.funding==='not_activated'&&Array.isArray(x.tools)
  &&x.tools.every((t:any)=>text(t.id,100)&&['customer_connects','included','not_offered'].includes(t.mode)
   &&(t.maximumChargeCents===null||Number.isSafeInteger(t.maximumChargeCents)&&t.maximumChargeCents>=0)
   &&(t.validUntil===null||typeof t.validUntil==='string'&&Number.isFinite(Date.parse(t.validUntil)))));
 return valid?{status:'ready',listings:value.listings}:{status:'unavailable',listings:[]};
}
