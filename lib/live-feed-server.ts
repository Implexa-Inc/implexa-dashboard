/**
 * lib/live-feed-server.ts — the SERVER read of /scheduled-skills/live.
 *
 * The live feed already had exactly one caller shape (running-agents.tsx polling
 * through callBackend) and one parser (`parseLiveItems`, lib/live-feed.ts). The
 * state-aware landing rule needs the same fact on the server, so the server
 * caller lives here: one endpoint, one parser, one unreadable-vs-empty contract.
 * Do not open a second path to this feed.
 *
 * WHY A SEPARATE FILE FROM lib/live-feed.ts. That module is imported by
 * running-agents.tsx, a CLIENT component. Putting this function there dragged
 * `@/lib/supabase/server` — and therefore `next/headers` — into the client
 * bundle and failed the production build. The parser stays shared; the server
 * read is isolated.
 *
 * Deps are injectable so every failure mode is testable without a network,
 * mirroring lib/agents-feed-core.ts. `server-only` is deliberately NOT imported
 * for the same reason it is absent there: it does not resolve under node:test,
 * and these failure modes are exactly what needs executable tests.
 */

import { parseLiveItems } from './live-feed';

const BACKEND = (
  process.env.NEXT_PUBLIC_IMPLEXA_API_URL || 'https://core.implexa.ai'
).replace(/\/$/, '');

/** Only the field the landing rule reads. The full card shape lives in the UI. */
export type LiveCardStatus = { status?: string | null };

export type LiveFeed =
  | { status: 'ready'; items: LiveCardStatus[] }
  | { status: 'unavailable'; reason: 'no_session' | 'http_error' | 'timeout' | 'network' | 'malformed' };

export type LiveFeedDeps = {
  fetchImpl?: typeof fetch;
  getToken?:  () => Promise<string | null>;
  timeoutMs?: number;
};

export async function getLiveFeed(deps: LiveFeedDeps = {}): Promise<LiveFeed> {
  const timeoutMs = deps.timeoutMs ?? 8000;
  const getToken = deps.getToken ?? (async () => {
    const { createClient } = await import('@/lib/supabase/server');
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token ?? null;
  });
  const doFetch = deps.fetchImpl ?? fetch;

  const token = await getToken();
  if (!token) return { status: 'unavailable', reason: 'no_session' };

  try {
    const res = await doFetch(`${BACKEND}/api/v2/scheduled-skills/live`, {
      headers: { authorization: `Bearer ${token}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return { status: 'unavailable', reason: 'http_error' };
    // parseLiveItems, not `body.items ?? []` — a malformed 200 is a read we
    // could not make, and coercing it to an empty list is indistinguishable
    // from "nothing is running", which is what sends the user to Agents.
    const items = parseLiveItems<LiveCardStatus>(await res.json().catch(() => null));
    if (items === null) return { status: 'unavailable', reason: 'malformed' };
    return { status: 'ready', items };
  } catch (e) {
    const name = (e as { name?: string })?.name;
    const timedOut = name === 'TimeoutError' || name === 'AbortError';
    return { status: 'unavailable', reason: timedOut ? 'timeout' : 'network' };
  }
}
