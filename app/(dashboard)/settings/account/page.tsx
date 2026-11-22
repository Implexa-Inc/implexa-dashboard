import PageHeader from '@/components/page-header';
/**
 * /settings/account — basic account self-service.
 *   - Change display name (instant — writes to public.users)
 *   - Change email (Supabase confirmation flow — sends email to NEW address)
 */

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { readUserProfile } from '@/lib/profile-read';
import AccountForm from './account-form';

export const dynamic = 'force-dynamic';

export default async function AccountSettingsPage() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) redirect('/login');

  const profile = await readUserProfile(supabase
    .from('users').select('id, email, display_name, created_at').eq('id', session.user.id));
  if (!profile) redirect('/onboarding');

  return (
    <section className="settings-page">
      <div className="settings-page-content">

        <PageHeader title="Profile">
          <p className="app-page-description">
            Update your display name + email address. Joined {new Date(profile.created_at).toLocaleDateString()}.
          </p>
        </PageHeader>

        <AccountForm
          currentEmail={profile.email}
          currentDisplayName={profile.display_name || ''}
        />
      </div>
    </section>
  );
}

export const metadata = {
  title: 'Profile — Tukido',
};
