'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { callBackend } from '@/lib/api';

type Mode = 'off' | 'every_run';

export function ImplexaJudgePolicy({ slug, compact = false }: { slug: string; compact?: boolean }) {
  const supabase = createClient();
  const [mode, setMode] = useState<Mode>('off');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const result = await callBackend(`/api/v2/agents/${encodeURIComponent(slug)}/judge-policy`, { jwt: session?.access_token }) as { mode?: Mode };
        if (!cancelled) setMode(result.mode === 'every_run' ? 'every_run' : 'off');
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load verification settings.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [slug]); // eslint-disable-line react-hooks/exhaustive-deps

  async function setEnabled(enabled: boolean) {
    const next: Mode = enabled ? 'every_run' : 'off';
    setSaving(true); setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const result = await callBackend(`/api/v2/agents/${encodeURIComponent(slug)}/judge-policy`, {
        jwt: session?.access_token, method: 'POST', body: { mode: next },
      }) as { mode?: Mode };
      setMode(result.mode === 'every_run' ? 'every_run' : 'off');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save. Try again.');
    } finally { setSaving(false); }
  }

  if (loading) return (
    <div className={`${compact ? '' : 'card max-w-2xl'} text-xs text-ink-500`}>Loading Implexa Judge…</div>
  );

  const enabled = mode === 'every_run';
  return (
    <section className={compact ? 'rounded-lg border border-ink-800 bg-ink-900/30 px-3 py-3' : 'card max-w-2xl'} aria-label="Implexa Judge">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className={`${compact ? 'text-sm' : 'text-base'} font-semibold text-ink-50`}>Implexa Judge</h2>
            <span className="text-[10px] uppercase tracking-wide rounded border border-violet-500/30 bg-violet-500/10 px-1.5 py-0.5 text-violet-300">Optional</span>
          </div>
          <p className="text-xs text-ink-400 mt-1 leading-relaxed max-w-xl">
            After every run, a fresh AI session checks the original request, agent criteria, memory, feedback, and actual artifacts—then tells you what passed, what failed, and the smallest next step.
          </p>
          <p className="text-[11px] text-ink-500 mt-1.5 leading-relaxed">
            Implexa prefers the other engine (Claude reviews Codex, or Codex reviews Claude). If it isn&apos;t ready, a new session on the same engine reviews it. This uses your own subscription and is shown separately from evidence-based “Verified complete.”
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          disabled={saving}
          onClick={() => setEnabled(!enabled)}
          className={`relative mt-0.5 h-6 w-11 flex-none rounded-full transition-colors disabled:opacity-50 ${enabled ? 'bg-emerald-500' : 'bg-ink-700'}`}
        >
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
          <span className="sr-only">{enabled ? 'Turn off Implexa Judge' : 'Add Implexa Judge'}</span>
        </button>
      </div>
      <div className="mt-2 flex items-center gap-2 text-xs">
        <span className={enabled ? 'text-emerald-400' : 'text-ink-500'}>{saving ? 'Saving…' : enabled ? '✓ Reviews every run' : 'Off'}</span>
        {error && <span className="text-red-400">{error}</span>}
      </div>
    </section>
  );
}
