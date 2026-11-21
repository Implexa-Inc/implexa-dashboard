'use client';
import { createContext, useContext, useEffect, useState, type ReactNode, type Dispatch, type SetStateAction } from 'react';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import LocalTime from '../../_components/local-time';
import type { NeedsYou } from '@/lib/needs-you';
import type { ReviewQueue } from '@/lib/review';
import type { WorkView } from '@/lib/navigation';
import RunningAgents, { type LiveWorkRow } from '../../_components/running-agents';
import WorkItemRow from '../../_components/work-item-row';
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
  const [revision,setRevision]=useState(0);
  const judgeIds=new Set(needs.homeAttention.flatMap(item=>item.runId?[item.runId]:[]));
  const reviews=queue.items.filter(item=>!judgeIds.has(item.rootRunId)&&!judgeIds.has(item.latestRunId));
  const reviewedIds=new Set(reviews.flatMap(item=>[item.rootRunId,item.latestRunId]));
  const approvals=reviews.filter(item=>item.reason==='approval'||item.holdKind==='approval_before_action');
  const results=reviews.filter(item=>!approvals.includes(item));
  const setupCount=needs.needGrant.length+needs.signIns.length+needs.missed.length+needs.homeAttention.length;
  const renderReview=(item:ReviewQueue['items'][number], live?:LiveWorkRow)=><div key={item.rootRunId}><WorkItemRow
    title={(item.slug&&names[item.slug])||item.slug||'Agent result'} href={`/review/${encodeURIComponent(item.latestRunId)}`}
    detail={<>{reviewDetails[item.rootRunId]}{item.judgeVerdict ? ` · Judge: ${item.judgeVerdict}` : ''}</>}
    state={approvals.includes(item)?'Needs approval':'Ready for review'}
    when={item.latestAt ? <LocalTime iso={item.latestAt}/> : null}
    actions={<><Link href={`/review/${encodeURIComponent(item.latestRunId)}`} className="btn-outline work-row-action">{approvals.includes(item)?'Review & approve':'Review result'}</Link>{live?.actions}</>}/>{live?.details}</div>;
  return <RunningAgents bare onFinished={()=>setRevision(value=>value+1)} renderList={(rows,status)=>{
    // Prefer the source-specific Judge dialog and review destination for the same immutable run.
    const byRun=new Map(rows.filter(item=>item.runId).map(item=>[item.runId!,item]));
    const live=rows.filter(item=>!item.runId||!judgeIds.has(item.runId)&&!reviewedIds.has(item.runId));
    const urgent=live.filter(item=>item.needsYou);
    const ready=live.filter(item=>!item.needsYou&&item.status==='built');
    const running=live.filter(item=>!item.needsYou&&item.status!=='finished'&&item.status!=='built');
    const knownLive=status==='ready';
    const needsComplete=!loadingNeeds&&!loadingReview&&!needs.partial&&!needs.truncated&&knownLive&&!warning;
    const needsCount=setupCount+approvals.length+urgent.length;
    const reviewCount=results.length+ready.length;
    const activeCount=needsCount+reviewCount+running.length;
    const counts={
      needs:{count:needsCount,complete:needsComplete},
      review:{count:reviewCount,complete:!loadingReview&&!warning&&knownLive},
      running:{count:running.length,complete:knownLive},
      activity:{count:activeCount,complete:needsComplete},
    };
    const showNeeds=view==='activity'||view==='needs',showReview=view==='activity'||view==='review',showRunning=view==='activity'||view==='running';
    const visibleCount=view==='needs'?needsCount:view==='review'?reviewCount:view==='running'?running.length:activeCount;
    return <>
      <WorkFilterTabs current={view} counts={counts}/>
      {(status==='loading'||loadingNeeds||loadingReview)&&<p role="status" className="work-list-notice">{status==='loading'?'Checking active runs…':loadingNeeds&&loadingReview?'Checking actions and reviews…':loadingNeeds?'Checking actions…':'Checking reviews…'}</p>}
      {(status==='unavailable'||(!loadingNeeds&&(needs.partial||needs.truncated))||warning)&&<div role="status" className="work-read-warning">
        <svg aria-hidden="true"><use href="/brand/tukido-icons.svg#alert"/></svg>
        <div><strong>Some work couldn’t be checked.</strong><p>{status==='unavailable'?'Live status is unavailable. ':''}{!loadingNeeds&&(needs.partial||needs.truncated)?'Some actions may be missing. ':''}{warning?'The review queue is incomplete. ':''}Known work stays visible.</p></div>
        <button type="button" className="btn-outline work-row-action" onClick={()=>router.refresh()}>Try again</button>
      </div>}
      {view==='delivered' ? delivered : <>
        {visibleCount>0&&<div className="work-rows" aria-label="Work items">
          {showNeeds&&<>
            {needs.homeAttention.map(item=><JudgeReviewCard key={item.attentionId} item={item} workRow extraActions={item.runId?byRun.get(item.runId)?.actions:undefined} extraDetails={item.runId?byRun.get(item.runId)?.details:undefined}/>)}
            {needs.needGrant.map(item=><WorkItemRow key={`grant:${item.slug}`} title={item.name} detail={item.reason} state="Needs approval" actions={<Link href={`/workflows/${encodeURIComponent(item.slug)}/activate`} className="btn-outline work-row-action">Grant access</Link>}/>)}
            {needs.signIns.map(item=><WorkItemRow key={`signin:${item.domain}`} title={`${item.label||item.domain} needs a sign-in`} detail={`${item.who} ${item.count===1?'needs':'need'} this account. Sign in on the agent’s setup.`} state="Needs input" actions={<Link href={`/workflows/${encodeURIComponent(item.fixSlug)}/activate`} className="btn-primary work-row-action">Sign in</Link>}/>)}
            {needs.missed.map(item=><WorkItemRow key={`schedule:${item.id}`} title={item.name} detail={<>{item.neverArmed?`Scheduled for ${item.when}, but not started yet.`:item.failed?'Its schedule failed. Fix it to try again.':`Missed its schedule (${item.when}).`} <Link href={`/workflows/${encodeURIComponent(item.slug)}`} className="underline">Agent details</Link></>} state="Needs input" actions={<FixNowButton slug={item.slug} name={item.name} claudeTaskId={item.claudeTaskId} neverArmed={item.neverArmed}/>}/>)}
            {urgent.map(item=>item.node)}
            {approvals.map(item=>renderReview(item,byRun.get(item.latestRunId)||byRun.get(item.rootRunId)))}
          </>}
          {showReview&&<>{results.map(item=>renderReview(item,byRun.get(item.latestRunId)||byRun.get(item.rootRunId)))}{ready.map(item=>item.node)}</>}
          {showRunning&&running.map(item=>item.node)}
        </div>}
        {visibleCount===0&&knownLive&&!loadingNeeds&&!loadingReview&&!warning&&!needs.partial&&!needs.truncated&&<div className="work-empty"><h2>{view==='needs'?'Nothing needs you right now':view==='review'?'Nothing is waiting for review':view==='running'?'No work running right now':'No active agent runs right now'}</h2><p>{view==='needs'?'Anything that needs a decision will appear here.':'Start a run from one of your agents. Its progress will appear here.'}</p><Link href="/workflows" className="btn-outline">Go to agents</Link></div>}
      </>}
      {view==='review'&&<div className="mt-4 text-right"><Link href="/review/new" className="text-sm underline">New review</Link></div>}
      {view==='activity'&&<CompletedRunResults revision={revision}/>}
      {productions}
      <div className="work-history-link"><Link href="/runs">Full run history →</Link></div>
    </>;
  }}/>;
}
