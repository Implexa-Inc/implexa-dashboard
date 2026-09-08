import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { resolveTrainingReviewAction } from '@/lib/training-review-actions';

/**
 * POST /api/training-review  { action, ... }
 *
 * The dashboard's write path into the Agent Coach API (spec §3.3).
 *
 * A SEPARATE ROUTE FROM `/api/review`, ON PURPOSE. Sharing the route would mean one
 * allowlist holding both authorities, and a single mistyped case label there is
 * enough to write a `run_review_*` row for a demonstration — which §3.3 forbids and
 * §8 lists as an explicit non-goal. Here the resolver this route calls can emit no
 * path outside `/api/v2/agent-coach/`, and it refuses every run-review action by name.
 *
 * Like `/api/review`, this is ONE route with an explicit action allowlist rather than
 * a `[...path]` passthrough: a generic proxy carrying the user's JWT would let any
 * client-side bug reach an arbitrary backend endpoint under that user's identity.
 *
 * ── HEADERS COME FROM THE RESOLVER, NEVER FROM THE CLIENT ────────────────────────
 *
 * `Idempotency-Key` is the one upstream header this surface sends, and it is built by
 * `resolveTrainingReviewAction` from a validated field — not copied from the incoming
 * request. Forwarding a caller-supplied header set would let a client-side bug (or a
 * crafted body) set arbitrary headers on an authenticated backend call.
 *
 * The session token stays server-side. No local filesystem path passes through here
 * in either direction — F0 uploads no recording, and evidence travels as a descriptor
 * (digest + bounded range), never as bytes or a path.
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
  const target = resolveTrainingReviewAction(action, body);
  if (typeof target === 'string') {
    return NextResponse.json({ ok: false, error: target }, { status: 400 });
  }

  try {
    const res = await fetch(`${BACKEND}${target.path}`, {
      method: target.method,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${session.access_token}`,
        // Resolver-built only. `target.headers` is `Idempotency-Key` and nothing else;
        // see the header note above for why the incoming request's headers are not
        // forwarded.
        ...(target.headers ?? {}),
      },
      ...(target.body !== undefined ? { body: JSON.stringify(target.body) } : {}),
      signal: AbortSignal.timeout(15000),
    });
    const payload = await res.json().catch(() => ({
      ok: false, error: 'The training review service returned an unreadable response.',
    }));
    // Pass the upstream status AND its typed `reason` THROUGH. 409 carries the
    // append-only and idempotency refusals, 412 a stale card, 422 an unconfirmable
    // one, 503 a surface that could not answer. Flattening any of them to 400 would
    // erase "already submitted" into "bad request" — and dropping `reason` would leave
    // the client unable to tell "coaching is off here" from "you coached nothing".
    return NextResponse.json(payload, { status: res.status });
  } catch {
    return NextResponse.json(
      {
        ok: false,
        reason: 'coaching_unavailable',
        error: 'Could not reach the coaching service. Nothing was changed.',
        unavailable: true,
      },
      { status: 503 },
    );
  }
}
