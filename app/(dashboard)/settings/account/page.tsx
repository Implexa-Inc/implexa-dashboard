/**
 * /settings/account — basic account self-service.
 *   - Change display name (instant — writes to public.users)
 *   - Change email (Supabase confirmation flow — sends email to NEW address)
 */

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import AccountForm from './account-form';

export const dynamic = 'force-dynamic';

export default async function AccountSettingsPage() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) redirect('/login');

  const { data: profile } = await supabase
    .from('users').select('id, email, display_name, created_at')
    .eq('id', session.user.id).maybeSingle();
  if (!profile) redirect('/onboarding');

  return (
    <main className="min-h-screen px-4 py-12">
      <div className="max-w-2xl mx-auto">
        <nav className="text-xs text-ink-500 mb-4">
          <Link href="/settings" className="hover:underline">← Settings</Link>
        </nav>

        <header className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight text-ink-50">Account</h1>
          <p className="text-sm text-ink-300 mt-1">
            Update your display name + email address. Joined {new Date(profile.created_at).toLocaleDateString()}.
          </p>
        </header>

        <AccountForm
          currentEmail={profile.email}
          currentDisplayName={profile.display_name || ''}
        />
      </div>
    </main>
  );
}

export const metadata = {
  title: 'Account — Implexa',
};
