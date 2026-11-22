import {createClient} from '@/lib/supabase/server';
import {readMyWorkflows,listDismissedWorkflows,listFavoriteSlugs} from '@/lib/workflow-catalog';
import {getMyAgents} from '@/lib/agents-home';
import {buildRoster} from '@/lib/agents-roster';
import {categorizeAgent} from '@/lib/agent-category';
import AgentsList from './agents-list';
import RetryButton from './retry-button';
import {CollectionReadError} from './collection-state';

/** One request-local roster promise supplies both the count and the list. */
export async function loadInstalledRoster(jwt:string){
 const supabase=createClient();
 const [feed,library,dismissed,favorites,paused]=await Promise.all([
  getMyAgents({getToken:async()=>jwt}),readMyWorkflows(jwt),listDismissedWorkflows(),listFavoriteSlugs(),
  supabase.from('scheduled_skills').select('skill_slug,status,trigger_type').eq('status','paused').eq('trigger_type','cron').abortSignal(AbortSignal.timeout(8000)),
 ]);
 const roster=buildRoster({feed,mine:library.status==='ready'?library.workflows:[],paused:paused.data??[],categorize:categorizeAgent});
 return {...roster,feed,library,dismissed,favorites,complete:roster.feedReady&&library.status==='ready'&&!library.unavailableEntries&&!paused.error};
}
export type InstalledRoster=Awaited<ReturnType<typeof loadInstalledRoster>>;
export async function InstalledAgentCount({load}:{load:Promise<InstalledRoster>}){
 const data=await load;
 return <span className="work-filter-count" aria-label={data.complete?`${data.agents.length} agents`:'Agent count incomplete'}>{data.feedReady?`${data.agents.length}${data.complete?'':'+'}`:'?'}</span>;
}
export default async function InstalledAgents({load}:{load:Promise<InstalledRoster>}){
 const data=await load;const favorites=new Set(data.favorites);
 return <>
  {!data.feedReady?<CollectionReadError title="Couldn’t load your agents" description="Your agents and schedules are unchanged. This page couldn’t reach Tukido."/>:!data.complete&&<div role="status" className="mb-6 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-secondary text-state-needs"><p>Some agent details couldn’t be loaded. Your agents and schedules are unchanged.</p><RetryButton/></div>}
  <AgentsList agents={data.agents.map(a=>({...a,favorite:favorites.has(a.slug)}))} archived={data.dismissed.map(a=>({slug:a.slug,name:a.name,source:a.source,isLive:a.isLive}))} rosterKnown={data.complete}/>
 </>;
}
