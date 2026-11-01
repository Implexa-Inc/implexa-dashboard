/** Temporary presentation fixtures. These IDs never enter acquisition, billing or execution. */
export type MarketplaceSample={slug:string;name:string;category:string;input:string;outcome:string;tasteVariants:number;runCount:number;deliveryRate:number;supportedEngines:('Claude'|'Codex')[];averageGrade:number;monthlyUsd:number;trial:string;owner:{handle:string;agentCount:number;averageGrade:number};artwork:'video'|'marketing';sampleOnly:true};
export type SampleRead={status:'ready';listings:MarketplaceSample[]}|{status:'unavailable';listings:[]};
const whole=(v:unknown,min:number,max:number)=>Number.isSafeInteger(v)&&(v as number)>=min&&(v as number)<=max;
const text=(v:unknown,max=400)=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
export function parseMarketplaceSample(row:any):MarketplaceSample|null{
 const x=row?.listing;
 if(!/^beta-[a-z0-9-]+$/.test(row?.slug||'')||!x||x.sampleOnly!==true||!['video','marketing'].includes(x.artwork)
  ||!['name','category','input','outcome','trial'].every(k=>text(x[k]))||!whole(x.tasteVariants,1,100)||!whole(x.runCount,0,10000000)
  ||!whole(x.deliveryRate,0,100)||!whole(x.averageGrade,0,100)||!whole(x.monthlyUsd,1,10000)
  ||!Array.isArray(x.supportedEngines)||x.supportedEngines.length<1||x.supportedEngines.length>2||new Set(x.supportedEngines).size!==x.supportedEngines.length||x.supportedEngines.some((e:unknown)=>e!=='Claude'&&e!=='Codex')
  ||!text(x.owner?.handle,60)||!whole(x.owner?.agentCount,1,10000)||!whole(x.owner?.averageGrade,0,100))return null;
 return {slug:row.slug,sampleOnly:true,name:x.name,category:x.category,input:x.input,outcome:x.outcome,tasteVariants:x.tasteVariants,runCount:x.runCount,deliveryRate:x.deliveryRate,supportedEngines:x.supportedEngines,averageGrade:x.averageGrade,monthlyUsd:x.monthlyUsd,trial:x.trial,owner:{handle:x.owner.handle,agentCount:x.owner.agentCount,averageGrade:x.owner.averageGrade},artwork:x.artwork};
}
export async function readMarketplaceSamples(load:()=>PromiseLike<{data:unknown;error:unknown}>):Promise<SampleRead>{
 try{const {data,error}=await load();if(error||!Array.isArray(data))return {status:'unavailable',listings:[]};const listings=data.map(parseMarketplaceSample);return listings.some(x=>!x)?{status:'unavailable',listings:[]}:{status:'ready',listings:listings as MarketplaceSample[]};}
 catch{return {status:'unavailable',listings:[]};}
}
export type AgentHomeTab='rent'|'running'|'training';
export function agentHomeTab(tab?:string):AgentHomeTab{return tab==='running'||tab==='training'?tab:'rent';}

export const marketplacePilotEnabled=(read:SampleRead)=>read.status==='ready'&&read.listings.length>0;
