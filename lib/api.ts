/**
 * Thin helper to call the Implexa backend with the user's Supabase JWT.
 * Throws on non-2xx with the upstream error message.
 */

/**
 * A non-2xx response, carrying the parsed body so a caller can act on a STRUCTURED
 * refusal instead of only a string.
 *
 * Why: the backend can now answer a Run click with 409 + `needsCapability` — the
 * cross-engine card ("Codex doesn't have Computer Use; Claude does — switch, or
 * install it"). Throwing a bare Error discarded that payload and reduced an
 * actionable choice to a dead-end sentence.
 *
 * Still a plain Error subclass with the same .message, so every existing
 * `catch (e) { e.message }` keeps working untouched.
 */
export class BackendError extends Error {
  status: number;
  body: any;
  constructor(message: string, status: number, body: any) {
    super(message);
    this.name = 'BackendError';
    this.status = status;
    this.body = body;
  }
}

// Falls back to production (not localhost) so a missing NEXT_PUBLIC_IMPLEXA_API_URL
// degrades to the real API instead of an unreachable localhost ("Failed to fetch").
const BASE = (process.env.NEXT_PUBLIC_IMPLEXA_API_URL || 'https://core.implexa.ai').replace(/\/$/, '');

export async function callBackend(path: string, opts: {
  jwt?: string | null;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: any;
} = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.jwt) headers.Authorization = `Bearer ${opts.jwt}`;

  const res = await fetch(`${BASE}${path}`, {
    method:  opts.method || 'GET',
    headers,
    body:    opts.body ? JSON.stringify(opts.body) : undefined,
    cache:   'no-store',
  });

  const text = await res.text();
  let parsed: any = null;
  try { parsed = text ? JSON.parse(text) : null; } catch (_) { /* keep null */ }

  if (!res.ok) {
    const msg = parsed?.error || `Request failed (${res.status})`;
    throw new BackendError(msg, res.status, parsed);
  }
  return parsed;
}
