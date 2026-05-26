'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { callBackend } from '@/lib/api';

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

export default function DataRightsForm({ initial }: { initial: Snapshot }) {
  const router = useRouter();
  const supabase = createClient();

  const [tool,      setTool]      = useState(initial.consent.tool_inventory_optin);
  const [outcome,   setOutcome]   = useState(initial.consent.outcome_tracking_optin);
  const [signature, setSignature] = useState(initial.consent.work_signature_optin);

  const [saving,   setSaving]   = useState(false);
  const [savedAt,  setSavedAt]  = useState<string | null>(null);
  const [saveErr,  setSaveErr]  = useState<string | null>(null);

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleted,  setDeleted]  = useState<number | null>(null);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const dirty =
    tool      !== initial.consent.tool_inventory_optin   ||
    outcome   !== initial.consent.outcome_tracking_optin ||
    signature !== initial.consent.work_signature_optin;

  async function save() {
    setSaveErr(null); setSavedAt(null); setSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const jwt = session?.access_token;
      await callBackend('/api/v2/data-rights/me/consent', {
        jwt,
        method: 'POST',
        body: {
          tool_inventory_optin:   tool,
          outcome_tracking_optin: outcome,
          work_signature_optin:   signature,
        },
      });
      setSavedAt(new Date().toLocaleTimeString());
      startTransition(() => router.refresh());
    } catch (err) {
      setSaveErr(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function deleteAll() {
    setDeleteErr(null); setDeleting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const jwt = session?.access_token;
      const r = await callBackend('/api/v2/data-rights/me', {
        jwt, method: 'DELETE',
      });
      setDeleted(r?.deleted ?? 0);
      setConfirmingDelete(false);
      startTransition(() => router.refresh());
    } catch (err) {
      setDeleteErr(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Three toggles */}
      <section className="card">
        <h2 className="text-base font-medium text-ink-50 mb-1">Consent</h2>
        <p className="text-xs text-ink-300 mb-4 leading-relaxed">
          The two default-on flags are low-sensitivity and needed for useful recommendations.
          Cohort matching is the strict opt-in for the SkillRank cohort algorithm.
        </p>

        <div className="space-y-4">
          <Toggle
            label="Track installed tools"
            description="Your MCP servers + plugins. Helps recommend skills you can actually run."
            checked={tool}
            onChange={setTool}
            badge="Default on"
          />
          <Toggle
            label="Track skill outcomes"
            description="Did the recommended skill solve your task? A boolean per apply, no payload contents."
            checked={outcome}
            onChange={setOutcome}
            badge="Default on"
          />
          <Toggle
            label="Enable cohort matching"
            description="Share anonymized session signatures (hashed user id, rotating monthly salt) so the recommender learns from users with similar work patterns. Recommendations get noticeably better, but only with your explicit yes."
            checked={signature}
            onChange={setSignature}
            badge="Default off"
            badgeWarn
          />
        </div>

        <div className="flex items-center gap-3 mt-6">
          <button
            type="button"
            onClick={save}
            disabled={!dirty || saving}
            className="btn-primary"
          >
            {saving ? 'Saving…' : 'Save preferences'}
          </button>
          {savedAt && !dirty && <span className="text-xs text-success-700 dark:text-success-400">✓ Saved at {savedAt}</span>}
          {saveErr && <span className="text-xs text-red-600">{saveErr}</span>}
        </div>

        {initial.consent.optin_recorded_at && (
          <p className="text-[11px] text-ink-500 mt-3">
            Last updated: {new Date(initial.consent.optin_recorded_at).toLocaleString()}
          </p>
        )}
      </section>

      {/* Stats panel */}
      <section className="card">
        <h2 className="text-base font-medium text-ink-50 mb-1">What we&apos;ve stored about you</h2>
        <p className="text-xs text-ink-300 mb-4 leading-relaxed">{initial.notes.epoch}</p>

        <div className="grid grid-cols-2 gap-4">
          <Stat label="Work signatures" value={initial.stats.signature_count} hint="One row per signature write (rate-limited to ~1/5min per session)" />
          <Stat label="Distinct sessions" value={initial.stats.distinct_sessions} hint="Unique session ids across stored signatures" />
          <Stat label="Skill applies"    value={initial.stats.apply_events}    hint="Total inline applies (outcome tracking surface)" />
          <Stat label="Tools observed"   value={initial.stats.observed_tools.length} hint="Unique installed tool names captured" />
        </div>

        {initial.stats.observed_tools.length > 0 && (
          <details className="mt-4 text-xs text-ink-300">
            <summary className="cursor-pointer hover:text-ink-50">Show observed tool names</summary>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {initial.stats.observed_tools.map((t) => (
                <span key={t} className="inline-flex items-center px-1.5 py-0.5 rounded bg-ink-800 text-[11px] font-mono text-ink-200">
                  {t}
                </span>
              ))}
            </div>
          </details>
        )}
      </section>

      {/* Delete-all-my-data */}
      <section className="card !border-red-500/20">
        <h2 className="text-base font-medium text-ink-50 mb-1">Delete all my signature data</h2>
        <p className="text-xs text-ink-300 mb-4 leading-relaxed">
          Permanently removes every <code className="text-[11px] bg-ink-800 px-1 py-0.5 rounded">user_work_signatures</code> row
          derivable from your user id, across every salt epoch we still know about.
          Does not affect your skill apply log (separate retention) or your account.
        </p>

        {deleted !== null && (
          <div className="text-xs text-success-700 dark:text-success-400 mb-3">
            ✓ Deleted {deleted} signature row{deleted === 1 ? '' : 's'}.
          </div>
        )}
        {deleteErr && (
          <div className="text-xs text-red-600 mb-3">{deleteErr}</div>
        )}

        {!confirmingDelete ? (
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            className="text-xs text-red-600 hover:underline"
          >
            Delete all my signatures →
          </button>
        ) : (
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={deleteAll}
              disabled={deleting}
              className="btn-primary !bg-red-600 hover:!bg-red-700 !text-white"
            >
              {deleting ? 'Deleting…' : 'Yes, delete everything'}
            </button>
            <button
              type="button"
              onClick={() => setConfirmingDelete(false)}
              disabled={deleting}
              className="text-xs text-ink-400 hover:text-ink-50"
            >
              Cancel
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

function Toggle({
  label, description, checked, onChange, badge, badgeWarn,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (b: boolean) => void;
  badge?: string;
  badgeWarn?: boolean;
}) {
  return (
    <label className="flex items-start gap-3 cursor-pointer group">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 h-4 w-4 rounded border-ink-600 text-brand-500 focus:ring-brand-500"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-ink-50">{label}</span>
          {badge && (
            <span className={`text-[10px] uppercase tracking-wider font-bold rounded px-1.5 py-0.5
              ${badgeWarn
                ? 'bg-amber-400/20 text-amber-700 dark:text-amber-400'
                : 'bg-ink-700 text-ink-300'}`}>
              {badge}
            </span>
          )}
        </div>
        <p className="text-xs text-ink-300 mt-0.5 leading-relaxed">{description}</p>
      </div>
    </label>
  );
}

function Stat({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <div>
      <div className="text-2xl font-semibold text-ink-50">{value.toLocaleString()}</div>
      <div className="text-xs text-ink-300">{label}</div>
      <div className="text-[10px] text-ink-500 mt-0.5">{hint}</div>
    </div>
  );
}
