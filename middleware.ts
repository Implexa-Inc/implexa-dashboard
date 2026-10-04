import { type NextRequest, NextResponse } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { isAuthApiError, isAuthSessionMissingError } from '@supabase/supabase-js';

type CookieToSet = { name: string; value: string; options: CookieOptions };

/**
 * Auth middleware — refreshes the Supabase session cookie on every navigation
 * and gates protected routes. Paths under /skills, /settings, /pricing require
 * an authenticated user. /login, /signup, /auth/callback, and / are public.
 */

const PROTECTED_PREFIXES = ['/skills', '/settings', '/pricing'];
// Refresh and verified-user lookup are sequential SDK operations. A slow but
// successful refresh must not consume the verification allowance. Together they
// stay below Vercel's 25-second middleware response limit (at most 12 seconds).
const AUTH_REFRESH_TIMEOUT_MS = 8000;
const AUTH_VERIFY_TIMEOUT_MS = 4000;

function authUnavailable() {
  return NextResponse.json({
    code: 'auth_read_unavailable',
    error: 'Sign-in verification is temporarily unavailable. Please try again.',
  }, { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '5' } });
}

function isSignedOutError(error: unknown) {
  return isAuthSessionMissingError(error) || (isAuthApiError(error) && (
    error.status === 401 || error.status === 403 || [
      'session_not_found', 'refresh_token_not_found', 'refresh_token_already_used',
      'bad_jwt', 'user_not_found', 'user_banned',
    ].includes(error.code ?? '')
  ));
}

export async function middleware(request: NextRequest) {
  const response = NextResponse.next({ request });
  const controller = new AbortController();
  const startedAt = performance.now();
  const refreshExpiresAt = startedAt + AUTH_REFRESH_TIMEOUT_MS;
  const overallExpiresAt = refreshExpiresAt + AUTH_VERIFY_TIMEOUT_MS;
  let expiresAt = refreshExpiresAt;
  // Do not let a failed/late refresh delete or replace the browser's cookies.
  // Only a verified result (including genuine sign-out) commits the SDK writes.
  const pendingCookies: CookieToSet[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  async function withinDeadline<T>(operation: () => Promise<T>, phaseExpiresAt: number): Promise<T> {
    // One allowance per phase, not per SDK retry or upstream fetch.
    expiresAt = Math.min(phaseExpiresAt, overallExpiresAt);
    const remainingMs = expiresAt - performance.now();
    if (remainingMs <= 0 || controller.signal.aborted) {
      controller.abort();
      throw new Error('auth_read_deadline');
    }
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error('auth_read_deadline'));
      }, remainingMs);
    });
    try {
      const result = await Promise.race([operation(), deadline]);
      if (controller.signal.aborted || performance.now() >= expiresAt) {
        controller.abort();
        throw new Error('auth_read_deadline');
      }
      return result;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    }
  }
  let user;
  try {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        global: {
          fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
            // This request-local fetch also covers initialization/token refresh.
            // Retried SDK calls cannot start another transport after expiry.
            if (controller.signal.aborted || performance.now() >= expiresAt) {
              controller.abort();
              throw new Error('auth_read_deadline');
            }
            const callerSignal = init?.signal;
            const abort = () => controller.abort(callerSignal?.reason);
            if (callerSignal?.aborted) abort();
            callerSignal?.addEventListener('abort', abort, { once: true });
            try {
              return await fetch(input, { ...init, signal: controller.signal });
            } finally {
              callerSignal?.removeEventListener('abort', abort);
            }
          },
        },
        cookies: {
          getAll() { return request.cookies.getAll(); },
          setAll(toSet: CookieToSet[]) {
            if (!controller.signal.aborted) pendingCookies.push(...toSet);
          },
        },
      },
    );
    // getSession awaits SDK initialization/refresh. Its stored user is UNTRUSTED
    // and never authorizes access; getUser remains the independent authority.
    const prepared = await withinDeadline(() => supabase.auth.getSession(), refreshExpiresAt);
    if (!prepared?.data || (prepared.error && !isSignedOutError(prepared.error))) {
      controller.abort();
      return authUnavailable();
    }
    const result = await withinDeadline(() => supabase.auth.getUser(), performance.now() + AUTH_VERIFY_TIMEOUT_MS);
    if (!result?.data || (result.error && (!isSignedOutError(result.error) || result.data.user !== null))
      || (result.data.user !== null && !result.data.user?.id)) {
      controller.abort();
      return authUnavailable();
    }
    user = result.data.user;
  } catch {
    controller.abort();
    return authUnavailable();
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
  pendingCookies.forEach(({ name, value, options }) => response.cookies.set(name, value, options));

  const path = request.nextUrl.pathname;
  const isProtected = PROTECTED_PREFIXES.some(p => path.startsWith(p));
  if (isProtected && !user) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('next', path);
    return NextResponse.redirect(loginUrl);
  }

  // Expose the pathname to server components (Next doesn't surface it in
  // layouts). The (dashboard) layout reads this to hard-gate not-yet-connected
  // users to /get-app without an extra DB round-trip.
  response.headers.set('x-pathname', path);
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
