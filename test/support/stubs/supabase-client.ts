export function createClient() {
  return { auth: { getSession: async () => ({ data: { session: null } }) } };
}
