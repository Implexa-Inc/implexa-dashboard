import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * POST /api/agents/plan-preview  { intent, toolPreferences?, toolUnavailable? }
 *
 * The zero-write draft plan the Create flow shows BEFORE persisting a new agent
 * (2026-07-23). Forwards to the backend's deterministic capability model and
 * returns the UI-ready plan (capabilities → recommended tool, alternatives,
 * access route, cost). Re-called on every tool change — vendor selection stays
 * server-side, so the dashboard never chooses vendors itself.
 */

const BACKEND = (process.env.NEXT_PUBLIC_IMPLEXA_API_URL || 'http://localhost:8001').replace(/\/$/, '');

export async function POST(request: Request) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    return NextResponse.json({ ok: false, error: 'not signed in' }, { status: 401 });
  }

  let intent = '';
  let toolPreferences: string[] = [];
  let toolUnavailable: string[] = [];
  const cleanList = (v: unknown): string[] => (
    Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string' && !!s.trim()).slice(0, 6) : []
  );
  try {
    const body = await request.json();
    intent = String(body?.intent || '').trim();
    toolPreferences = cleanList(body?.toolPreferences);
    toolUnavailable = cleanList(body?.toolUnavailable);
  } catch {
    /* empty body handled below */
  }
  if (intent.length < 8) {
    return NextResponse.json({ ok: false, error: 'describe the agent in a sentence or two' }, { status: 400 });
  }

  try {
    const res = await fetch(`${BACKEND}/api/v2/agents/plan-preview`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ intent, toolPreferences, toolUnavailable }),
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) {
      return NextResponse.json({ ok: false, error: data?.error || 'could not build the plan' }, { status: 502 });
    }
    return NextResponse.json(data);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'could not build the plan';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
