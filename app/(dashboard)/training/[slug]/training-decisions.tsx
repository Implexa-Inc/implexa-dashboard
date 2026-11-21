'use client';
import type {ReactNode} from 'react';
import type {CoachAgent,CoachDecision} from '@/lib/training-coach';
import {coachingCount} from '@/lib/training-coach';
import {teachingCaption} from './training-changes';
import type {GuidedTrainingChanges} from '@/lib/guided-training-changes';
import type {QuestionsPage} from '@/lib/trainer-questions';
import {trainingPropertyLabel} from '@/lib/training-local-ingress';

export function decisionPresentation(item:CoachDecision,changes:GuidedTrainingChanges|null,questions:QuestionsPage|null){
 const lesson=changes?.records.find(r=>r.recordId===item.id&&r.recordDigest===item.digest);
 const question=questions?.items.find(q=>q.id===item.id&&q.receiptDigest===item.digest);
 return item.kind==='lesson'?{source:'From your teaching',title:lesson?teachingCaption(lesson.summary):'Review a saved learning',reason:'Choose whether this lesson should guide your next run.'}:
 item.kind==='feedback'?{source:'From your result',title:'Turn your marked feedback into a lesson',reason:'You marked this feedback for training.'}:
 item.kind==='question'?{source:'From the agent',title:question?trainingPropertyLabel(question.property):'An approach needs your guidance',reason:'Choose how your agent should handle this decision.'}:
 item.kind==='customer'?{source:'From a customer',title:'A suggestion for future runs',reason:'Review general guidance. Customer material stays private.'}:
 {source:'Proposed agent change',title:'Review a change to steps or tools',reason:'An agent change needs your approval.'};
}
export default function TrainingDecisions({agent,loading,error,changes,questions,onReview,onRetry}:{agent:CoachAgent|null;loading:boolean;error:boolean;changes:GuidedTrainingChanges|null;questions:QuestionsPage|null;onReview:(item:CoachDecision,all?:boolean)=>void;onRetry:()=>void}){
 return <section className="training-decisions" aria-labelledby="training-decisions-heading">
  <header className="training-section-heading"><div><h2 id="training-decisions-heading">Needs your decision {agent&&<span>{coachingCount(agent.decisions.length,agent.decisionsComplete)}</span>}</h2><p>You decide what your agent learns.</p></div>{!!agent?.decisions.length&&<button type="button" className="btn-secondary" onClick={()=>onReview(agent.decisions[0],true)}>Review all {coachingCount(agent.decisions.length,agent.decisionsComplete)}</button>}</header>
  {loading&&!agent?<p role="status" className="training-empty">Checking for suggestions… You can keep teaching.</p>:error?<div role="status" className="training-empty">Suggestions couldn’t load. <button type="button" className="underline" onClick={onRetry}>Try again</button></div>:agent?.decisions.length?<ol className="training-decision-list">{agent.decisions.map(item=>{const p=decisionPresentation(item,changes,questions);return <li key={item.id}><article className="training-decision-card"><div className="training-decision-symbol" aria-hidden="true">{item.kind==='agent_change'?'↗':item.kind==='question'?'?':'✦'}</div><div><p className="training-decision-origin"><span>{p.source}</span><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'UTC'})}</time></p><h3>{p.title}</h3><p className="training-decision-reason">{p.reason}</p></div><button type="button" className="btn-outline" onClick={()=>onReview(item)}>Review</button></article></li>;})}</ol>:agent&&!agent.decisionsComplete?<div role="status" className="training-empty">No suggestions loaded yet. Some training could not be checked. <button type="button" className="underline" onClick={onRetry}>Refresh suggestions</button></div>:<p className="training-empty">Nothing is waiting for you. New suggestions show up here.</p>}
  {agent&&!agent.decisionsComplete&&<p className="training-read-note">+ means there may be more. Refresh after reviewing these suggestions.</p>}
 </section>;
}
export function TrainingSection({title,children}:{title:string;children:ReactNode}){return <section className="training-teach-section"><h2>{title}</h2>{children}</section>;}
