'use client';
import { createContext, useContext, useEffect, useState, type ReactNode, type Dispatch, type SetStateAction } from 'react';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import LocalTime from '../../_components/local-time';
import {WorkAttentionSync,useWorkAttentionBadge} from '../../_components/sidebar';
import {humanize} from '@/lib/inbox-items';
import type { NeedsYou } from '@/lib/needs-you';
import type { ReviewQueue } from '@/lib/review';
import {mergeWorkCount,type WorkView} from '@/lib/navigation';
import RunningAgents, { type LiveWorkRow } from '../../_components/running-agents';
import WorkItemRow,{WorkDisplayNames} from '../../_components/work-item-row';
import JudgeReviewCard from '../../_components/judge-review-dialog';
import FixNowButton from '../../_components/fix-now-button';
import CompletedRunResults from '../../_components/completed-run-results';
import WorkFilterTabs from './work-filter-tabs';

export type WorkReviewData={queue:ReviewQueue;names:Record<string,string>;reviewDetails:Record<string,string>;warning:string|null};
type SourceState={needs:NeedsYou|null;review:WorkReviewData|null};
type WorkSourceData={kind:'needs';value:NeedsYou}|{kind:'review';value:WorkReviewData};
const SourceContext=createContext<Dispatch<SetStateAction<SourceState>>|null>(null);
const unreadNeeds:NeedsYou={needGrant:[],missed:[],signIns:[],stalled:[],attentionItems:[],homeAttention:[],pendingReviews:0,homeCount:0,total:0,partial:true,truncated:false,unavailableSources:[]};
const unreadQueue:ReviewQueue={items:[],truncated:false,total:null,visibleCount:0,sources:{},live:false};

/** Server sources stream independently into this list. This is presentation state, not another data reader. */
export function WorkSource({data}:{data:WorkSourceData}){
  const update=useContext(SourceContext);
  useEffect(()=>{update?.(previous=>({...previous,[data.kind]:data.value}));},[data,update]);
  return null;
}
export default function WorkFeed({view,children,delivered,productions}:{view:WorkView;children:ReactNode;delivered?:ReactNode;productions?:ReactNode}){
  const [sources,setSources]=useState<SourceState>({needs:null,review:null});
  return <SourceContext.Provider value={setSources}>{children}<WorkList view={view}
    needs={sources.needs??unreadNeeds} queue={sources.review?.queue??unreadQueue}
    names={sources.review?.names??{}} reviewDetails={sources.review?.reviewDetails??{}} warning={sources.review?.warning??null}
    loadingNeeds={sources.needs===null} loadingReview={sources.review===null}
    delivered={delivered} productions={productions}/></SourceContext.Provider>;
}

