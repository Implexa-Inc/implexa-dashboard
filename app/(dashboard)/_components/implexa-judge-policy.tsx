'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { callBackend } from '@/lib/api';

/**
 * THREE modes, not two (2026-07-19). This component shipped knowing only
 * 'off' | 'every_run', which broke the release contract in two ways:
 *
 *   1. Turning Judge ON went straight to 'every_run', which is in the backend's
 *      AUTO_REPAIR_MODES — it queues repair continuations that SPEND the user's
 *      own Claude/Codex quota. Enabling a review feature must not silently opt
 *      someone into paid work.
 *   2. 'observe' rendered as OFF, because anything that was not 'every_run' was
 *      coerced to 'off'. Once a policy is observing, the switch would show
 *      "Off" while the backend actively reviewed every run.
 *
 * So: the switch is off ↔ OBSERVE (review only, never spends), and auto-repair
 * is a separate, explicit opt-in on top.
 */
type Mode = 'off' | 'observe' | 'every_run';

const KNOWN: Mode[] = ['off', 'observe', 'every_run'];
// An UNRECOGNISED mode must not silently read as 'off' — that is defect (2)
// above, generalised. Treat anything judging-but-unknown as on-but-review-only.
const asMode = (v: unknown): Mode => (KNOWN.includes(v as Mode) ? (v as Mode) : 'off');

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
        if (!cancelled) setMode(asMode(result.mode));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load verification settings.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [slug]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save(next: Mode) {
    setSaving(true); setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const result = await callBackend(`/api/v2/agents/${encodeURIComponent(slug)}/judge-policy`, {
        jwt: session?.access_token, method: 'POST', body: { mode: next },
      }) as { mode?: Mode };
      setMode(asMode(result.mode));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save. Try again.');
    } finally { setSaving(false); }
  }

  // ENABLING MEANS OBSERVE. Review only, nothing spent, nothing changed without
  // the user. Auto-repair is a deliberate second step, never a side effect of
  // switching a feature on.
  const setEnabled = (enabled: boolean) => save(enabled ? 'observe' : 'off');
  const setAutoRepair = (auto: boolean) => save(auto ? 'every_run' : 'observe');

  if (loading) return (
    <div className={`${compact ? '' : 'card max-w-2xl'} text-secondary text-ink-500`}>Loading Tukido Judge…</div>
  );

  // ON means judging at all — observe OR every_run. Reading only 'every_run' as
  // enabled is what made an observing policy display as "Off".
  const enabled = mode === 'observe' || mode === 'every_run';
  const autoRepair = mode === 'every_run';
  return (
    <section className={compact ? 'rounded-lg border border-ink-800 bg-ink-900/30 px-3 py-3' : 'card max-w-2xl'} aria-label="Tukido Judge">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className={`${compact ? 'text-ui' : 'text-base'} font-semibold text-ink-50`}>Tukido Judge</h2>
            <span className="text-secondary uppercase tracking-wide rounded border border-violet-500/30 bg-violet-500/10 px-1.5 py-0.5 text-state-review">Optional</span>
          </div>
          {/* The old copy promised automatic fixing unconditionally. That is only
              true in every_run; in observe the Judge reviews and reports and
              changes nothing. Describing work the feature will not do is the same
              class of lie as an all-clear over an unread source. */}
          <p className="text-secondary text-ink-400 mt-1 leading-relaxed">An independent AI reviews the result. Repairs are a separate choice.</p>
          <details className="mt-2 text-secondary text-ink-500"><summary>How reviews work</summary>
          <p className="text-reading text-ink-400 mt-1 max-w-xl">
            After every run, a fresh AI session checks the original request, agent criteria, memory, feedback, and actual artifacts. It reports what it finds — nothing is changed and nothing is re-run unless you turn on automatic repair below.
          </p>
          <p className="text-reading text-ink-500 mt-1.5 ">
            Tukido prefers the other engine (Claude reviews Codex, or Codex reviews Claude); if it isn&apos;t ready, a new session on the same engine reviews it. Missing inputs, new permissions, approvals, and consequential actions come back to you instead of being guessed or repeated. Reviews and repairs use your own subscriptions and stay separate from evidence-based “Verified complete.”
          </p>
          </details>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          disabled={saving}
          onClick={() => setEnabled(!enabled)}
          className={`relative mt-0.5 h-6 w-11 flex-none rounded-full transition-colors disabled:opacity-50 ${enabled ? 'bg-emerald-500' : 'bg-ink-700'}`}
        >
          {/* left-0 is REQUIRED, not decorative. Without a horizontal anchor an
              absolutely-positioned element falls back to its STATIC position, and a
              <button> centers its content — so the knob started mid-track and
              translate-x-5 shoved it past the right edge. Off looked half-on, and on
              overflowed the pill. Anchor left, then translate from there. */}
          <span className={`absolute left-0 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
          <span className="sr-only">{enabled ? 'Turn off Tukido Judge' : 'Add Tukido Judge'}</span>
        </button>
      </div>
      <div className="mt-2 flex items-center gap-2 text-secondary">
        <span className={enabled ? 'text-state-ok' : 'text-ink-500'}>
          {saving ? 'Saving…'
            : autoRepair ? '✓ Reviews every run and safely repairs what it can'
            : enabled ? '✓ Reviews every run and reports back'
            : 'Off'}
        </span>
        {error && <span className="text-state-fail">{error}</span>}
      </div>

      {/* AUTO-REPAIR IS A SEPARATE, EXPLICIT CHOICE. It spends the user's own
          Claude/Codex subscription re-running work, so it may never ride along
          with simply switching reviews on. */}
      {enabled && (
        <label className="mt-3 flex items-start gap-2 text-ui text-ink-400 cursor-pointer">
          <input
            type="checkbox"
            checked={autoRepair}
            disabled={saving}
            onChange={(e) => setAutoRepair(e.target.checked)}
            className="mt-0.5 flex-none"
          />
          <span>
            Also let Tukido fix what it safely can and re-check the result — up to two repair passes.
            <span className="block text-ink-500 mt-0.5">
              Repairs re-run your agent on your own subscription. Missing inputs, new permissions, approvals, and consequential actions always come back to you instead.
            </span>
          </span>
        </label>
      )}
    </section>
  );
}
