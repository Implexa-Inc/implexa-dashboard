import { NextResponse } from 'next/server';
import { readSharedAgent } from '@/lib/agent-share';

export async function GET(request: Request) {
  const result = await readSharedAgent(new URL(request.url).searchParams.get('id') || '');
  const status = result.state === 'ready' ? 200 : result.state === 'missing' ? 404 : 503;
  return NextResponse.json({ state: result.state }, { status, headers: { 'Cache-Control': 'no-store' } });
}
