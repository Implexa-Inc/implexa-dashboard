import {Suspense} from 'react';
import InstalledAgents,{loadInstalledRoster,InstalledAgentCount} from '../_components/installed-agents';
import { redirect } from 'next/navigation';
import { dashboardAccount } from '@/lib/dashboard-account';
import AgentHomeFrame from '../_components/agent-home-frame';
import {getMarketplaceSamples,getApprovedMarketplaceListings} from '@/lib/agent-marketplace-samples-server';
import MarketplaceSampleGallery from '../_components/marketplace-sample-gallery';
import {listAgentDiscovery} from '@/lib/agent-discovery';
import {agentHomeView} from '@/lib/agent-marketplace-samples';
import {readMyWorkflows} from '@/lib/workflow-catalog';
import CoachOwnership from '../_components/coach-ownership';

export const dynamic = 'force-dynamic';

export default async function WorkflowsPage({searchParams}:{searchParams?:{tab?:string}}) {
  const { session, profile } = await dashboardAccount();
  if (!session?.user) redirect('/login');
  if (!profile?.organization_id) redirect('/onboarding');

  const view=agentHomeView(searchParams?.tab);
  if(view==='running') redirect('/work?view=activity');
  if(view==='training') redirect('/training');
  const owned = readMyWorkflows(session.access_token);
  const navigation = <Suspense fallback={null}><CoachOwnership owned={owned}/></Suspense>;
  if(view==='rent')return <AgentHomeFrame key={session.user.id} selected="find">{navigation}<Suspense fallback={<p role="status" className="mt-6">Loading trained agents…</p>}><FindAgents jwt={session.access_token}/></Suspense></AgentHomeFrame>;
  const load=loadInstalledRoster(session.access_token, owned);
  return <AgentHomeFrame key={session.user.id} count={<Suspense fallback={<span className="work-filter-count">…</span>}><InstalledAgentCount load={load}/></Suspense>}>{navigation}<Suspense fallback={<p role="status" className="mt-6">Loading your agents…</p>}><InstalledAgents load={load}/></Suspense></AgentHomeFrame>;
}
async function FindAgents({jwt}:{jwt:string}){
 const [samples,approved,discovery]=await Promise.all([getMarketplaceSamples(),getApprovedMarketplaceListings(jwt),listAgentDiscovery(jwt)]);
 return <><MarketplaceSampleGallery listings={samples.listings} approved={approved} discovery={discovery}/></>;
}
