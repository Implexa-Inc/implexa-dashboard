export type CreationBrief={name:string;goal:string;inputs:string[];outputs:string[];tools:Array<{name:string;requirement:'required'|'preferred'}>};
export type CreationDraftBinding={draftId:string;replyId:string;replyDigest:string};
export type CreationTurn={turnId:string;message:string;baseReplyId:string|null;baseDraftId?:string|null;createdAt:string;status:'pending'|'answered'|'failed';
 replyId:string|null;replyDigest:string|null;reply:string|null;brief:CreationBrief|null;trainingNotes:string[];questions:string[];
 buildIntent:string|null;toolPreferences:string[];tools:Array<{name:string;requirement:'required'|'preferred';supported:boolean}>;model:string|null;reason:string|null};
export type CreationDraftRead={ok:true;contractVersion:'agent-creation-brief.v1';draftId:string;turns:CreationTurn[];totalTurns:number;buildRequestId:string|null;withdrawn?:boolean;recentDrafts?:Array<{draft_id:string;updated_at:string;withdrawn:boolean}>};
const id=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const text=(v:unknown,n:number):v is string=>typeof v==='string'&&v.length<=n;
const strings=(v:unknown,n:number):v is string[]=>Array.isArray(v)&&v.every(x=>text(x,n));
export function isCreationBrief(v:any):v is CreationBrief{return !!v&&typeof v==='object'&&text(v.name,80)&&text(v.goal,1200)&&strings(v.inputs,240)&&strings(v.outputs,240)
 &&Array.isArray(v.tools)&&v.tools.every((t:any)=>text(t.name,80)&&['required','preferred'].includes(t.requirement));}
export function isCreationDraftRead(v:any,draftId:string):v is CreationDraftRead{
 return v?.ok===true&&v.contractVersion==='agent-creation-brief.v1'&&v.draftId===draftId&&Number.isSafeInteger(v.totalTurns)&&v.totalTurns>=0
 &&(v.buildRequestId===null||id(v.buildRequestId))&&Array.isArray(v.turns)&&v.turns.every((t:any)=>id(t.turnId)&&text(t.message,2000)
  &&['pending','answered','failed'].includes(t.status)&&(t.brief===null||isCreationBrief(t.brief))&&strings(t.questions,300)&&strings(t.trainingNotes,400)
  &&strings(t.toolPreferences,100)&&Array.isArray(t.tools)
  &&(t.status!=='answered'||(id(t.replyId)&&typeof t.replyDigest==='string'&&/^[a-f0-9]{64}$/.test(t.replyDigest)&&text(t.reply,2000)
   &&t.model==='claude-haiku-5-5'&&(t.brief===null||(text(t.buildIntent,12000)&&t.buildIntent.trim().length>0)))));
}
