'use client';

/**
 * <AgentSetupCard /> — the agent's config interview, in the dashboard.
 *
 * Generated agents declare user-specific questions (config_schema): "which Drive
 * folder?", "how aggressive a cut?". The agent used to ask these interactively
 * in Claude Code, which stalls an unattended run. Answer them HERE instead;
 * apply_workflow injects the saved answers, and Run now also threads them into
 * the prefilled prompt — so the agent runs without stopping to ask.
 *
 * Self-fetches GET /api/v2/agents/:slug/setup and saves via POST. Renders
 * nothing when the agent declares no questions.
 */

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { callBackend } from '@/lib/api';

type Field = { key: string; question: string; kind: 'text' | 'choice'; options?: string[] };

// Does this text question ask for an email? (so we can default it to the user's
// login email). Matches "email" / "e-mail" in the question or the field key.
function isEmailQ(f: Field): boolean {
  return /e-?mail/i.test(`${f.question} ${f.key}`);
}
type Setup = {
  schema: Field[];
  answers: Record<string, string>;
  missing: Field[];
  complete: boolean;
  needs_setup: boolean;
};

export default function AgentSetupCard({ slug, source = 'generated' }: { slug: string; source?: string }) {
  const supabase = createClient();
  const [setup, setSetup] = useState<Setup | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Which choice fields are in "type your own" mode (none of the presets fit).
  const [otherMode, setOtherMode] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await callBackend(`/api/v2/agents/${encodeURIComponent(slug)}/setup?source=${encodeURIComponent(source)}`, { jwt: session?.access_token });
        if (cancelled) return;
        const s = res as Setup;
        setSetup(s);
        const a = { ...(s.answers || {}) };
        // Pre-fill an empty email question with the user's login email (editable),
        // so "where should this go?" defaults to them instead of a blank field.
        const email = session?.user?.email || '';
        if (email) {
          for (const f of s.schema) {
            if (f.kind === 'text' && isEmailQ(f) && !(a[f.key] ?? '').toString().trim()) a[f.key] = email;
          }
        }
        setValues(a);
        // A saved choice answer that isn't one of the presets is a custom value:
        // start that field in "type your own" mode so the typed answer shows.
        const om: Record<string, boolean> = {};
        for (const f of s.schema) {
          if (f.kind === 'choice' && a[f.key] && !(f.options || []).includes(a[f.key])) om[f.key] = true;
        }
        setOtherMode(om);
      } catch {
        if (!cancelled) setSetup({ schema: [], answers: {}, missing: [], complete: true, needs_setup: false });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [slug, source]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading || !setup || setup.schema.length === 0) return null; // no questions -> nothing to show

  async function save() {
    setSaving(true); setError(null); setSaved(false);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await callBackend(`/api/v2/agents/${encodeURIComponent(slug)}/setup`, {
        jwt: session?.access_token, method: 'POST', body: { answers: values, source },
      });
      setSetup(res as Setup);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save. Try again.');
    } finally {
      setSaving(false);
    }
  }

  const allFilled = setup.schema.every((f) => (values[f.key] ?? '').toString().trim() !== '');
  const inputCls = 'w-full bg-ink-900 border border-ink-700 rounded-md text-sm px-3 py-2 text-ink-100 placeholder:text-ink-600 focus:border-brand-500/60 focus:outline-none';

  return (
    <div className="card max-w-2xl">
      <div className="flex items-start justify-between gap-3 mb-1">
        <h2 className="text-base font-semibold text-ink-50">Questions this agent needs answered</h2>
        {setup.needs_setup
          ? <span className="flex-none text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border border-amber-500/50 text-amber-700 dark:text-amber-300">{setup.missing.length} to answer</span>
          : <span className="flex-none text-[11px] text-emerald-600 dark:text-emerald-400">✓ all set</span>}
      </div>
      <p className="text-xs text-ink-400 mb-4 leading-snug">
        Answer once here and the agent runs on its own — it won’t stop to ask in Claude Code.
      </p>

      <div className="space-y-4">
        {setup.schema.map((f) => (
          <div key={f.key}>
            <label className="block text-sm text-ink-200 mb-1.5">{f.question}</label>
            {f.kind === 'choice' && f.options && f.options.length > 0 ? (
              <div className="space-y-2">
                <select
                  value={otherMode[f.key] ? '__other__' : (values[f.key] ?? '')}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === '__other__') {
                      setOtherMode((m) => ({ ...m, [f.key]: true }));
                      setValues((v) => ({ ...v, [f.key]: '' })); // wait for typed input
                    } else {
                      setOtherMode((m) => ({ ...m, [f.key]: false }));
                      setValues((v) => ({ ...v, [f.key]: val }));
                    }
                  }}
                  className={inputCls}
                >
                  <option value="">Choose…</option>
                  {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
                  <option value="__other__">Other (type your own)…</option>
                </select>
                {otherMode[f.key] && (
                  <input
                    type="text"
                    value={values[f.key] ?? ''}
                    onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                    placeholder="Type your answer"
                    autoFocus
                    className={inputCls}
                  />
                )}
              </div>
            ) : (
              <>
                <input
                  type="text"
                  value={values[f.key] ?? ''}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  placeholder={isEmailQ(f) ? 'you@example.com' : 'Type your answer'}
                  className={inputCls}
                />
                {isEmailQ(f) && !(setup.answers[f.key] ?? '').toString().trim() && (
                  <p className="text-[11px] text-ink-500 mt-1">Defaulted to your login email — edit if it should go somewhere else.</p>
                )}
              </>
            )}
          </div>
        ))}
      </div>

      <div className="mt-5 flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving || !allFilled}
          className={saving || !allFilled ? 'btn-outline text-sm px-4 py-2 opacity-50 cursor-not-allowed' : 'btn-success text-sm px-4 py-2'}
          title={allFilled ? 'Save these answers' : 'Answer every question first'}
        >
          {saving ? 'Saving…' : 'Save answers'}
        </button>
        {saved && <span className="text-xs text-emerald-600 dark:text-emerald-400">✓ Saved. The agent will use these on its next run.</span>}
        {error && <span className="text-xs text-rose-600 dark:text-rose-400">{error}</span>}
      </div>
    </div>
  );
}
