/**
 * `@/lib/api` outside the browser.
 *
 * The test installs `globalThis.__IMPLEXA_TEST_BACKEND__` and this hands the call
 * straight to it, so the live-card payload is chosen per test rather than baked in
 * here. An UNINSTALLED handler throws: a component that quietly rendered against an
 * absent backend would be the silence these harnesses exist to catch.
 */
export async function callBackend(path, options) {
  const handler = globalThis.__IMPLEXA_TEST_BACKEND__;
  if (typeof handler !== 'function') {
    throw new Error(`callBackend(${path}) with no __IMPLEXA_TEST_BACKEND__ installed`);
  }
  return handler(path, options);
}
