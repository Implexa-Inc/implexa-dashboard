export const useRouter = () => ({
  push: (path: string) => globalThis.__implexaCalls.push.push(path),
  refresh: () => {},
  replace: () => {},
});
export const usePathname = () => '/';
export const useSearchParams = () => new URLSearchParams();
