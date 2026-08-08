/**
 * `next/navigation` for the rendered Review Room test.
 *
 * Only `useRouter().refresh()` is reachable from this component, and the point of the
 * test is that the queued state does NOT depend on it. The stub records calls so a
 * test can assert exactly that: a refresh may happen, but nothing waits for it.
 */

export const routerCalls = { refresh: 0, push: [], replace: [] };

export function resetRouterCalls() {
  routerCalls.refresh = 0;
  routerCalls.push.length = 0;
  routerCalls.replace.length = 0;
}

export function useRouter() {
  return {
    refresh: () => { routerCalls.refresh += 1; },
    push: (href) => { routerCalls.push.push(href); },
    replace: (href) => { routerCalls.replace.push(href); },
    back: () => {},
    forward: () => {},
    prefetch: () => {},
  };
}

export function usePathname() { return '/review/test-run'; }
export function useSearchParams() { return new URLSearchParams(); }
export function useParams() { return {}; }
export function redirect() { throw new Error('redirect() is not reachable in this test'); }
export function notFound() { throw new Error('notFound() is not reachable in this test'); }
