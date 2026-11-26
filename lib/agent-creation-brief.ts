export type PlaybookPlan={steps:string[];operations?:string[];runInputs?:Array<{key:string;label:string;collection:'start'|'after_review';kind:string}>;reviewAfterStep?:number;sources:Array<{name:string;purpose:string;domain:string;routes:string[]}>;checks:string[]};
export type CreationBrief={name:string;goal:string;inputs:string[];outputs:string[];plan?:PlaybookPlan;tools:Array<{name:string;requirement:'required'|'preferred'}>};
export type CreationDraftBinding={draftId:string;replyId:string;replyDigest:string};
export type CreationTurn={turnId:string;message:string;mode?:'playbook';baseReplyId:string|null;baseDraftId?:string|null;createdAt:string;status:'pending'|'answered'|'failed';
 replyId:string|null;replyDigest:string|null;reply:string|null;brief:CreationBrief|null;trainingNotes:string[];questions:string[];answerOptions?:string[];
 buildIntent:string|null;toolPreferences:string[];tools:Array<{name:string;requirement:'required'|'preferred';supported:boolean;purpose?:string;method?:string;routes?:string[]}>;model:string|null;reason:string|null};
export type CreationDraftRead={ok:true;contractVersion:'agent-creation-brief.v1';draftId:string;turns:CreationTurn[];totalTurns:number;buildRequestId:string|null;buildCanRetry?:boolean;withdrawn?:boolean;recentDrafts?:Array<{draft_id:string;updated_at:string;withdrawn:boolean}>};
const id=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const text=(v:unknown,n:number):v is string=>typeof v==='string'&&v.length<=n;
const strings=(v:unknown,n:number):v is string[]=>Array.isArray(v)&&v.every(x=>text(x,n));
export function isCreationBrief(v:any):v is CreationBrief{return !!v&&typeof v==='object'&&text(v.name,80)&&text(v.goal,1200)&&strings(v.inputs,240)&&strings(v.outputs,240)
 &&(v.plan===undefined||(v.plan&&(v.plan.operations===undefined||strings(v.plan.operations,40))&&(v.plan.runInputs===undefined||(Array.isArray(v.plan.runInputs)&&v.plan.runInputs.every((f:any)=>f&&text(f.key,48)&&text(f.label,100)&&['start','after_review'].includes(f.collection))))&&strings(v.plan.steps,400)&&strings(v.plan.checks,200)&&Array.isArray(v.plan.sources)&&v.plan.sources.every((s:any)=>s&&text(s.name,60)&&text(s.purpose,160)&&text(s.domain,253)&&strings(s.routes,30))))
 &&Array.isArray(v.tools)&&v.tools.every((t:any)=>text(t.name,80)&&['required','preferred'].includes(t.requirement));}
export function isCreationDraftRead(v:any,draftId:string):v is CreationDraftRead{
 return v?.ok===true&&v.contractVersion==='agent-creation-brief.v1'&&v.draftId===draftId&&Number.isSafeInteger(v.totalTurns)&&v.totalTurns>=0
 &&(v.buildRequestId===null||id(v.buildRequestId))&&Array.isArray(v.turns)&&v.turns.every((t:any)=>id(t.turnId)&&text(t.message,t.mode==='playbook'?20000:2000)
  &&['pending','answered','failed'].includes(t.status)&&(t.brief===null||isCreationBrief(t.brief))&&strings(t.questions,300)&&(t.answerOptions===undefined||(strings(t.answerOptions,160)&&t.answerOptions.length<=3))&&strings(t.trainingNotes,400)
  &&strings(t.toolPreferences,100)&&Array.isArray(t.tools)
  &&(t.status!=='answered'||(id(t.replyId)&&typeof t.replyDigest==='string'&&/^[a-f0-9]{64}$/.test(t.replyDigest)&&text(t.reply,2000)
   &&t.model==='claude-haiku-5-5'&&(t.brief===null||(text(t.buildIntent,12000)&&t.buildIntent.trim().length>0)))));
}


/** A suggested answer sends its value as written; manual choice focuses the composer. */
export function creationQuestionChoices(answers: string[] = []) {
 const choices=answers.map((answer,index)=>{
   const value=answer.replace(/\s*\(recommended\)\s*$/i,'').trim();
   return {label:index===0 ? value+' (Recommended)' : value,value};
 });
 return [...choices,{label:'Type manually',value:''}];
}
