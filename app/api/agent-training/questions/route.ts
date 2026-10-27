import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { UUID, validAnswerBody } from '@/lib/trainer-questions';

const BACKEND = (process.env.NEXT_PUBLIC_IMPLEXA_API_URL || 'https://core.implexa.ai').replace(/\/$/, '');
// One named owner-authenticated read/link surface; never a path or identity proxy.
async function forward(request: Request, write: boolean) {
  const { data: { session } } = await createClient().auth.getSession();
  if (!session?.access_token) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  try {
    const query = new URL(request.url).searchParams;
    let path: string; let body: unknown;
    const headers: Record<string, string> = { authorization: `Bearer ${session.access_token}`, 'content-type': 'application/json' };
    if (write) {
      const sessionId = query.get('sessionId'); body = await request.json();
      const key = request.headers.get('Idempotency-Key');
      if ([...query.keys()].some(k => k !== 'sessionId') || !UUID.test(sessionId || '') || !validAnswerBody(body)
        || !key || key.length < 8 || key.length > 180) return NextResponse.json({ ok: false, reason: 'invalid_question_answer' }, { status: 400 });
      path = `/api/v2/agent-training/sessions/${sessionId}/question-answers`; headers['Idempotency-Key'] = key;
    } else {
      const slug = query.get('slug'), after = query.get('afterCreatedAt'), id = query.get('afterId');
      if ([...query.keys()].some(k => !['slug', 'limit', 'afterCreatedAt', 'afterId'].includes(k))
        || !/^[a-zA-Z0-9_-]{1,200}$/.test(slug || '') || (query.has('limit') && query.get('limit') !== '20')
        || query.has('afterCreatedAt') !== query.has('afterId') || (after !== null && (!Number.isFinite(Date.parse(after)) || !UUID.test(id || '')))) {
        return NextResponse.json({ ok: false, reason: 'invalid_question_cursor' }, { status: 400 });
      }
      const cursor = new URLSearchParams({ limit: '20', ...(after && id ? { afterCreatedAt: after, afterId: id } : {}) });
      path = `/api/v2/agent-training/agents/${encodeURIComponent(slug!)}/questions?${cursor}`;
    }
    const response = await fetch(`${BACKEND}${path}`, { method: write ? 'POST' : 'GET', headers,
      ...(write ? { body: JSON.stringify(body) } : {}), cache: 'no-store', signal: AbortSignal.timeout(8000) });
    return NextResponse.json(await response.json(), { status: response.status, headers: { 'Cache-Control': 'no-store' } });
  } catch { return NextResponse.json({ ok: false, reason: 'trainer_questions_unavailable' }, { status: 503 }); }
}
export function GET(request: Request) { return forward(request, false); }
export function POST(request: Request) { return forward(request, true); }
