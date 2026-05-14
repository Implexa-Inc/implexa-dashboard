/**
 * Auth callback — handles four entry points:
 *
 *   1. OAuth (Google / Microsoft) — receives ?code= (PKCE flow, same-browser)
 *   2. Magic link / email-password confirmation via token_hash — receives
 *      ?token_hash=&type= (token flow, cross-browser safe — recommended for
 *      email links since users often open them in a different browser)
 *   3. Magic link via PKCE — receives ?code= (legacy, requires same browser)
 *   4. Post-sign-in client redirect — no code or token, just session is set
 *
 * After authenticating, we route based on profile state:
 *   - profile exists with organization_id → /skills
 *   - profile missing → /onboarding (Plan A picker)
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type { EmailOtpType } from '@supabase/supabase-js';

// Safelist `next` redirects to internal paths only — prevents open-redirect
// abuse via `?next=https://evil.example`.
function sanitizeNext(next: string | null): string | null {
  if (!next) return null;
  if (!next.startsWith('/')) return null;
  if (next.startsWith('//')) return null;
  return next;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code       = url.searchParams.get('code');
  const tokenHash  = url.searchParams.get('token_hash');
  const otpType    = url.searchParams.get('type') as EmailOtpType | null;
  const next       = sanitizeNext(url.searchParams.get('next'));
  const supabase   = createClient();

  // ─── Path A — token_hash flow (cross-browser email verification) ──────
  // This is the recommended flow for email links because it doesn't depend
  // on the PKCE code_verifier cookie, which only exists in the originating
  // browser. Users routinely click email links in a different browser
  // (default mail app → default browser, etc.) — token_hash flow handles
  // that case gracefully.
  if (tokenHash && otpType) {
    const { error } = await supabase.auth.verifyOtp({
      type: otpType,
      token_hash: tokenHash,
    });
    if (error) {
      const loginUrl = new URL('/login', url.origin);
      loginUrl.searchParams.set('error', `Email confirmation failed: ${error.message}`);
      if (next) loginUrl.searchParams.set('next', next);
      return NextResponse.redirect(loginUrl);
    }
  }

  // ─── Path B — PKCE code flow (OAuth + legacy email links) ──────────────
  // This requires the code_verifier cookie set when the auth was initiated.
  // OAuth (Google/Microsoft) uses this and works because the entire flow
  // happens in the same browser session.
  else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      // Special handling for the cross-browser PKCE failure: detect it
      // and give the user a useful message instead of the raw error.
      const isPkceMismatch = /PKCE code verifier not found/i.test(error.message);
      const loginUrl = new URL('/login', url.origin);
      if (isPkceMismatch) {
        loginUrl.searchParams.set(
          'error',
          'This verification link was opened in a different browser than where you signed up. Open the link in the same browser, or sign in with email + password directly.',
        );
      } else {
        loginUrl.searchParams.set('error', error.message);
      }
      if (next) loginUrl.searchParams.set('next', next);
      return NextResponse.redirect(loginUrl);
    }
  }

  // ─── After auth — check session + route by profile state ──────────────
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
