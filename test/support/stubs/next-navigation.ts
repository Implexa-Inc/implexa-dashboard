/**
 * `next/navigation` stub for rendered tests.
 *
 * The shell reads exactly one thing from the router — `usePathname()` — to
 * decide which domain is selected. Tests set it with `__setPathname()` before
 * rendering, which is how the same component is exercised on a deep link
 * (`/review/abc`), a legacy route (`/inbox`) and a canonical one (`/work`).
 *
 * The register hook maps `next/navigation` to this file, so the component under
 * test and the test itself share one module instance.
 */

let pathname = '/';

export function __setPathname(next: string): void {
  pathname = next;
}

export function usePathname(): string {
  return pathname;
}

export function useSearchParams(): URLSearchParams {
  const query = pathname.includes('?') ? pathname.slice(pathname.indexOf('?') + 1) : '';
  return new URLSearchParams(query);
}

export function useRouter() {
  return {
    push:    () => {},
    replace: () => {},
    refresh: () => {},
    back:    () => {},
    forward: () => {},
    prefetch: () => {},
  };
}

export function redirect(url: string): never {
  const err = new Error(`NEXT_REDIRECT:${url}`) as Error & { digest: string };
  err.digest = `NEXT_REDIRECT;replace;${url};307;`;
  throw err;
}

export function notFound(): never {
  throw new Error('NEXT_NOT_FOUND');
}
