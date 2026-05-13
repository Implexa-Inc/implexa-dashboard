/**
 * Plan A onboarding — the "8 members from your org already use Implexa, join
 * them or create a separate workspace?" picker.
 *
 * Renders server-side: looks up the suggestion, then a Client Component
 * does the provisioning RPC call when the user picks.
 */

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { callBackend } from '@/lib/api';
import OnboardingPicker from './picker';

export const dynamic = 'force-dynamic';

export default async function OnboardingPage({ searchParams }: { searchParams?: { next?: string } }) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) redirect('/login');

  const email = session.user.email!;
  let suggestion: { organizationId: string; organizationName: string; memberCount: number } | null = null;

  try {
    const r = await callBackend(`/api/v2/auth/org-suggestion?email=${encodeURIComponent(email)}`, { jwt: session.access_token });
    suggestion = r.suggestion;
  } catch (_) { /* no suggestion is fine */ }

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <h1 className="text-3xl font-semibold tracking-tight mb-2">Welcome to Implexa</h1>
        <p className="text-ink-500 text-sm mb-8">One last step — set up your workspace.</p>

        <OnboardingPicker
          jwt={session.access_token}
          email={email}
          displayName={session.user.user_metadata?.display_name || session.user.user_metadata?.name || email.split('@')[0]}
          suggestion={suggestion}
          next={typeof searchParams?.next === 'string' && searchParams.next.startsWith('/') ? searchParams.next : null}
        />
      </div>
    </main>
  );
}
