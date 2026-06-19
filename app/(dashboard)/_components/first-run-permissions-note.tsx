'use client';

/**
 * <FirstRunPermissionsNote /> — a one-time, dismissible heads-up for a first-time
 * user (no successful runs yet). The first run a user does may pause for a
 * permission the runtime can't auto-approve; we tell them where that surfaces so
 * an unattended run doesn't look stuck.
 *
 * Shown once, then cleared for good. The localStorage flag is shared with the
 * run-now confirmation in <AgentActions /> (same SEEN_KEY) so the heads-up never
 * double-shows across surfaces, and `active` (server signal: no successful runs
 * yet) ensures it never appears for an established user who never dismissed it.
 */

import { useEffect, useState } from 'react';

export const FIRST_RUN_PERMS_SEEN_KEY = 'implexa:first-run-perms-note';

export function firstRunPermsSeen(): boolean {
  if (typeof window === 'undefined') return true;
  try { return localStorage.getItem(FIRST_RUN_PERMS_SEEN_KEY) === '1'; } catch { return false; }
}
export function markFirstRunPermsSeen() {
  try { localStorage.setItem(FIRST_RUN_PERMS_SEEN_KEY, '1'); } catch { /* private mode */ }
}

export default function FirstRunPermissionsNote({ active }: { active: boolean }) {
  // Render nothing until we've checked localStorage client-side (avoids a flash
  // for users who already dismissed it).
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (active && !firstRunPermsSeen()) setShow(true);
  }, [active]);

  if (!show) return null;

  function dismiss() {
    markFirstRunPermsSeen();
    setShow(false);
  }

  return (
    <section className="mb-6 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 relative">
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="absolute top-3 right-3 text-ink-500 hover:text-ink-200 text-lg leading-none"
      >
        ×
      </button>
      <div className="flex items-start gap-3 pr-6">
        <span className="text-lg leading-none mt-0.5" aria-hidden="true">💡</span>
        <p className="text-sm text-ink-200 leading-relaxed">
          <span className="font-medium text-ink-50">Heads up:</span> your first run may pause for a
          permission it can&apos;t auto-approve. Watch Alerts (Active Agents / Home), your email, or a
          desktop notification. Approving is one tap.
        </p>
      </div>
    </section>
  );
}
