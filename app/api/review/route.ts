import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { resolveReviewAction } from '@/lib/review-actions';

/**
 * POST /api/review  { action, ... }
 *
 * The dashboard's write path into the Review Room API. Deliberately ONE route with an
 * explicit action allowlist rather than a `[...path]` passthrough: a generic proxy
 * carrying the user's JWT would let any client-side bug (or any injected string) reach
 * an arbitrary backend endpoint under that user's identity. Every action below names
 * exactly one upstream path and forwards exactly the fields it needs.
 *
 * The session token stays server-side. It is never sent to the browser, and no local
 * filesystem path passes through here in either direction.
 */

const BACKEND = (process.env.NEXT_PUBLIC_IMPLEXA_API_URL || 'https://core.implexa.ai').replace(/\/$/, '');

export async function POST(request: Request) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    return NextResponse.json({ ok: false, error: 'not signed in' }, { status: 401 });
  }

  let body: Record<string, unknown> = {};
  try { body = (await request.json()) ?? {}; } catch { /* handled below */ }

  const action = String(body.action || '');
  const target = resolveReviewAction(action, body);
  if (typeof target === 'string') {
    return NextResponse.json({ ok: false, error: target }, { status: 400 });
  }

  try {
    const res = await fetch(`${BACKEND}${target.path}`, {
      method: target.method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${session.access_token}` },
      ...(target.body !== undefined ? { body: JSON.stringify(target.body) } : {}),
      signal: AbortSignal.timeout(15000),
    });
    const payload = await res.json().catch(() => ({ ok: false, error: 'The review service returned an unreadable response.' }));
    // Pass the upstream status THROUGH. 409 carries the state-machine refusals the UI
    // must react to (needsDiscardConfirmation, conflict); 503 means a read we could not
    // make. Flattening them all to 400 would erase the difference between "you must
    // confirm" and "we do not know".
    return NextResponse.json(payload, { status: res.status });
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Could not reach the review service. Nothing was changed.', unavailable: true },
      { status: 503 },
    );
  }
}
