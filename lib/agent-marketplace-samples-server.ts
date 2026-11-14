import {cache} from 'react';
import {createClient} from '@/lib/supabase/server';
import {readMarketplaceSamples} from './agent-marketplace-samples';
import {parseApprovedListings,type ApprovedRead} from './approved-marketplace-listings';

// Request-scoped only: layout and page share one ordinary caller/RLS read.
// React cache does not persist a viewer's listings across requests/accounts.
export const getMarketplaceSamples = cache(async () => {
  const supabase = createClient();
  return readMarketplaceSamples(() => supabase.from('agent_marketplace_samples')
    .select('slug,position,listing').order('position').limit(2)
    .abortSignal(AbortSignal.timeout(2000)));
});

// Only the rent page loads real listings. Failed qualification is not empty.
export async function getApprovedMarketplaceListings(jwt:string):Promise<ApprovedRead>{
 try{
  const base=(process.env.NEXT_PUBLIC_IMPLEXA_API_URL||'https://core.implexa.ai').replace(/\/$/,'');
  const r=await fetch(`${base}/api/v2/agent-training/marketplace-listings`,{headers:{authorization:`Bearer ${jwt}`},cache:'no-store',signal:AbortSignal.timeout(12000)});
  return r.ok?parseApprovedListings(await r.json()):{status:'unavailable',listings:[]};
 }catch{return {status:'unavailable',listings:[]};}
}
