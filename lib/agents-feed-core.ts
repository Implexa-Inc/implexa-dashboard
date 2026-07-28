// agents-feed-core.ts -- the fetch + shape-validation half of the agent feed.
//
// SPLIT OUT OF agents-home.ts (2026-07-28) SO IT CAN BE TESTED. That file carries
// `import 'server-only'`, which does not resolve outside a Next build, so node:test
// could not load it -- and the P0 it guards (a failed read rendering as "48 agents need
// activation") is exactly the kind of defect that needs executable tests rather than
// source-regex ones.
//
// Nothing here touches the session directly: the caller supplies the token, so this
// module is pure I/O + validation and safe to load anywhere. `server-only` stays on
// agents-home.ts, which is what actually reads the Supabase session.

const BACKEND = (
  process.env.NEXT_PUBLIC_IMPLEXA_API_URL || 'https://core.implexa.ai'
).replace(/\/$/, '');

// TYPE-ONLY import: erased at runtime by the type stripper, so this module never
// loads agents-home.ts (and therefore never touches `server-only`) during tests.
import type { MyAgent, MyAgents } from './agents-home';

/**
 * READY vs UNAVAILABLE — the distinction this file used to erase.
 *
 * THE BUG (2026-07-28, P0). This returned `null` for every failure — timeout, non-200,
 * network error — AND coerced a malformed 200 into empty arrays. The workflows page then
 * saw no backend agents and classified EVERY library item as `not_activated`, rendering
 * "Saved as a draft - turn it on whenever you're ready" across the whole roster.
 *
 * The founder's dashboard showed 48 agents needing activation while the backend was
 * returning 33 active / 1 needs-activation / 16 drafts and the database was untouched.
 * A read failure was presented as a confident, alarming, actionable status telling the
 * user to go re-activate agents that were never off.
 *
 * "Unknown" is a real answer and must survive to the UI. Absence of data is NOT evidence
 * of absence of activation.
 */
export type AgentsFeed =
  | ({ status: 'ready' } & MyAgents)
  | { status: 'unavailable'; reason: 'no_session' | 'http_error' | 'timeout' | 'network' | 'malformed' };

/**
 * Validate the response SHAPE. Exported so the failure modes are testable without a
 * network.
 *
 * A malformed 200 is `unavailable`, never empty arrays: coercing `{}` to
 * `{active: [], ...}` is indistinguishable from "this user has no active agents", which
 * is exactly how the original bug rendered a broken response as a factual claim.
 *
 * `drafts` is tolerated when absent (a backend predating it is still usable); `active`
 * and `needsActivation` are REQUIRED, because those two are what the page uses to decide
 * that an agent IS activated.
 */
export function parseAgentsBody(body: unknown): AgentsFeed {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { status: 'unavailable', reason: 'malformed' };
  const b = body as Record<string, unknown>;
  if (!Array.isArray(b.active) || !Array.isArray(b.needsActivation)) return { status: 'unavailable', reason: 'malformed' };
  return {
    status: 'ready',
    needsActivation: b.needsActivation as MyAgent[],
    active: b.active as MyAgent[],
    drafts: Array.isArray(b.drafts) ? (b.drafts as MyAgent[]) : [],
  };
}

/** Injectable for tests only; production uses the real session + fetch. */
export type AgentsFeedDeps = {
  fetchImpl?: typeof fetch;
  getToken?: () => Promise<string | null>;
  timeoutMs?: number;
};

export async function getMyAgents(deps: AgentsFeedDeps = {}): Promise<AgentsFeed> {
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

  let res: Response;
  try {
    res = await doFetch(`${BACKEND}/api/v2/me/agents`, {
      headers: { authorization: `Bearer ${token}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    // A timeout is reported distinctly because it is the one the user can meaningfully
    // retry, and the one that actually fired here: /me/agents measured 2.5-4.5s for 50
    // agents against an 8s abort, and its cost grows with the roster.
    const name = (err as { name?: string } | null)?.name;
    return { status: 'unavailable', reason: name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network' };
  }
  if (!res.ok) return { status: 'unavailable', reason: 'http_error' };
  try {
    return parseAgentsBody(await res.json());
  } catch {
    return { status: 'unavailable', reason: 'malformed' };   // body was not JSON at all
  }
}

