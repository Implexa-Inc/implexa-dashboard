export const createClient = () => ({
  auth: (globalThis as unknown as { __implexaAuth?: unknown }).__implexaAuth
    ?? { getSession: async () => ({ data: { session: { access_token: 'test-jwt' } } }) },
});
