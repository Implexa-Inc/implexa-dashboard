import {NextRequest, NextResponse} from 'next/server';
import {createClient} from '@/lib/supabase/server';
import {parseRunSummaryCursor, selectRunSummaries} from '@/lib/run-state';

export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  const supabase = createClient();
  const {data: {session}} = await supabase.auth.getSession();
  if (!session?.user) return NextResponse.json({error: 'unauthorized'}, {status: 401});
  let cursor;
  try { cursor = parseRunSummaryCursor(request.nextUrl.searchParams.get('before'), request.nextUrl.searchParams.get('id')); }
  catch { return NextResponse.json({error: 'invalid_cursor'}, {status: 400}); }
  try { return NextResponse.json(await selectRunSummaries(supabase, session.user.id, cursor), {headers: {'Cache-Control': 'private, no-store'}}); }
  catch { return NextResponse.json({error: 'run_history_unavailable'}, {status: 503}); }
}
