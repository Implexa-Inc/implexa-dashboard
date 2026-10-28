import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { UUID } from '@/lib/trainer-questions';
export const maxDuration = 45;
const BACKEND = (process.env.NEXT_PUBLIC_IMPLEXA_API_URL || 'https://core.implexa.ai').replace(/\/$/, '');
export async function POST(request: Request) {
  const { data: { session } } = await createClient().auth.getSession();
  if (!session?.access_token) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  let phase: 'body' | 'backend' | 'response' = 'body';
  try {
    const url = new URL(request.url), sessionId = url.searchParams.get('sessionId'), operation = url.searchParams.get('operation') || 'suggest';
    if ([...url.searchParams.keys()].some(k => !['sessionId','operation'].includes(k)) || !UUID.test(sessionId || '')
      || !['suggest','annotation','recording'].includes(operation)) return NextResponse.json({ ok: false, reason: 'invalid_request' }, { status: 400 });
    // Bounded before parsing; no image upload store, URL forwarding or browser credentials.
    const reader = request.body?.getReader();
    if (!reader) return NextResponse.json({ ok: false, reason: 'invalid_request' }, { status: 400 });
    let length = 0; const parts: Uint8Array[] = [];
    for (;;) { const item = await reader.read(); if (item.done) break; length += item.value.byteLength;
      if (length > 3 * 1024 * 1024) { await reader.cancel(); return NextResponse.json({ ok: false, reason: 'teaching_suggestion_too_large' }, { status: 413 }); }
      parts.push(item.value); }
    const bytes = new Uint8Array(length); let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.length; }
    const body = JSON.parse(new TextDecoder().decode(bytes));
    const key = request.headers.get('Idempotency-Key');
    if (operation !== 'suggest' && (!(operation === 'annotation' ? ['save','link'] : ['manifest','link']).includes(body?.action) || !key || key.length<8 || key.length>180))
      return NextResponse.json({ok:false,reason:'invalid_request'},{status:400});
    phase = 'backend';
    const response = await fetch(`${BACKEND}/api/v2/agent-training/sessions/${sessionId}/${operation === 'annotation' ? 'demo-annotation' : operation === 'recording' ? 'recording' : 'teaching-suggestion'}`, {
      method: 'POST', headers: { authorization: `Bearer ${session.access_token}`, 'content-type': 'application/json',
        ...(operation !== 'suggest' ? {'Idempotency-Key':key!} : {}) },
      body: JSON.stringify(body), cache: 'no-store', signal: AbortSignal.any([request.signal, AbortSignal.timeout(operation !== 'suggest' ? 8000 : 35000)]) });
    phase = 'response';
    return NextResponse.json(await response.json(), { status: response.status, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const timedOut = error && typeof error === 'object' && 'name' in error && error.name === 'TimeoutError';
    const reason = request.signal.aborted ? 'teaching_suggestion_cancelled'
      : timedOut ? 'teaching_suggestion_proxy_timeout' : phase === 'body' ? 'teaching_suggestion_invalid'
        : phase === 'response' ? 'teaching_suggestion_proxy_response_invalid' : 'teaching_suggestion_backend_unreachable';
    return NextResponse.json({ ok: false, reason }, { status: phase === 'body' ? 400 : 503 });
  }
}
