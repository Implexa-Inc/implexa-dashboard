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
  searchParams?: { next?: string; invite?: string; intent?: string };
}) {
  const next        = sanitizeNext(searchParams?.next);
  const inviteToken = typeof searchParams?.invite === 'string' ? searchParams.invite : null;
  // The build prompt carried from the website's hero box (?intent=). Free text;
  // the form stashes it in app-origin localStorage so it survives the auth
  // round-trip, then /overview turns it into a build run-request.
  const intent = typeof searchParams?.intent === 'string' ? searchParams.intent.slice(0, 500) : null;

  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user) {
    // Already authenticated — skip the signup UI. Honor `next` for deep links,
    // including invite tokens (route through /onboarding so it can accept the
    // invite before landing the user anywhere).
    if (inviteToken) {
      redirect(`/onboarding?invite=${encodeURIComponent(inviteToken)}`);
    }
    // Carry the build intent onward so /overview's consumer still gets it.
    redirect(intent ? `/overview?intent=${encodeURIComponent(intent)}` : (next || '/overview'));
  }

  return <SignupForm initialNext={next} initialInvite={inviteToken} initialIntent={intent} />;
}

export const metadata = {
  title: 'Create your account — Implexa',
};
