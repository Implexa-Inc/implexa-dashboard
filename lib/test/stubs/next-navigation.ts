export const useRouter = () => ({
  push: (path: string) => globalThis.__implexaCalls.push.push(path),
  refresh: () => {},
  replace: (path: string) => globalThis.__implexaCalls.replace.push(path),
});
export const usePathname = () => '/';
export const useSearchParams = () => new URLSearchParams();
