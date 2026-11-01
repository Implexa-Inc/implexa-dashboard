import {cache} from 'react';
import {createClient} from '@/lib/supabase/server';
import {readMarketplaceSamples} from './agent-marketplace-samples';

// Request-scoped only: layout and page share one ordinary caller/RLS read.
// React cache does not persist a viewer's listings across requests/accounts.
export const getMarketplaceSamples = cache(async () => {
  const supabase = createClient();
  return readMarketplaceSamples(() => supabase.from('agent_marketplace_samples')
    .select('slug,position,listing').order('position').limit(2)
    .abortSignal(AbortSignal.timeout(2000)));
});
