import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * POST /api/agents/revise  { slug, note }
 *
 * Enqueues a PERMANENT change to an agent ("edit/improve it"): the user's
 * plain-language instruction (`note`) becomes a kind='revise' run-request. The
 * user's own Claude (the SessionStart hook / the drainer) loads the agent's
 * current steps and calls revise_workflow with the FULL revised chain that
 * incorporates the feedback — so every future run uses the new steps. We never
 * run a model server-side: presence, never runtime.
 */

const BACKEND = (process.env.NEXT_PUBLIC_IMPLEXA_API_URL || 'http://localhost:8001').replace(/\/$/, '');

export async function POST(request: Request) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    return NextResponse.json({ ok: false, error: 'not signed in' }, { status: 401 });
  }

  let slug = '';
  let note = '';
  try {
    const body = await request.json();
    slug = String(body?.slug || '').trim();
    note = String(body?.note || '').trim();
  } catch { /* handled below */ }
  if (!slug) return NextResponse.json({ ok: false, error: 'slug required' }, { status: 400 });
  if (!note) return NextResponse.json({ ok: false, error: 'describe the change' }, { status: 400 });

  try {
    const res = await fetch(`${BACKEND}/api/v2/me/run-requests`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ kind: 'revise', workflowSlug: slug, note, source: 'dashboard' }),
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) {
      return NextResponse.json({ ok: false, error: data?.error || 'could not queue the change' }, { status: 502 });
    }
    return NextResponse.json({ ok: true, request: data.request });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'could not queue the change' }, { status: 500 });
  }
}
