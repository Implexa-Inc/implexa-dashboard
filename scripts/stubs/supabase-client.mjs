/**
 * `@/lib/supabase/client` outside the browser.
 *
 * The component only ever reads a session to get a bearer token for `callBackend`. It
 * never inspects the user, so a fixed token is the whole surface. Kept deliberately
 * dumb: a stub that grew logic would start deciding test outcomes on its own.
 */
export function createClient() {
  return {
    auth: {
      getSession: async () => ({ data: { session: { access_token: 'test-token' } } }),
    },
  };
}
