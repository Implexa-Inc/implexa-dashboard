import {Suspense} from 'react';
import InstalledAgents,{loadInstalledRoster,InstalledAgentCount} from '../_components/installed-agents';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { readUserProfile } from '@/lib/profile-read';
import AgentHomeFrame from '../_components/agent-home-frame';
import BuildingAgents from '../_components/building-agents';
import {getMarketplaceSamples,getApprovedMarketplaceListings} from '@/lib/agent-marketplace-samples-server';
import MarketplaceSampleGallery from '../_components/marketplace-sample-gallery';
import {listAgentDiscovery} from '@/lib/agent-discovery';
import {agentHomeView} from '@/lib/agent-marketplace-samples';

export const dynamic = 'force-dynamic';

export default async function WorkflowsPage({searchParams}:{searchParams?:{tab?:string}}) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) redirect('/login');
  const profile = await readUserProfile(supabase
    .from('users').select('id, organization_id, last_mcp_call_at, last_hook_event_at').eq('id', session.user.id));
  if (!profile?.organization_id) redirect('/onboarding');

  const view=agentHomeView(searchParams?.tab);
  if(view==='running') redirect('/work?view=activity');
  if(view==='training') redirect('/training');
  if(view==='rent')return <AgentHomeFrame key={session.user.id} selected="find"><Suspense fallback={<p role="status" className="mt-6">Loading trained agents…</p>}><FindAgents jwt={session.access_token}/></Suspense></AgentHomeFrame>;
  const load=loadInstalledRoster(session.access_token);
  return <AgentHomeFrame key={session.user.id} count={<Suspense fallback={<span className="work-filter-count">…</span>}><InstalledAgentCount load={load}/></Suspense>}><Suspense fallback={<p role="status" className="mt-6">Loading your agents…</p>}><InstalledAgents load={load}/></Suspense></AgentHomeFrame>;
}
async function FindAgents({jwt}:{jwt:string}){
 const [samples,approved,discovery]=await Promise.all([getMarketplaceSamples(),getApprovedMarketplaceListings(jwt),listAgentDiscovery(jwt)]);
 return <><BuildingAgents/><MarketplaceSampleGallery listings={samples.listings} approved={approved} discovery={discovery}/></>;
}
