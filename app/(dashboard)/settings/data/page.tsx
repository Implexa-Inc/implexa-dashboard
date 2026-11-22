import PageHeader from '@/components/page-header';
/**
 * /settings/data — SkillRank data + consent management.
 *
 * The transparency surface for the SkillRank phase A privacy promise.
 * Renders:
 *   - current consent state (the three toggles)
 *   - "what we've stored about you" counts (current salt epoch only)
 *   - delete-all-my-data button
 *
 * SSR fetches the snapshot from the backend; the form widget is a
 * client component that PUTs updates back through the same route. Same
 * pattern as /settings/account (server fetch, client form).
 */

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { callBackend } from '@/lib/api';
import DataRightsForm from './data-rights-form';

export const dynamic = 'force-dynamic';

type Snapshot = {
  consent: {
    tool_inventory_optin:   boolean;
    outcome_tracking_optin: boolean;
    work_signature_optin:   boolean;
    optin_recorded_at:      string | null;
  };
  stats: {
    signature_count:   number;
    distinct_sessions: number;
    observed_tools:    string[];
    apply_events:      number;
  };
  notes: { epoch: string };
};

export default async function DataSettingsPage() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) redirect('/login');

  let snapshot: Snapshot | null = null;
  let loadError: string | null = null;
  try {
    snapshot = await callBackend('/api/v2/data-rights/me', { jwt: session.access_token });
  } catch (err) {
    loadError = err instanceof Error ? err.message : 'Failed to load preferences';
  }

  return (
    <section className="settings-page">
      <div className="settings-page-content">

        <PageHeader title="Data & privacy">
          <p className="text-reading app-page-description">
            Tukido learns from how you work to recommend better skills over time.
            This is the data + consent control surface. You can change anything here at any time.
          </p>
        </PageHeader>

        {loadError ? (
          <div className="card !border-red-500/30">
            <p className="text-reading text-state-fail">Could not load your preferences: {loadError}</p>
            <p className="text-secondary text-ink-400 mt-2">If this persists, email support@implexa.ai.</p>
          </div>
        ) : snapshot ? (
          <DataRightsForm initial={snapshot} />
        ) : null}

        <section className="card mt-8">
          <h2 className="text-base font-medium text-ink-50 mb-2">The privacy promise</h2>
          <p className="text-reading text-ink-300 ">
            Tool inventory + outcome tracking default on (low-sensitivity, needed for any useful recommendations).
            Cohort matching defaults off (more sensitive, requires explicit yes). Prompts that don&apos;t match a
            skill are discarded server-side; that promise hasn&apos;t changed. Signatures are stored under a hash
            of your user id with a salt that rotates monthly, so older data cannot be re-linked to you.
          </p>
        </section>
      </div>
    </section>
  );
}

export const metadata = {
  title: 'Data & privacy — Tukido',
};
