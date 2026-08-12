/**
 * `@/lib/supabase/server` stub for route tests.
 *
 * Lets a test execute the REAL entry-point route components — `app/page.tsx`,
 * `/login`, `/signup`, `/get-app`, `auth/callback` — and observe where they send
 * an authenticated user. Those routing decisions are the thing under test; the
 * database is not.
 *
 * Only the surface those routes actually touch is implemented: `auth.getSession`,
 * `auth.getUser`, and a chainable `from(...).select(...).eq(...)` that resolves
 * through `maybeSingle()` / `limit()`. Anything else is deliberately absent so a
 * route that starts depending on more fails loudly rather than silently reading
 * `undefined`.
 */

type Row = Record<string, unknown> | null;

let session: { user: { id: string; app_metadata?: Record<string, unknown> } } | null = null;
let rows: Record<string, Row> = {};

/** `null` signs the caller out. */
export function __setSession(user: { id: string; app_metadata?: Record<string, unknown> } | null): void {
  session = user ? { user } : null;
}

/** Seed the row a `from(<table>)` chain resolves to. */
export function __setRow(table: string, row: Row): void {
  rows[table] = row;
}

export function __reset(): void {
  session = null;
  rows = {};
}

function builder(table: string) {
  const result = { data: rows[table] ?? null, error: null };
  const chain = {
    select: () => chain,
    eq:     () => chain,
    or:     () => chain,
    in:     () => chain,
    not:    () => chain,
    gte:    () => chain,
    order:  () => chain,
    maybeSingle: async () => result,
    limit:       async () => ({ data: rows[table] ? [rows[table]] : [], error: null }),
    single:      async () => result,
  };
  return chain;
}

export function createClient() {
  return {
    auth: {
      getSession: async () => ({ data: { session }, error: null }),
      getUser:    async () => ({ data: { user: session?.user ?? null }, error: null }),
      verifyOtp:  async () => ({ error: null }),
      exchangeCodeForSession: async () => ({ error: null }),
    },
    from: (table: string) => builder(table),
  };
}
