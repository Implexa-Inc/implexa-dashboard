declare global {
  var __implexaCalls: { push: string[]; replace: string[]; backend: Array<{ path: string; init: unknown }> };
  var __implexaBackend: ((path: string, init: unknown) => unknown) | undefined;
}
export {};
