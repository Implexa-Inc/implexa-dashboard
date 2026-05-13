/**
 * Auth callback — handles three entry points:
 *   1. OAuth (Google / Microsoft) — receives ?code=
 *   2. Magic link / email confirmation — receives ?code=
 *   3. Post-email-password sign-in client redirect — no code, just session is set
 *
 * After exchanging the code (or confirming there's a session), we route the
 * user based on whether they already have a profile row:
 *   - profile exists with organization_id → /skills (logged in & set up)
 *   - profile missing (first time landing here) → /onboarding (Plan A picker)
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Safelist `next` redirects to internal paths only — prevents open-redirect
// abuse via `?next=https://evil.example`.
function sanitizeNext(next: string | null): string | null {
  if (!next) return null;
  if (!next.startsWith('/')) return null;
  if (next.startsWith('//')) return null;   // protocol-relative URL
  return next;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const next = sanitizeNext(url.searchParams.get('next'));
  const supabase = createClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      const loginUrl = new URL('/login', url.origin);
      loginUrl.searchParams.set('error', error.message);
      if (next) loginUrl.searchParams.set('next', next);
      return NextResponse.redirect(loginUrl);
    }
  }

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    const loginUrl = new URL('/login', url.origin);
    if (next) loginUrl.searchParams.set('next', next);
    return NextResponse.redirect(loginUrl);
  }

  const { data: profile } = await supabase
    .from('users').select('id, organization_id').eq('id', user.id).maybeSingle();

  if (!profile || !profile.organization_id) {
    const onboardingUrl = new URL('/onboarding', url.origin);
    if (next) onboardingUrl.searchParams.set('next', next);
    return NextResponse.redirect(onboardingUrl);
  }

  return NextResponse.redirect(`${url.origin}${next || '/skills'}`);
}
