'use client';

/**
 * Install-as-reference controls for the skill detail page.
 *
 * Two pieces, used together when the viewing user is on a CANONICAL skill
 * detail page (not their own authored copy):
 *
 *   InstallStatusBadge   — "Installed" pill + a small "Remove from library"
 *                          / "Restore to library" link. Manages user_skill_installs
 *                          status via direct supabase client write (RLS scoped to
 *                          the caller's own rows; see migration 0021).
 *   ForkToCustomizeButton — opens a confirm dialog explaining that a fork
 *                          creates the user's own copy, then POSTs the
 *                          existing /api/v2/skills/:id/fork endpoint and
 *                          navigates to the new fork's detail page.
 *
 * Visibility rules (decided server-side in page.tsx, passed in as flags):
 *   • InstallStatusBadge — only renders if installState !== null
 *     (i.e. the user has SOME install row, active or archived).
 *   • ForkToCustomizeButton — only renders when the viewer isn't the
 *     skill's author and the skill isn't already in their own org.
 *     Authoring your own skill or having it in your org means fork is
 *     irrelevant — they can edit directly.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { callBackend } from '@/lib/api';

export type InstallState = {
  status: 'active' | 'archived';
};

export function InstallStatusBadge({
  skillId,
  installState,
}: {
  skillId:      string;
  installState: InstallState;
}) {
  const router   = useRouter();
  const supabase = createClient();
  const [busy,    setBusy]    = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  // Optimistic state — flips immediately on click so the badge + link text
  // update without waiting for the network. If the supabase call fails we
  // roll back via setOptimistic(initial) below.
  const [optimisticStatus, setOptimisticStatus] = useState<'active' | 'archived'>(installState.status);
  const [, startTransition] = useTransition();

  async function flipStatus(nextStatus: 'active' | 'archived') {
    if (busy) return;
    const prev = optimisticStatus;
    setOptimisticStatus(nextStatus);
    setBusy(true); setError(null);
    try {
      // RLS scopes the UPDATE to the caller's own row; no need to pass
      // user_id in the filter (current_user_id() resolves it server-side).
      const { error: updateErr } = await supabase
        .from('user_skill_installs')
        .update({ status: nextStatus })
        .eq('skill_id', skillId);
      if (updateErr) throw new Error(updateErr.message);
      // Refresh server data so the "Your skills" list reflects the new
      // state on the user's next nav back. router.refresh() re-runs the
      // server components for the current route (cheap; same as star).
      startTransition(() => router.refresh());
    } catch (err) {
      setOptimisticStatus(prev);
      setError(err instanceof Error ? err.message : 'Failed to update');
    } finally {
      setBusy(false);
    }
  }

  if (optimisticStatus === 'active') {
    return (
      <div className="inline-flex items-center gap-2">
        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-brand-500/15 text-brand-500 font-medium">
          <span aria-hidden="true">✓</span> Installed
        </span>
        <button
          type="button"
          onClick={() => flipStatus('archived')}
          disabled={busy}
          className="text-xs text-ink-400 hover:text-ink-200 hover:underline disabled:opacity-50"
        >
          {busy ? 'Removing…' : 'Remove from library'}
        </button>
        {error && <span className="text-xs text-red-500">{error}</span>}
      </div>
    );
  }

  // Archived — user has previously had this in their library but archived
  // the reference. Surface a one-click restore. We intentionally don't
  // show an "Installed" badge in this state because the reference exists
  // but is intentionally hidden from the user's default library view.
  return (
    <div className="inline-flex items-center gap-2">
      <span className="text-xs text-ink-400">Removed from your library</span>
      <button
        type="button"
        onClick={() => flipStatus('active')}
        disabled={busy}
        className="text-xs text-brand-500 hover:underline disabled:opacity-50"
      >
        {busy ? 'Restoring…' : 'Restore'}
      </button>
      {error && <span className="text-xs text-red-500">{error}</span>}
    </div>
  );
}

export function ForkToCustomizeButton({
  skillId,
  skillName,
  jwt,
}: {
  skillId:   string;
  skillName: string;
  jwt:       string;
}) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy,        setBusy]        = useState(false);
  const [error,       setError]       = useState<string | null>(null);

  async function doFork() {
    setBusy(true); setError(null);
    try {
      const r = await callBackend(`/api/v2/skills/${skillId}/fork`, {
        jwt, method: 'POST', body: { scope: 'private' },
      });
      // /api/v2/skills/:id/fork returns { skill: { slug, ... } }. Forkskill
      // lands the new fork into the caller's org, so this navigates to a
      // slug under their org — distinct from the canonical we just left.
      router.push(`/skills/${r.skill.slug}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fork failed');
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirmOpen(true)}
        className="text-xs px-2.5 py-1 rounded-md border border-brand-500/40 text-brand-500 hover:bg-brand-500/10 transition-colors"
      >
        Fork to customize
      </button>

      {confirmOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget && !busy) setConfirmOpen(false); }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="fork-confirm-title"
        >
          <div className="card max-w-md w-full">
            <h3 id="fork-confirm-title" className="text-base font-medium text-ink-50 mb-2">
              Fork &ldquo;{skillName}&rdquo; to customize?
            </h3>
            <p className="text-sm text-ink-200 leading-relaxed mb-2">
              Forking creates your own private copy in your org that you can
              edit freely. The original skill stays unchanged — its
              attribution, stars, and Trending rank accumulate on the
              canonical row.
            </p>
            <p className="text-xs text-ink-400 mb-4">
              You&rsquo;ll still be able to run the original from your library
              even after forking. Forks count toward your private skill quota.
            </p>
            {error && <p className="text-xs text-red-500 mb-3">{error}</p>}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                disabled={busy}
                className="btn-ghost"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={doFork}
                disabled={busy}
                className="btn-primary"
              >
                {busy ? 'Forking…' : 'Fork it'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
