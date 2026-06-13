/**
 * /onboarding/proficiency — asked FIRST among the personal onboarding steps
 * (right after the workspace picker, before role). How comfortable the user is
 * with Claude Code / Codex, so Implexa can be more hands-on with novice and
 * beginner users and lighter-touch with pros. Stored on the user (migration
 * 0076) via POST /api/v2/me/proficiency.
 */

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import ProficiencyPicker from './picker-client';
import { Logo } from '@/components/logo';

export const dynamic = 'force-dynamic';

export default async function ProficiencyPage({ searchParams }: { searchParams?: { next?: string } }) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) redirect('/login');

  // Workspace must be provisioned first.
  const { data: profile } = await supabase
    .from('users').select('id, organization_id, display_name')
    .eq('id', session.user.id).maybeSingle();
  if (!profile?.organization_id) redirect('/onboarding');

  const next = typeof searchParams?.next === 'string' && searchParams.next.startsWith('/')
    ? searchParams.next
    : '/onboarding/role';

  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-2xl">
        <header className="text-center mb-10">
          <div className="mb-4 flex justify-center"><Logo height={18} /></div>
          <h1 className="text-3xl font-semibold tracking-tight text-ink-50">
            How comfortable are you with Claude Code or Codex?
          </h1>
          <p className="text-ink-300 text-sm mt-3 max-w-xl mx-auto">
            No wrong answer , it just tells us how much to do for you versus get
            out of your way.
          </p>
        </header>

        <ProficiencyPicker jwt={session.access_token} next={next} />
      </div>
    </main>
  );
}

export const metadata = { title: 'Your experience — Implexa' };
