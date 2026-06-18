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

type Field = { key: string; question: string; kind: 'text' | 'choice' | 'file'; options?: string[] };

// The desktop app exposes a native file picker; a plain browser cannot read a
// local path, so a 'file' question degrades to a path field there.
type DesktopBridge = { pickFile?: (opts?: { accept?: string }) => Promise<{ ok: boolean; path?: string }> };
function desktopBridge(): DesktopBridge | null {
  if (typeof window === 'undefined') return null;
  const b = (window as unknown as { implexaDesktop?: DesktopBridge }).implexaDesktop;
  return b && typeof b.pickFile === 'function' ? b : null;
}

// Questions we can pre-fill from system context, so the user starts from a
// sensible default instead of a blank field (always editable).
function isEmailQ(f: Field): boolean {
  return /e-?mail/i.test(`${f.question} ${f.key}`);
}
function isTimezoneQ(f: Field): boolean {
  return /time\s?-?zone|\btz\b/i.test(`${f.question} ${f.key}`);
}
// The suggested default for a field from the browser context. '' = no suggestion.
function suggestedDefault(f: Field, ctx: { email: string; timezone: string }): string {
  if (isEmailQ(f)) return ctx.email;
  if (isTimezoneQ(f)) return ctx.timezone;
  return '';
}
function defaultHint(f: Field): string | null {
  if (isEmailQ(f)) return 'Defaulted to your login email — edit if it should go somewhere else.';
  if (isTimezoneQ(f)) return 'Detected from your system — edit if it should report on a different timezone.';
  return null;
}
type Setup = {
  schema: Field[];
  answers: Record<string, string>;
  /** The user's saved free-text standing note for this agent. Honored every run. */
  note?: string;
  missing: Field[];
  complete: boolean;
  needs_setup: boolean;
};

export default function AgentSetupCard({ slug, source = 'generated' }: { slug: string; source?: string }) {
  const supabase = createClient();
  const [setup, setSetup] = useState<Setup | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  // The agent's standing free-text note (saved; honored on every run).
  const [noteValue, setNoteValue] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Which choice fields are in "type your own" mode (none of the presets fit).
  const [otherMode, setOtherMode] = useState<Record<string, boolean>>({});
  // Brief highlight when Run surfaces the questions, so the eye lands here.
  const [flash, setFlash] = useState(false);
  const [inDesktop, setInDesktop] = useState(false);
  useEffect(() => { setInDesktop(!!desktopBridge()); }, []);
  useEffect(() => {
    const onFlash = () => { setFlash(true); setTimeout(() => setFlash(false), 1800); };
    window.addEventListener('implexa-flash-setup', onFlash);
    return () => window.removeEventListener('implexa-flash-setup', onFlash);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await callBackend(`/api/v2/agents/${encodeURIComponent(slug)}/setup?source=${encodeURIComponent(source)}`, { jwt: session?.access_token });
        if (cancelled) return;
        const s = res as Setup;
        setSetup(s);
        setNoteValue(s.note || '');
        const a = { ...(s.answers || {}) };
        // Pre-fill unanswered questions we can infer from the browser (login
        // email, system timezone), editable, so the user starts from a sensible
        // default instead of a blank field. Never overrides a saved answer.
        const ctx = {
          email: session?.user?.email || '',
          timezone: (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; } })(),
        };
        for (const f of s.schema) {
          if ((a[f.key] ?? '').toString().trim()) continue;
          const def = suggestedDefault(f, ctx);
          if (!def) continue;
          if (f.kind === 'text') a[f.key] = def;
          else if (f.kind === 'choice' && (f.options || []).includes(def)) a[f.key] = def; // pre-select if it's an option
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
        jwt: session?.access_token, method: 'POST', body: { answers: { ...values, __agent_note: noteValue.trim() }, source },
      });
      setSetup(res as Setup);
      setNoteValue((res as Setup).note || '');
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

  async function chooseFile(key: string) {
    const b = desktopBridge();
    if (!b?.pickFile) return;
    try {
      const r = await b.pickFile();
      if (r?.ok && r.path) setValues((v) => ({ ...v, [key]: r.path as string }));
    } catch { /* user cancelled / picker unavailable */ }
  }

  return (
    <div className={`card max-w-2xl transition-shadow ${flash ? 'ring-2 ring-amber-500/70 ring-offset-2 ring-offset-ink-950' : ''}`}>
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
            ) : f.kind === 'file' ? (
              // File input: in the desktop app, a native picker captures the
              // absolute path (like Claude's own file picker). In a plain browser
              // we cannot read local paths, so accept a typed path and tell the
              // user it's attached when it runs in Claude.
              <div className="space-y-1.5">
                {inDesktop && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => chooseFile(f.key)}
                      className="btn-outline text-xs px-3 py-1.5"
                    >
                      Choose file…
                    </button>
                    {values[f.key] ? (
                      <span className="text-xs text-ink-300 font-mono truncate max-w-[18rem]" title={values[f.key]}>
                        {values[f.key].split('/').pop()}
                      </span>
                    ) : (
                      <span className="text-xs text-ink-500">No file chosen</span>
                    )}
                  </div>
                )}
                <input
                  type="text"
                  value={values[f.key] ?? ''}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  placeholder={inDesktop ? 'Or paste a file path' : '/path/to/your/file (you can also attach it in Claude)'}
                  className={inputCls + ' font-mono text-xs'}
                />
                {!inDesktop && (
                  <p className="text-[11px] text-ink-500">
                    In your browser you can paste a path here; the file itself is attached when the agent runs in your Claude.
                  </p>
                )}
              </div>
            ) : (
              <>
                <input
                  type="text"
                  value={values[f.key] ?? ''}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  placeholder={isEmailQ(f) ? 'you@example.com' : isTimezoneQ(f) ? 'e.g. America/New_York' : 'Type your answer'}
                  className={inputCls}
                />
                {defaultHint(f) && !(setup.answers[f.key] ?? '').toString().trim() && (
                  <p className="text-[11px] text-ink-500 mt-1">{defaultHint(f)}</p>
                )}
              </>
            )}
          </div>
        ))}
      </div>

      <div className="mt-5">
        <label className="block text-sm font-medium text-ink-100 mb-1">
          Notes for this agent <span className="text-ink-500 font-normal">(optional)</span>
        </label>
        <p className="text-xs text-ink-400 mb-2 leading-snug">
          Standing instructions honored on <strong>every</strong> run (tone, things to avoid, what to emphasize). You can also tweak this in the Run-now pop-up.
        </p>
        <textarea
          value={noteValue}
          onChange={(e) => setNoteValue(e.target.value)}
          rows={3}
          placeholder="e.g. keep the b-roll punchy; never use stock-looking footage; aim for under 30s"
          className={inputCls + ' resize-y'}
        />
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
