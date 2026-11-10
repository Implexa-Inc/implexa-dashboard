/**
 * /coach — sign up to train Implexa agents.
 *
 * Linked from the welcome email. Signed-in only, so the email comes from the
 * session and is never typed. Answers go to POST /api/v2/coach-interest
 * (coach_interest, backend migration 0561); the team reads them to reach out.
 * Submitting grants nothing: it is an outreach list.
 */

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { callBackend } from '@/lib/api';
import { Logo } from '@/components/logo';
import CoachForm, { type CoachInterest } from './coach-form';

export const dynamic = 'force-dynamic';

export default async function CoachPage() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) redirect('/login?next=/coach');

  // A failed read is not "no answers yet": say so instead of showing a blank
  // form that looks like nothing was saved.
  let saved: CoachInterest | null = null;
  let readFailed = false;
  try {
    const r = await callBackend('/api/v2/coach-interest', { jwt: session.access_token });
    saved = r?.interest ?? null;
  } catch {
    readFailed = true;
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-lg">
        <div className="mb-6"><Logo height={18} /></div>
        <h1 className="text-3xl font-semibold tracking-tight mb-3 text-ink-50">Train agents with Implexa</h1>
        <p className="text-ink-300 text-sm mb-3">
          We&apos;re building agents that do long, skilled work like video production, trained by people who are great at it.
          Coaches earn a share of the revenue each time customers use the agents they train.
        </p>
        <p className="text-ink-300 text-sm mb-8">
          We launch in early January. Tell us about your craft and we&apos;ll reach out before then.
        </p>
        <CoachForm jwt={session.access_token} email={session.user.email ?? ''} saved={saved} readFailed={readFailed} />
      </div>
    </main>
  );
}

export const metadata = {
  title: 'Train agents with Implexa',
};
