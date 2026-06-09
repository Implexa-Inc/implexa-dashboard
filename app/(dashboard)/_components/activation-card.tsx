'use client';

/**
 * <ActivationCard /> — the guided activation todo-list (ACTIVATION_JOURNEY.md).
 * One card, one row per step, one CTA per row. Steps the agent doesn't need are
 * already marked done/auto by the backend, so the user only ever sees what's
 * left. Plain language only (no "Bash" / "mcp__…"). Tier-2 permissions are the
 * one place we ask for a deliberate opt-in.
 *
 * Phase 3: renders the checklist + wires the link CTAs (Connections, Schedule)
 * and the local toggles (notifications, Tier-2 opt-in). The final POST /activate
 * lands next; the Activate button reflects readiness today.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { callBackend } from '@/lib/api';
import type { ActivationChecklist, ActivationStep, PermissionItem, PermissionTier } from '@/lib/activation';

// Defined here (not imported) because lib/activation.ts is server-only; a client
// component can take its TYPES (erased at compile) but not its runtime values.
const TIER_PRESENTATION: Record<PermissionTier, { label: string; classes: string }> = {
  0: { label: 'Auto',      classes: 'border-ink-700 text-ink-400' },
  1: { label: 'Heads-up',  classes: 'border-sky-500/40 text-sky-700 dark:text-sky-300' },
  2: { label: 'Your call', classes: 'border-amber-500/50 text-amber-700 dark:text-amber-300' },
};

function StatusDot({ status }: { status: ActivationStep['status'] }) {
  if (status === 'done' || status === 'auto') {
    return (
      <span className="flex-none mt-0.5 inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-xs">
        ✓
      </span>
    );
  }
  return <span className="flex-none mt-0.5 inline-flex w-5 h-5 rounded-full border-2 border-ink-600" aria-hidden />;
}

function PermissionList({ items, optIns, onToggle }: {
  items: PermissionItem[];
  optIns: Record<string, boolean>;
  onToggle: (group: string, on: boolean) => void;
}) {
  return (
    <ul className="mt-3 space-y-2 rounded-lg border border-ink-800 bg-ink-950/40 p-3">
      {items.map((it) => {
        const spec = TIER_PRESENTATION[it.tier];
        const isOptIn = it.tier === 2;
        return (
          <li key={it.group} className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm text-ink-100">{it.label}</span>
                <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border ${spec.classes}`}>{spec.label}</span>
              </div>
              {it.detail && <p className="text-xs text-ink-500 mt-0.5 leading-snug">{it.detail}</p>}
            </div>
            {isOptIn ? (
              <button
                type="button"
                onClick={() => onToggle(it.group, !optIns[it.group])}
                className={`flex-none text-xs font-medium rounded-md px-2.5 py-1 transition-colors ${
                  optIns[it.group]
                    ? 'bg-amber-500/20 text-amber-700 dark:text-amber-200'
                    : 'border border-ink-700 text-ink-400 hover:text-ink-200'
                }`}
              >
                {optIns[it.group] ? 'Allowed' : 'Allow'}
              </button>
            ) : (
              <span className="flex-none text-[11px] text-emerald-600 dark:text-emerald-400 mt-1">granted</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function StepRow({ step, optIns, onToggleOptIn }: {
  step: ActivationStep;
  optIns: Record<string, boolean>;
  onToggleOptIn: (group: string, on: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const isTodo = step.status === 'todo';

  // Resolve the CTA target/behavior per step.
  let cta: React.ReactNode = null;
  if (isTodo && step.cta) {
    if (step.id === 'permissions') {
      cta = <button type="button" onClick={() => setOpen((o) => !o)} className="btn-outline text-xs px-2.5 py-1">{open ? 'Hide' : step.cta}</button>;
    } else if (step.id === 'connections') {
      cta = <Link href="/connections" className="btn-outline text-xs px-2.5 py-1">{step.cta}</Link>;
    } else if (step.id === 'schedule') {
      cta = <Link href="/scheduled" className="btn-outline text-xs px-2.5 py-1">{step.cta}</Link>;
    } else {
      cta = <button type="button" className="btn-outline text-xs px-2.5 py-1">{step.cta}</button>;
    }
  }

  const items = (step.data?.items ?? []) as PermissionItem[];

  return (
    <li className="py-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <StatusDot status={step.status} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-ink-100">{step.title}</span>
              {step.status === 'auto' && <span className="text-[10px] uppercase tracking-wide text-ink-500">auto</span>}
            </div>
            <p className="text-xs text-ink-400 mt-0.5 leading-snug">{step.detail}</p>
          </div>
        </div>
        {cta && <div className="flex-none">{cta}</div>}
      </div>
      {step.id === 'permissions' && open && items.length > 0 && (
        <PermissionList items={items} optIns={optIns} onToggle={onToggleOptIn} />
      )}
    </li>
  );
}

const STATE_BADGE: Record<ActivationChecklist['state'], { label: string; classes: string }> = {
  created:         { label: 'Not activated', classes: 'bg-ink-800 text-ink-300' },
  activating:      { label: 'Activating',    classes: 'bg-sky-500/15 text-sky-700 dark:text-sky-300' },
  active:          { label: 'Active',        classes: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' },
  needs_attention: { label: 'Needs attention', classes: 'bg-amber-500/20 text-amber-700 dark:text-amber-300' },
};

export function ActivationCard({ checklist }: { checklist: ActivationChecklist }) {
  // Tier-2 opt-ins start off; the user must deliberately allow each one.
  const [optIns, setOptIns] = useState<Record<string, boolean>>({});
  const toggleOptIn = (group: string, on: boolean) => setOptIns((s) => ({ ...s, [group]: on }));

  const router = useRouter();
  const supabase = createClient();
  const [activating, setActivating] = useState(false);
  const [activated, setActivated] = useState(checklist.state === 'active');
  const [error, setError] = useState<string | null>(null);

  async function activate() {
    setError(null);
    setActivating(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const jwt = session?.access_token;
      await callBackend(`/api/v2/agents/${encodeURIComponent(checklist.slug)}/activate`, {
        jwt, method: 'POST', body: { optIns },
      });
      setActivated(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Activation failed. Try again.');
    } finally {
      setActivating(false);
    }
  }

  // Any unresolved Tier-2 opt-in blocks activation (on top of the backend's canActivate).
  const permStep = checklist.steps.find((s) => s.id === 'permissions');
  const tier2 = ((permStep?.data?.items ?? []) as PermissionItem[]).filter((i) => i.tier === 2);
  const allOptInsResolved = tier2.every((i) => optIns[i.group]);
  const ready = checklist.canActivate && allOptInsResolved && checklist.state !== 'active';
  const badge = STATE_BADGE[checklist.state];

  return (
    <div className="card max-w-2xl">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-ink-50 truncate">{checklist.name}</h1>
          {checklist.summary && <p className="text-sm text-ink-400 mt-1 leading-snug">{checklist.summary}</p>}
        </div>
        <span className={`flex-none text-xs font-medium rounded-full px-2.5 py-1 ${badge.classes}`}>{badge.label}</span>
      </div>

      {checklist.state !== 'active' && (
        <p className="text-xs text-ink-500 mb-1">
          {checklist.stepsLeft === 0 ? 'Ready to switch on.' : `${checklist.stepsLeft} step${checklist.stepsLeft === 1 ? '' : 's'} left`}
        </p>
      )}

      <ul className="divide-y divide-ink-800">
        {checklist.steps.map((s) => (
          <StepRow key={s.id} step={s} optIns={optIns} onToggleOptIn={toggleOptIn} />
        ))}
      </ul>

      <div className="mt-5 flex items-center gap-3">
        {checklist.state === 'active' || activated ? (
          <span className="text-sm text-emerald-600 dark:text-emerald-400">✓ Active — running on its schedule.</span>
        ) : (
          <>
            <button
              type="button"
              onClick={activate}
              disabled={!ready || activating}
              className={ready && !activating ? 'btn-success' : 'btn-outline opacity-50 cursor-not-allowed'}
              title={ready ? 'Switch this agent on' : 'Finish the steps above first'}
            >
              {activating ? 'Activating…' : 'Activate'}
            </button>
            {error ? (
              <span className="text-xs text-rose-600 dark:text-rose-400">{error}</span>
            ) : !ready && tier2.length > 0 && !allOptInsResolved ? (
              <span className="text-xs text-ink-500">Allow the highlighted permission first.</span>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
