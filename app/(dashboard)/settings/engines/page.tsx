import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import EnginesClient, { type EngineReport } from './engines-client';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'AI engines — Implexa' };

export default async function EnginesPage() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) redirect('/login');

  let reports: EngineReport[] = [];
  try {
    const { data } = await supabase.from('user_execution_engines').select('*')
      .eq('user_id', session.user.id).order('last_seen_at', { ascending: false });
    reports = (data || []) as EngineReport[];
  } catch { /* migration may not be applied yet; cards still render as disconnected */ }

  return (
    <main className="min-h-screen px-4 py-12">
      <div className="max-w-4xl mx-auto">
        <Link href="/settings" className="text-xs text-brand-500 hover:underline">← Settings</Link>
        <header className="mt-2 mb-8">
          <h1 className="text-3xl font-semibold tracking-tight text-ink-50">AI engines</h1>
          <p className="text-sm text-ink-300 mt-1 max-w-2xl leading-relaxed">
            Claude and Codex are independent execution engines. Implexa can use either automatically, while each agent can be pinned to one in its Setup tab.
          </p>
        </header>
        <EnginesClient reports={reports} />
      </div>
    </main>
  );
}
