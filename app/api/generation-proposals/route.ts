import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { resolveProposalAction } from '@/lib/generation-proposal-actions';

/**
 * POST /api/generation-proposals  { action, ... }
 *
 * The dashboard's preview/create/approve/cancel path into the generation-proposal API, shaped exactly
 * like /api/review and for the same reason: one route, an explicit action
 * allowlist, no generic passthrough carrying the user's JWT. The session token
 * stays server-side. No provider secret, signed URL, authorization internal, or
 * local path passes through here in either direction.
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

  const target = resolveProposalAction(String(body.action || ''), body);
  if (typeof target === 'string') {
    return NextResponse.json({ ok: false, error: target }, { status: 400 });
  }

  try {
    const res = await fetch(`${BACKEND}${target.path}`, {
      method: target.method,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${session.access_token}`,
        ...(target.idempotencyKey ? { 'idempotency-key': target.idempotencyKey } : {}),
      },
      body: JSON.stringify(target.body),
      signal: AbortSignal.timeout(15000),
    });
    const payload = await res.json().catch(() => ({ ok: false, error: 'unreadable_response' }));
    // Pass the upstream status THROUGH: 409 carries the state-machine refusals
    // (stale_proposal, proposal_expired, proposal_already_approved) the UI turns
    // into honest copy; 503 means a read/write we could not make.
    return NextResponse.json(payload, { status: res.status });
  } catch {
    return NextResponse.json(
      // "Nothing was changed" would overclaim here: a timed-out approve may have
      // landed. The idempotency key means re-approving CANNOT double-authorize,
      // and the UI re-reads the proposal to learn what actually happened.
      { ok: false, error: 'unreachable', unavailable: true },
      { status: 503 },
    );
  }
}
