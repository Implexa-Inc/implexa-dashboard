import { type NextRequest, NextResponse } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { isAuthApiError, isAuthError, isAuthSessionMissingError } from '@supabase/supabase-js';

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

function authUnavailable(request: NextRequest) {
  const headers = { 'Cache-Control': 'no-store', 'Retry-After': '5' };
  const path = request.nextUrl.pathname;
  const acceptsHtml = request.headers.get('accept')?.split(',').some(value => {
    const [type, ...parameters] = value.trim().toLowerCase().split(';');
    return type.trim() === 'text/html' && !parameters.some(parameter => /^\s*q\s*=\s*0(?:\.0*)?\s*$/.test(parameter));
  });
  const destination = request.headers.get('sec-fetch-dest');
  if (['GET', 'HEAD'].includes(request.method) && acceptsHtml
    && path !== '/api' && !path.startsWith('/api/')
    && !request.headers.has('rsc') && !request.headers.has('next-router-state-tree')
    && (!destination || destination === 'document')) {
    // Middleware runs before the app's error boundary. Never reflect a URL,
    // account, SDK error or cookie into this document. An empty relative href
    // retries the current address only when the user chooses it; no scripts.
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign-in check unavailable · Tukido</title><style>
:root{color-scheme:light dark;font:16px/1.6 system-ui,sans-serif}body{margin:0;background:Canvas;color:CanvasText;min-height:100vh;display:grid;place-items:center}main{max-width:34rem;padding:2rem}h1{font-size:1.5rem;line-height:1.3}a{display:inline-block;color:inherit;padding:.65rem 1rem;border:1px solid currentColor;border-radius:.5rem;font-weight:600}a:focus-visible{outline:3px solid currentColor;outline-offset:4px}
</style></head><body><main><p>Tukido</p><h1>Sign-in check temporarily unavailable</h1><p>We couldn’t complete the sign-in verification. Please try again in a moment.</p><a href="">Try again</a></main></body></html>`;
    return new NextResponse(request.method === 'HEAD' ? null : html, { status: 503, headers: {
      ...headers,
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'self'; form-action 'none'",
      'X-Content-Type-Options': 'nosniff',
      Vary: 'Accept, RSC, Next-Router-State-Tree, Sec-Fetch-Dest',
    } });
  }
  return NextResponse.json({
    code: 'auth_read_unavailable',
    error: 'Sign-in verification is temporarily unavailable. Please try again.',
  }, { status: 503, headers });
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
  let phase: 'initialize' | 'refresh' | 'verify' = 'initialize';
  function unavailable(reason: 'invalid_result' | 'sdk_error' | 'aborted' | 'exception', error?: unknown) {
    controller.abort();
    try {
      const status = isAuthError(error) && typeof error.status === 'number' && Number.isInteger(error.status)
        && error.status >= 400 && error.status <= 599 ? error.status : null;
      // Failure-only metadata. No route/query, identity, cookies, SDK message or
      // arbitrary error fields. Diagnostics must never change the auth result.
      console.warn(JSON.stringify({ event: 'auth.read_unavailable', phase, reason,
        durationMs: Math.max(0, Math.round(performance.now() - startedAt)), upstreamStatus: status }));
    } catch { /* Preserve the same refusal even if the diagnostic sink fails. */ }
    return authUnavailable(request);
  }
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
    phase = 'refresh';
    const prepared = await withinDeadline(() => supabase.auth.getSession(), refreshExpiresAt);
    if (!prepared?.data || (prepared.error && !isSignedOutError(prepared.error))) {
      return unavailable(prepared?.error ? 'sdk_error' : 'invalid_result', prepared?.error);
    }
    phase = 'verify';
    const result = await withinDeadline(() => supabase.auth.getUser(), performance.now() + AUTH_VERIFY_TIMEOUT_MS);
    if (!result?.data || (result.error && (!isSignedOutError(result.error) || result.data.user !== null))
      || (result.data.user !== null && !result.data.user?.id)) {
      return unavailable(result?.error ? 'sdk_error' : 'invalid_result', result?.error);
    }
    user = result.data.user;
  } catch {
    return unavailable(controller.signal.aborted ? 'aborted' : 'exception');
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
