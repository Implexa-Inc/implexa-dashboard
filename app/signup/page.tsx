/**
 * /signup — server component wrapper.
 *
 * Mirrors /login: gates against the already-logged-in case by checking
 * the session server-side and redirecting if present. A signed-in user
 * landing here usually means they followed a stale link or pasted a
 * sign-up URL out of context — we honor `next` so the device-auth /
 * deep-link chains still work.
 *
 * If they truly want a different account, they should sign out first
 * (the /skills sidebar has a Sign out link).
 *
 * The actual form lives in ./signup-form.tsx as a client component.
 */

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import SignupForm from './signup-form';

export const dynamic = 'force-dynamic';

function sanitizeNext(next: string | undefined): string | null {
  if (!next) return null;
  if (!next.startsWith('/')) return null;
  if (next.startsWith('//')) return null;
  return next;
}

export default async function SignupPage({
  searchParams,
}: {
  searchParams?: { next?: string; invite?: string };
}) {
  const next        = sanitizeNext(searchParams?.next);
  const inviteToken = typeof searchParams?.invite === 'string' ? searchParams.invite : null;

  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user) {
    // Already authenticated — skip the signup UI. Honor `next` for deep links,
    // including invite tokens (route through /onboarding so it can accept the
    // invite before landing the user anywhere).
    if (inviteToken) {
      redirect(`/onboarding?invite=${encodeURIComponent(inviteToken)}`);
    }
    redirect(next || '/skills');
  }

  return <SignupForm initialNext={next} initialInvite={inviteToken} />;
}

export const metadata = {
  title: 'Create your account — Implexa',
};
