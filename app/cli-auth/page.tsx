/**
 * /cli-auth — browser side of the RFC 8628 device-authorization flow.
 *
 * Entry point: the install script (curl ... install.sh | bash) prints a URL
 * like https://app.implexa.ai/cli-auth?code=ABCD-1234 and tries to auto-
 * open it. The user lands here and:
 *
 *   - If not logged in → bounce to /login?next=/cli-auth?code=...
 *     (they sign up or log in, then come right back)
 *   - If logged in but missing an organization → bounce to onboarding
 *   - If logged in + onboarded → see the verification code prominently +
 *     Approve / Deny buttons. Clicking Approve flips the session in the
 *     DB; the CLI's next poll mints an API key.
 *
 * After approval, this page shows "✓ Return to your terminal" and the
 * CLI takes over. No further action needed in the browser.
 *
 * Outside the (dashboard) group so it doesn't render the sidebar —
 * focused one-purpose screen like /login.
 */

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { callBackend } from '@/lib/api';
import { Logo } from '@/components/logo';
import CliAuthApproval from './cli-auth-approval';

export const dynamic = 'force-dynamic';

export default async function CliAuthPage({ searchParams }: { searchParams: { code?: string } }) {
  const rawCode = String(searchParams?.code || '').trim();

  // Whitelist the format we issue: XXXX-YYYY (8 alphanumeric chars + dash).
  // Reject anything else early — prevents URL fuzzing from reaching the API.
  const verificationCode = /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(rawCode) ? rawCode : '';

  if (!verificationCode) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4">
        <div className="max-w-md w-full text-center">
          <div className="mb-6 flex justify-center"><Logo height={20} /></div>
          <h1 className="text-2xl font-semibold text-ink-50 mb-3">Missing verification code</h1>
          <p className="text-ink-300 leading-relaxed">
            This page only works when opened from the install script (the URL needs to look like{' '}
            <code className="text-xs bg-ink-800 px-1 rounded">/cli-auth?code=ABCD-1234</code>).
          </p>
          <p className="text-ink-400 text-sm mt-6">
            Run <code className="text-xs bg-ink-800 px-1 rounded">curl -fsSL https://core.implexa.ai/install.sh | bash</code> in your terminal to start a fresh install.
          </p>
        </div>
      </main>
    );
  }

  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();

  // Not logged in → send them through /login (which supports ?next=) and
  // they'll bounce back here automatically after they log in / sign up.
  if (!session?.user) {
    redirect(`/login?next=${encodeURIComponent(`/cli-auth?code=${verificationCode}`)}`);
  }

  // Make sure they finished onboarding (have an organization). If not,
  // route through /onboarding which also supports the ?next= param.
  const { data: profile } = await supabase
    .from('users').select('id, email, organization_id').eq('id', session.user.id).maybeSingle();
  if (!profile || !profile.organization_id) {
    redirect(`/onboarding?next=${encodeURIComponent(`/cli-auth?code=${verificationCode}`)}`);
  }

  // Fetch session info from backend so we can show the user what they're
  // about to approve (status + expiry). Non-fatal if it fails — the
  // Approve button will surface a clear error on click.
  let sessionInfo: { status: string; expiresAt: string; createdAt: string } | null = null;
  try {
    sessionInfo = await callBackend(`/api/v2/cli-auth/session/${verificationCode}`, {
      jwt: session.access_token,
    });
  } catch (_) {
    // Pass null — client component handles the "session not found" state.
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-12">
      <div className="max-w-md w-full">
        <div className="mb-8 flex justify-center"><Logo height={20} /></div>
        <CliAuthApproval
          verificationCode={verificationCode}
          email={profile.email || ''}
          sessionInfo={sessionInfo}
          accessToken={session.access_token}
        />
      </div>
    </main>
  );
}

export const metadata = {
  title: 'Approve CLI login — Implexa',
};
