/**
 * /onboarding/role — second step of new-user flow.
 *
 * Comes after the workspace provision step (Plan A picker). User selects
 * what they spend most of their time doing → we auto-fork 5-10 relevant
 * Playbooks into their org so they land on /skills with a library that
 * feels personal, not empty.
 *
 * Users who joined an existing org skip this step entirely — they
 * inherit the team's library.
 */

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { ROLE_PACKS } from '@/lib/role-packs';
import RolePickerClient from './picker-client';
import { Logo } from '@/components/logo';

export const dynamic = 'force-dynamic';

export default async function RolePickerPage() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) redirect('/login');

  // Need an org assigned (provision must have run first)
  const { data: profile } = await supabase
    .from('users').select('id, organization_id, display_name')
    .eq('id', session.user.id).maybeSingle();
  if (!profile?.organization_id) redirect('/onboarding');

  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-3xl">
        <header className="text-center mb-10">
          <div className="mb-4 flex justify-center"><Logo height={18} /></div>
          <h1 className="text-3xl font-semibold tracking-tight text-ink-50">
            {profile.display_name ? `One quick thing, ${profile.display_name.split(' ')[0]}` : 'One quick thing'}
          </h1>
          <p className="text-ink-300 text-sm mt-3 max-w-xl mx-auto">
            What do you spend most of your time doing? We&apos;ll set up a starter set of
            agents tailored to your role — turn them on, run them, and tweak them to fit
            how you actually work.
          </p>
        </header>

        <RolePickerClient jwt={session.access_token} roles={ROLE_PACKS} />

        <footer className="text-center text-xs text-ink-400 mt-8">
          You can pick another role later — or build your own agents from scratch.
        </footer>
      </div>
    </main>
  );
}

export const metadata = {
  title: 'Pick your role — Implexa',
};
