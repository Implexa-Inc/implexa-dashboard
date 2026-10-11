import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const BACKEND = (process.env.NEXT_PUBLIC_IMPLEXA_API_URL || 'https://core.implexa.ai').replace(/\/$/, '');
// Owner Check/read/preview proxy. Never imports an assessment or invokes revision.
async function forward(request: Request, preview: boolean) {
  const { data: { session } } = await createClient().auth.getSession();
  if (!session?.access_token) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  try {
    const url = new URL(request.url);
    const slug = url.searchParams.get('slug');
    if (!slug) return NextResponse.json({ ok: false, reason: 'slug_required' }, { status: 400 });
    const path = `${BACKEND}/api/v2/agents/${encodeURIComponent(slug)}/definition-review`;
    const check = url.searchParams.get('action') === 'check';
    const body = preview ? await request.json() : null;
    const query = new URLSearchParams({ baseVersionId: url.searchParams.get('baseVersionId') || '' });
    if (url.searchParams.has('requestId')) query.set('requestId', url.searchParams.get('requestId')!);
    const response = await fetch(preview ? `${path}/${check ? 'check' : 'preview'}` : `${path}${check ? '/check' : ''}?${query}`, {
      method: preview ? 'POST' : 'GET', headers: { authorization: `Bearer ${session.access_token}`, 'content-type': 'application/json' },
      ...(preview ? { body: JSON.stringify(body) } : {}), cache: 'no-store', signal: AbortSignal.timeout(8000),
    });
    return NextResponse.json(await response.json(), { status: response.status, headers: { 'Cache-Control': 'no-store' } });
  } catch { return NextResponse.json({ ok: false, reason: 'definition_review_unavailable' }, { status: 503 }); }
}
export function GET(request: Request) { return forward(request, false); }
export function POST(request: Request) { return forward(request, true); }
