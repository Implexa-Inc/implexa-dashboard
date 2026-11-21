import PageHeader from '@/components/page-header';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import EnginesClient, { type EngineReport } from './engines-client';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'AI engines — Tukido' };

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
    <section className="settings-page">
      <div className="settings-page-content">
        <PageHeader title="AI engines">
          <p className="app-page-description">
            Claude and Codex are independent execution engines. Tukido can use either automatically, while each agent can be pinned to one in its Setup tab.
          </p>
        </PageHeader>
        <EnginesClient reports={reports} />
      </div>
    </section>
  );
}
