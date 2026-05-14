import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: Request) {
  const supabase = createClient();
  await supabase.auth.signOut();
  const url = new URL(request.url);
  // 303 See Other forces the browser to follow with GET, regardless of the
  // original request method. NextResponse.redirect() defaults to 307 which
  // preserves POST — that would land at /login as a POST, which has no
  // handler and returns 405 Method Not Allowed.
  return NextResponse.redirect(`${url.origin}/login`, { status: 303 });
}
