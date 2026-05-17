/**
 * /login — server component wrapper.
 *
 * Does a session check up front: if the visitor is already logged in, redirects
 * straight to `next` (when provided) or `/skills`. This is the standard pattern
 * for SaaS login pages — users who navigate to /login mid-session shouldn't see
 * a login form they don't need.
 *
 * Critical for the device-auth flow: when someone hits /cli-auth?code=… while
 * already logged in (e.g. they ran the curl on the same machine they're signed
 * in on), this skips an unnecessary "click into the login form, see you're
 * already logged in, get bounced" round-trip.
 *
 * The actual form lives in ./login-form.tsx as a client component.
 */

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import LoginForm from './login-form';

export const dynamic = 'force-dynamic';

// Whitelist `next` redirect targets so we don't open-redirect.
function sanitizeNext(next: string | undefined): string | null {
  if (!next) return null;
  if (!next.startsWith('/')) return null;
  if (next.startsWith('//')) return null;
  return next;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: { next?: string; error?: string };
}) {
  const next  = sanitizeNext(searchParams?.next);
  const error = searchParams?.error || null;

  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user) {
    // Already authenticated — skip the login UI entirely. Honor `next` so deep
    // links (cli-auth, install, etc.) land where the user expected.
    redirect(next || '/skills');
  }

  return <LoginForm initialError={error} initialNext={next} />;
}

export const metadata = {
  title: 'Sign in — Implexa',
};
