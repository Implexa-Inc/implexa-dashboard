'use client';

/**
 * <ScheduleRow /> — one row in the scheduled-skills manage list.
 *
 * Client component because the action buttons (pause/resume/delete) need
 * to fire fetch calls + show optimistic state. The page.tsx that renders
 * this is a server component; it streams the schedule data in and we
 * handle interactivity here.
 *
 * Mutation path: direct supabase client write (RLS-scoped to caller). No
 * backend round-trip needed for simple status toggle + delete. Mirrors
 * the install-controls.tsx pattern for the same reason — the row is
 * owned by the user, RLS enforces isolation, the backend doesn't add
 * value here. Destination edits (Slack URL etc) still need to go
 * through /implexa:schedule re-invocation because they trigger
 * validation + Slack URL format checks.
 */

import { useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { looksOverdue } from '@/lib/routine-status';
import { RemoteSafetyBadge } from '../_components/remote-safety-badge';
import type { RemoteSafety } from '@/lib/remote-safety';

// When this routine's slug matches a workflow in the catalog, the parent passes
// the catalog source (to deep-link /workflows) and the coarse remote verdict.
type RoutineWorkflow = { source: string; safety: RemoteSafety };

type ScheduledSkill = {
  id:               string;
  skill_id:         string;
  skill_slug:       string;
  schedule_nl:      string;
  cron_expression:  string;
  timezone:         string;
  destination:      { type: 'dashboard' | 'slack-webhook' | 'slack-plugin' | 'email'; target?: string };
  post_run_action:  { type: string; repo?: string; script?: string } | null;
  status:           'active' | 'paused' | 'failed';
  last_run_at:      string | null;
  run_count:        number;
};

function formatRelative(iso: string | null): string {
  if (!iso) return 'never';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60)        return 'just now';
  if (diff < 3600)      return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400)     return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

function statusBadge(status: ScheduledSkill['status']) {
  const base = 'inline-block text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded';
  if (status === 'active') return <span className={`${base} bg-emerald-500/15 text-emerald-400`}>active</span>;
  if (status === 'paused') return <span className={`${base} bg-amber-500/15  text-amber-400`}>paused</span>;
  return <span className={`${base} bg-rose-500/15 text-rose-400`}>failed</span>;
}

function overdueBadge() {
  return (
    <span
      className="inline-block text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded bg-amber-500/15 text-amber-400"
      title="This routine has not run as expected. A local routine only fires while your machine is awake; consider a remote routine."
    >
      overdue
    </span>
  );
}

function destinationLabel(d: ScheduledSkill['destination']): string {
  if (d.type === 'slack-plugin')  return `Slack ${d.target || '(channel)'} + dashboard`;
  if (d.type === 'slack-webhook') return 'Slack (via webhook) + dashboard';
  return 'Dashboard only';
}

export default function ScheduleRow({ schedule, workflow }: { schedule: ScheduledSkill; workflow?: RoutineWorkflow | null }) {
  const supabase = createClient();
  const [status,  setStatus]  = useState(schedule.status);
  const [pending, setPending] = useState<'pause' | 'resume' | 'delete' | null>(null);
  const [deleted, setDeleted] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  if (deleted) return null;

  async function patch(newStatus: 'active' | 'paused') {
    setError(null);
    setPending(newStatus === 'active' ? 'resume' : 'pause');
    // Optimistic update — flip immediately, roll back on failure
    const previousStatus = status;
    setStatus(newStatus);
    const { error: updErr } = await supabase
      .from('scheduled_skills')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', schedule.id);
    if (updErr) {
      setError(updErr.message);
      setStatus(previousStatus);
    }
    setPending(null);
  }

  async function del() {
    if (!confirm(`Delete the schedule for "${schedule.skill_slug}"? This stops future runs but keeps past output in /runs.`)) return;
    setError(null);
    setPending('delete');
    const { error: delErr } = await supabase
      .from('scheduled_skills')
      .delete()
      .eq('id', schedule.id);
    if (delErr) {
      setError(delErr.message);
      setPending(null);
    } else {
      setDeleted(true);
    }
  }

  return (
    <li className="card">
      <div className="flex items-start gap-4 flex-wrap">
        <div className="flex-1 min-w-[200px]">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="font-mono text-sm text-ink-100">{schedule.skill_slug}</span>
            {statusBadge(status)}
            {status === 'active' && looksOverdue(schedule.cron_expression, schedule.last_run_at) && overdueBadge()}
            {workflow && <RemoteSafetyBadge safety={workflow.safety} size="xs" />}
          </div>
          {workflow && (
            <div className="text-xs text-brand-500 mt-1">
              <Link
                href={`/workflows/${encodeURIComponent(schedule.skill_slug)}?source=${encodeURIComponent(workflow.source)}`}
                className="hover:underline"
              >
                runs the {schedule.skill_slug} workflow →
              </Link>
            </div>
          )}
          <div className="text-sm text-ink-300 mt-1">
            {schedule.schedule_nl}
            <span className="text-ink-500"> · </span>
            <span className="text-xs font-mono text-ink-500">{schedule.cron_expression}</span>
            <span className="text-ink-500"> · </span>
            <span className="text-xs text-ink-500">{schedule.timezone}</span>
          </div>
          <div className="text-xs text-ink-400 mt-1">
            {destinationLabel(schedule.destination)}
            <span className="text-ink-500"> · </span>
            {schedule.run_count} run{schedule.run_count === 1 ? '' : 's'}
            <span className="text-ink-500"> · </span>
            last: {formatRelative(schedule.last_run_at)}
          </div>
          {schedule.post_run_action?.type === 'publish-content' && (
            <div className="text-xs text-brand-400 mt-1" title={schedule.post_run_action.repo}>
              ↳ publishes to{' '}
              <code className="bg-ink-900 px-1 py-0.5 rounded">
                {(schedule.post_run_action.repo || '').split('/').filter(Boolean).pop() || 'repo'}
              </code>
            </div>
          )}
          {error && (
            <div className="text-xs text-rose-400 mt-2">Action failed: {error}</div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {status === 'active' && (
            <button
              onClick={() => patch('paused')}
              disabled={pending !== null}
              className="text-xs px-3 py-1.5 rounded border border-ink-700 text-ink-200 hover:bg-ink-800 disabled:opacity-50"
            >
              {pending === 'pause' ? 'Pausing…' : 'Pause'}
            </button>
          )}
          {status === 'paused' && (
            <button
              onClick={() => patch('active')}
              disabled={pending !== null}
              className="text-xs px-3 py-1.5 rounded border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50"
            >
              {pending === 'resume' ? 'Resuming…' : 'Resume'}
            </button>
          )}
          <button
            onClick={del}
            disabled={pending !== null}
            className="text-xs px-3 py-1.5 rounded border border-rose-500/40 text-rose-300 hover:bg-rose-500/10 disabled:opacity-50"
          >
            {pending === 'delete' ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </li>
  );
}
