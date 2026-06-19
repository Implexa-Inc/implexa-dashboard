import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * POST /api/agents/create  { intent, mode?, cron?, timezone? }
 *
 * Enqueues a "build an agent that <intent>" request on the backend run-request
 * bus, using the caller's Supabase session (so it works identically in a plain
 * browser and inside the desktop shell). The user's own Claude/Codex does the
 * actual building when it next opens (the SessionStart hook picks it up). We
 * never run a model server-side: presence, never runtime.
 *
 * (Named "create", not "build": a directory named build/ is gitignored.)
 */

const BACKEND = (process.env.NEXT_PUBLIC_IMPLEXA_API_URL || 'http://localhost:8001').replace(/\/$/, '');

export async function POST(request: Request) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    return NextResponse.json({ ok: false, error: 'not signed in' }, { status: 401 });
  }

  let intent = '';
  // Optional schedule shaping from a recommendation (mode='cron' lands a timed
  // routine). Forwarded as-is; the backend ignores them for a plain build.
  let mode: string | undefined;
  let cron: string | undefined;
  let timezone: string | undefined;
  try {
    const body = await request.json();
    intent = String(body?.intent || '').trim();
    if (body?.mode) mode = String(body.mode);
    if (body?.cron) cron = String(body.cron);
    if (body?.timezone) timezone = String(body.timezone);
  } catch {
    /* empty body handled below */
  }
  if (!intent) {
    return NextResponse.json({ ok: false, error: 'intent required' }, { status: 400 });
  }

  try {
    const res = await fetch(`${BACKEND}/api/v2/me/run-requests`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ kind: 'build', intent, source: 'dashboard', mode, cron, timezone }),
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) {
      return NextResponse.json({ ok: false, error: data?.error || 'enqueue failed' }, { status: 502 });
    }
    return NextResponse.json({ ok: true, request: data.request });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'enqueue failed';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
