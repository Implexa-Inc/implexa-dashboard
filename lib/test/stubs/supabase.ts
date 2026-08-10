export const createClient = () => ({
  auth: { getSession: async () => ({ data: { session: { access_token: 'test-jwt' } } }) },
});
