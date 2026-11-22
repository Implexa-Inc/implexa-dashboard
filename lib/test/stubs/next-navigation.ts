export const useRouter = () => ({
  push: (path: string) => globalThis.__implexaCalls.push.push(path),
  refresh: () => {},
  replace: (path: string) => globalThis.__implexaCalls.replace.push(path),
});
export const usePathname = () => (globalThis as unknown as {__implexaTestPath?:string}).__implexaTestPath?.split('?')[0]||'/';
export const useSearchParams = () => new URLSearchParams((globalThis as unknown as {__implexaTestPath?:string}).__implexaTestPath?.split('?')[1]||'');
