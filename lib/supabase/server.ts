import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

// Server Component / Server Action / Route Handler — reads cookies from
// the Next.js cookie store for SSR auth.
export function createClient() {
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch (_) { /* called from a Server Component — cookies are read-only */ }
        },
      },
    },
  );
}
