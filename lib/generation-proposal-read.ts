/**
 * lib/generation-proposal-read.ts — the SERVER-SIDE read of a generation
 * proposal.
 *
 * Split from lib/generation-proposal.ts on purpose: the parser is pure and is
 * also consumed by client components (the approval card verifies action
 * responses with it), while this module reaches for the Supabase server client
 * and the user's JWT — which must never enter a client bundle. Server components
 * import this; everything else imports the parser.
 */

import {
  parseGenerationProposalResponse,
  type GenerationProposalViewModel,
} from './generation-proposal.ts';

/**
 * Three-valued read, following lib/attention.ts / lib/review.ts. `not_found` is a
 * real answer (the backend affirmatively said this proposal does not exist for
 * this user); `unavailable` is the absence of an answer. Rendering them the same
 * would tell a user their pending charge vanished when we merely couldn't read it.
 */
export type GenerationProposalRead =
  | { state: 'ready'; vm: GenerationProposalViewModel }
  | { state: 'not_found' }
  | { state: 'unavailable' };

const BACKEND = (
  process.env.NEXT_PUBLIC_IMPLEXA_API_URL || 'https://core.implexa.ai'
).replace(/\/$/, '');

async function sessionToken(): Promise<string | null> {
  const { createClient } = await import('@/lib/supabase/server');
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

export async function getGenerationProposal(proposalId: string): Promise<GenerationProposalRead> {
  const jwt = await sessionToken();
  if (!jwt) return { state: 'unavailable' };
  try {
    const res = await fetch(`${BACKEND}/api/v2/generation-proposals/${encodeURIComponent(proposalId)}`, {
      headers: { authorization: `Bearer ${jwt}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });
    if (res.status === 404) {
      const body = await res.json().catch(() => null);
      // Only the backend's own affirmative answer counts as not-found. A bare 404
      // (wrong deploy, missing route) is a read we could not make.
      if (body && (body as { error?: unknown }).error === 'proposal_not_found') return { state: 'not_found' };
      return { state: 'unavailable' };
    }
    if (!res.ok) return { state: 'unavailable' };
    const body = await res.json();
    const vm = parseGenerationProposalResponse(body, proposalId);
    // Reject, do not coerce. A malformed 200 is a read we could not make.
    return vm ? { state: 'ready', vm } : { state: 'unavailable' };
  } catch {
    return { state: 'unavailable' };
  }
}
