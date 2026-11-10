/**
 * `next/headers` stub for route tests.
 *
 * Only `cookies().get(name)` is used by the pages under test (/onboarding reads
 * the sign-up attribution cookie). Tests set values with __setCookie.
 */

const jar = new Map<string, string>();

export function __setCookie(name: string, value: string | null): void {
  if (value === null) jar.delete(name);
  else jar.set(name, value);
}

export function cookies() {
  return {
    get(name: string) {
      const value = jar.get(name);
      return value === undefined ? undefined : { name, value };
    },
  };
}
