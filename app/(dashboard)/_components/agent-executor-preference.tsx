'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { callBackend } from '@/lib/api';

type Preference = 'auto' | 'claude' | 'codex';
const OPTIONS: Array<{ value: Preference; label: string; detail: string }> = [
  { value: 'auto', label: 'Auto', detail: 'Best ready engine by headroom, affinity, and delivery history.' },
  { value: 'claude', label: 'Claude', detail: 'Always use Claude when it is ready for the job.' },
  { value: 'codex', label: 'Codex', detail: 'Always use Codex when it is ready for the job.' },
];

export default function AgentExecutorPreference({ slug }: { slug: string }) {
  const supabase = createClient();
  const [value, setValue] = useState<Preference>('auto');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const data = await callBackend(`/api/v2/agents/${encodeURIComponent(slug)}/executor`, { jwt: session?.access_token });
        if (!cancelled && ['auto', 'claude', 'codex'].includes(data.executorPreference)) setValue(data.executorPreference as Preference);
      } catch { /* pre-migration backend: show safe Auto default */ }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [slug]); // eslint-disable-line react-hooks/exhaustive-deps

  async function choose(next: Preference) {
    const before = value; setValue(next); setSaving(true); setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      await callBackend(`/api/v2/agents/${encodeURIComponent(slug)}/executor`, {
        jwt: session?.access_token, method: 'POST', body: { executorPreference: next },
      });
    } catch (e) {
      setValue(before); setError(e instanceof Error ? e.message : 'Could not save the engine choice.');
    } finally { setSaving(false); }
  }

  return (
    <section className="card max-w-2xl mb-6">
      <div className="flex items-start justify-between gap-3">
        <div><h2 className="text-base font-semibold text-ink-50">Execution engine</h2><p className="text-xs text-ink-400 mt-1">Auto is recommended. A pinned engine never silently becomes the other engine unless a capacity failure triggers the one permitted retry.</p></div>
        {saving && <span className="text-[11px] text-ink-500">Saving…</span>}
      </div>
      <div className="grid sm:grid-cols-3 gap-2 mt-4" aria-label="Execution engine preference">
        {OPTIONS.map((option) => (
          <button key={option.value} type="button" disabled={loading || saving} onClick={() => choose(option.value)}
            className={`text-left rounded-lg border p-3 transition-colors ${value === option.value ? 'border-brand-500/60 bg-brand-500/10' : 'border-ink-800 bg-ink-900/30 hover:border-ink-700'}`}>
            <span className="block text-sm font-medium text-ink-100">{option.label}</span>
            <span className="block text-[11px] text-ink-400 mt-1 leading-snug">{option.detail}</span>
          </button>
        ))}
      </div>
      {error && <p className="text-xs text-rose-400 mt-3">{error}</p>}
    </section>
  );
}
