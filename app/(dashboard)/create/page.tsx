import {redirect} from 'next/navigation';
import Link from 'next/link';
import {createClient} from '@/lib/supabase/server';
import {readUserProfile} from '@/lib/profile-read';
import {isExecutorConnected} from '@/lib/connection';
import GuidedAgentCreation from '../_components/guided-agent-creation';
import BuildingAgents from '../_components/building-agents';

export const dynamic='force-dynamic';
/** One saved creation conversation, shared with the Rent/Build entry. */
export default async function CreatePage({searchParams}:{searchParams?:{from?:string}}){
 const supabase=createClient();const {data:{session}}=await supabase.auth.getSession();if(!session?.user)redirect('/login');
 const profile=await readUserProfile(supabase.from('users').select('id,organization_id,last_mcp_call_at,last_hook_event_at').eq('id',session.user.id));if(!profile?.organization_id)redirect('/onboarding');
 const connected=await isExecutorConnected(supabase,session.user.id,{lastMcpCallAt:profile.last_mcp_call_at,lastHookEventAt:profile.last_hook_event_at});
 return <main className="min-h-screen px-6 py-10 lg:px-12"><div className="mx-auto max-w-6xl"><Link href={searchParams?.from==='training'?'/training':'/workflows'} className="text-xs text-ink-400 hover:text-ink-100">← Back</Link><header className="my-6"><h1 className="text-3xl font-medium tracking-tight">Build an agent</h1><p className="mt-2 text-sm text-ink-400">Start with a goal. We’ll work out the tools, inputs and outputs together.</p></header><GuidedAgentCreation key={session.user.id} ownerId={session.user.id} connected={connected}/><BuildingAgents/></div></main>;
}
