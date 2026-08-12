/**
 * `next/server` stub for route tests.
 *
 * Next's real module is not resolvable as a bare ESM specifier outside a Next
 * build. The auth callback uses exactly one thing from it — `NextResponse.redirect`
 * — and its contract is a plain web Response carrying a `location` header, which
 * is what the tests read.
 */

export const NextResponse = {
  redirect(url: URL | string, status = 307): Response {
    return new Response(null, { status, headers: { location: String(url) } });
  },
  json(body: unknown, init?: ResponseInit): Response {
    return new Response(JSON.stringify(body), {
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    });
  },
  next(): Response {
    return new Response(null, { status: 200 });
  },
};
