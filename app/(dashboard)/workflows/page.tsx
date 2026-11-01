/**
 * /workflows — your agents, in ONE mental model.
 *
 * Three sections (Scheduled, On-demand, Not activated), one row shape, a
 * category filter. Built by merging two owner-scoped sources server-side:
 *   - getMyAgents (the /me/agents feed): everything with an activation row —
 *     active (scheduled / on-demand) and mid-activation.
 *   - listMyWorkflows (the user's library): catches agents BUILT but never
 *     activated (no scheduled_skills row), and enriches every row with the
 *     description used for categorization + the correct ?source for its link.
 * The merged, normalized array is handed to <AgentsList /> which renders + the
 * client-side category filter. No more two-list / two-link-target confusion.
 */

import InstalledAgents from '../_components/installed-agents';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { readUserProfile } from '@/lib/profile-read';
import {RentBuildHome} from '../_components/agent-home-frame';
import TalkToImplexa from '../_components/talk-to-implexa';
import BuildingAgents from '../_components/building-agents';
import {isExecutorConnected} from '@/lib/connection';
import {getMarketplaceSamples} from '@/lib/agent-marketplace-samples-server';
import MarketplaceSampleGallery from '../_components/marketplace-sample-gallery';
import {agentHomeView} from '@/lib/agent-marketplace-samples';

export const dynamic = 'force-dynamic';

export default async function WorkflowsPage({searchParams}:{searchParams?:{tab?:string}}) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) redirect('/login');
  const profile = await readUserProfile(supabase
    .from('users').select('id, organization_id, last_mcp_call_at, last_hook_event_at').eq('id', session.user.id));
  if (!profile?.organization_id) redirect('/onboarding');

  const samples=await getMarketplaceSamples();
  const view=agentHomeView(samples,searchParams?.tab),pilot=view!=='ordinary';
  if(view==='running') redirect('/work?view=activity');
  if(view==='training') redirect('/training');
  if(view==='rent'){
    const connected=await isExecutorConnected(supabase,profile.id,{
      lastMcpCallAt:profile.last_mcp_call_at,lastHookEventAt:profile.last_hook_event_at,
    });
    return <RentBuildHome build={<TalkToImplexa hasAgents compact suggestions={[]} connected={connected}/>} status={<BuildingAgents/>}>
      <MarketplaceSampleGallery listings={samples.listings}/>
    </RentBuildHome>;
  }

  return <InstalledAgents jwt={session.access_token} pilot={pilot}/>;
}