/** One list over the existing readers; RunningAgents remains the only live poller. */
export function WorkList({view,needs,queue,names,reviewDetails,warning,delivered,productions,loadingNeeds=false,loadingReview=false}:{
  view:WorkView;needs:NeedsYou;queue:ReviewQueue;names:Record<string,string>;reviewDetails:Record<string,string>;warning:string|null;
  delivered?:ReactNode;productions?:ReactNode;loadingNeeds?:boolean;loadingReview?:boolean;
}){
  const router=useRouter();
  const retainedWork=useWorkAttentionBadge();
  const [revision,setRevision]=useState(0);
  const judgeIds=new Set(needs.homeAttention.flatMap(item=>item.runId?[item.runId]:[]));
  const reviews=queue.items.filter(item=>!judgeIds.has(item.rootRunId)&&!judgeIds.has(item.latestRunId));
  const reviewedIds=new Set(reviews.flatMap(item=>[item.rootRunId,item.latestRunId]));
  const approvals=reviews.filter(item=>item.reason==='approval'||item.holdKind==='approval_before_action');
  const results=reviews.filter(item=>!approvals.includes(item));
  const renderReview=(item:ReviewQueue['items'][number], live?:LiveWorkRow)=><div key={item.rootRunId}><WorkItemRow agentSlug={item.slug||undefined}
    title={(item.slug&&names[item.slug])||(item.slug?humanize(item.slug):'Agent result')} href={`/review/${encodeURIComponent(item.latestRunId)}`}
    detail={<>{reviewDetails[item.rootRunId]}{item.judgeVerdict ? ` · Judge: ${item.judgeVerdict}` : ''}</>}
    state={approvals.includes(item)?'Needs approval':'Ready for review'}
    when={item.latestAt ? <LocalTime iso={item.latestAt}/> : null}
    actions={<><Link href={`/review/${encodeURIComponent(item.latestRunId)}`} className="btn-outline work-row-action">{approvals.includes(item)?'Review & approve':'Review result'}</Link>{live?.actions}</>}/>{live?.details}</div>;
  const displayNames={...names,...needs.agentNames};
  return <WorkDisplayNames names={displayNames}><RunningAgents bare agentNames={displayNames} onFinished={()=>setRevision(value=>value+1)} renderList={(rows,status)=>{
    // Prefer the source-specific Judge dialog and review destination for the same immutable run.
    const byRun=new Map(rows.filter(item=>item.runId).map(item=>[item.runId!,item]));
    const live=rows.filter(item=>!item.runId||!judgeIds.has(item.runId)&&!reviewedIds.has(item.runId));
    const urgent=live.filter(item=>item.needsYou);
    const ready=live.filter(item=>!item.needsYou&&item.status==='built');
    const running=live.filter(item=>!item.needsYou&&item.status!=='finished'&&item.status!=='built');
    const knownLive=status==='ready';
    const needsComplete=!loadingNeeds&&!loadingReview&&!needs.partial&&!needs.truncated&&knownLive&&!warning;
    const stalled=needs.stalled.filter(item=>!judgeIds.has(item.id)&&!reviewedIds.has(item.id)&&!byRun.has(item.id));
    type DatedRow={key:string;at:string|null|undefined;node:ReactNode};
    const dated=(key:string,at:string|null|undefined,node:ReactNode):DatedRow=>({key,at,node});
    const newest=(items:DatedRow[])=>items.sort((a,b)=>(Date.parse(b.at||'')||0)-(Date.parse(a.at||'')||0));
    const needRows=newest([
      ...needs.homeAttention.map(item=>dated(`judge:${item.attentionId}`,item.createdAt,<JudgeReviewCard item={item} workRow extraActions={item.runId?byRun.get(item.runId)?.actions:undefined} extraDetails={item.runId?byRun.get(item.runId)?.details:undefined}/>)),
      ...needs.needGrant.map(item=>dated(`grant:${item.slug}`,null,<WorkItemRow agentSlug={item.slug} title={item.name===item.slug?humanize(item.slug):item.name} detail="Approve the access this agent needs before it can run." state="Needs approval" actions={<Link href={`/workflows/${encodeURIComponent(item.slug)}/activate`} className="btn-outline work-row-action">Grant access</Link>}/>)),
      ...needs.signIns.map(item=>dated(`signin:${item.domain}`,null,<WorkItemRow title={`${item.label||item.domain} needs a sign-in`} detail={`${item.who} ${item.count===1?'needs':'need'} this account. Sign in on the agent’s setup.`} state="Needs input" actions={<Link href={`/workflows/${encodeURIComponent(item.fixSlug)}/activate`} className="btn-outline work-row-action">Sign in to {item.label||item.domain}</Link>}/>)),
      ...needs.missed.map(item=>dated(`schedule:${item.id}`,null,<WorkItemRow agentSlug={item.slug} title={item.name===item.slug?humanize(item.slug):item.name} detail={item.neverArmed?`Scheduled for ${item.when}, but not started yet.`:item.failed?'Its schedule failed. Fix it to try again.':`Missed its schedule (${item.when}).`} state="Needs input" actions={<FixNowButton slug={item.slug} name={item.name} claudeTaskId={item.claudeTaskId} neverArmed={item.neverArmed}/>}/>)),
      ...stalled.map(item=>dated(`stalled:${item.id}`,item.at,<WorkItemRow agentSlug={item.slug} title={item.name===item.slug?humanize(item.slug):item.name} detail="Progress stopped. Open the run to check what happened." href={`/runs/${encodeURIComponent(item.id)}`} state="Needs input" when={item.at?<LocalTime iso={item.at}/>:null} actions={<Link href={`/runs/${encodeURIComponent(item.id)}`} className="btn-outline work-row-action">Check run</Link>}/>)),
      ...urgent.map(item=>dated(item.key,item.at,item.node)),
      ...approvals.map(item=>dated(`review:${item.rootRunId}`,item.latestAt,renderReview(item,byRun.get(item.latestRunId)||byRun.get(item.rootRunId)))),
    ]);
    const reviewRows=newest([...results.map(item=>dated(item.rootRunId,item.latestAt,renderReview(item,byRun.get(item.latestRunId)||byRun.get(item.rootRunId)))),...ready.map(item=>dated(item.key,item.at,item.node))]);
    const needsCount=needRows.length;
    const reviewCount=reviewRows.length;
    const activeCount=needsCount+reviewCount+running.length;
    const sourceNeeds={count:needsCount,complete:needsComplete};
    const boundedNeeds=mergeWorkCount(retainedWork,sourceNeeds)!;
    const counts={
      needs:boundedNeeds,
      review:{count:reviewCount,complete:!loadingReview&&!warning&&knownLive},
      running:{count:running.length,complete:knownLive},
      activity:{count:needsComplete?activeCount:Math.max(activeCount,boundedNeeds.count),complete:needsComplete},
    };
    const showNeeds=view==='activity'||view==='needs',showReview=view==='activity'||view==='review',showRunning=view==='activity'||view==='running';
    const viewKnown=view==='running'?knownLive:view==='review'?knownLive&&!loadingReview&&!warning:needsComplete;
    const visibleCount=view==='needs'?needsCount:view==='review'?reviewCount:view==='running'?running.length:activeCount;
    return <>
      <WorkAttentionSync badge={status!=='loading'||!loadingNeeds||!loadingReview?sourceNeeds:undefined}/>
      <WorkFilterTabs current={view} counts={counts}/>
      {(status==='loading'||loadingNeeds||loadingReview)&&<p role="status" className="work-list-notice">{status==='loading'?'Checking active runs…':loadingNeeds&&loadingReview?'Checking actions and reviews…':loadingNeeds?'Checking actions…':'Checking reviews…'}</p>}
      {(status==='unavailable'||(!loadingNeeds&&(needs.partial||needs.truncated))||warning)&&<div role="status" className="work-read-warning">
        <svg aria-hidden="true"><use href="/brand/tukido-icons.svg#alert"/></svg>
        <div><strong>Some work couldn’t be checked.</strong><p>{status==='unavailable'?'Live status is unavailable. ':''}{!loadingNeeds&&(needs.partial||needs.truncated)?'Some actions may be missing. ':''}{warning?'The review queue is incomplete. ':''}Known work stays visible.</p></div>
        <button type="button" className="btn-outline work-row-action" onClick={()=>router.refresh()}>Try again</button>
      </div>}
      {view==='delivered' ? delivered : <>
        {visibleCount>0&&<div className="work-rows" aria-label="Work items">
          {showNeeds&&needRows.map(item=><div key={item.key}>{item.node}</div>)}
          {showReview&&reviewRows.map(item=><div key={item.key}>{item.node}</div>)}
          {showRunning&&newest(running.map(item=>dated(item.key,item.at,item.node))).map(item=>item.node)}
        </div>}
        {visibleCount===0&&viewKnown&&<div className="work-empty"><h2>{view==='needs'?'Nothing needs you right now':view==='review'?'Nothing is waiting for review':view==='running'?'No work running right now':'No active agent runs right now'}</h2><p>{view==='needs'?'Anything that needs a decision will appear here.':'Start a run from one of your agents. Its progress will appear here.'}</p><Link href="/workflows" className="btn-outline">Go to agents</Link></div>}
      </>}
      {view==='review'&&<div className="mt-4 text-right"><Link href="/review/new" className="text-sm underline">New review</Link></div>}
      {view==='activity'&&<CompletedRunResults revision={revision} names={displayNames}/>}
      {productions}
      <div className="work-history-link"><Link href="/runs">Full run history →</Link></div>
    </>;
  }}/></WorkDisplayNames>;
}
