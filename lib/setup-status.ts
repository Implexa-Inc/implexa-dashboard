/**
 * Setup-status helper — TypeScript mirror of the backend's
 * `getUserSetupStatus()` in services/user-activity.service.js.
 *
 * Powers the dashboard's setup-aware UI:
 *   - Sidebar status chip (active / idle / stale / never)
 *   - Share-page contextual install button
 *   - Post-install "try in Claude" CTA
 *
 * Keep this in lockstep with the backend version. The math is identical
 * so the two surfaces agree on what status a user is in.
 */

export type SetupStatus = 'active' | 'idle' | 'stale' | 'never';

export interface SetupStatusResult {
  status:     SetupStatus;
  lastSeenAt: string | null;          // ISO timestamp of the most recent activity
  hasHooks:   boolean;                // last_hook_event_at is non-null
}

/**
 * Compute setup status from the two activity timestamps on `users`.
 * Both args are nullable ISO strings (or null when the user has no
 * recorded activity).
 *
 * Thresholds match the backend:
 *   active : < 24h since most recent activity
 *   idle   : 24h - 30d
 *   stale  : > 30d (signal exists but has rotted)
 *   never  : both timestamps NULL
 */
export function computeSetupStatus(
  lastMcpCallAt:   string | null | undefined,
  lastHookEventAt: string | null | undefined,
): SetupStatusResult {
  const mcp  = lastMcpCallAt   ? Date.parse(lastMcpCallAt)   : 0;
  const hook = lastHookEventAt ? Date.parse(lastHookEventAt) : 0;
  const last = Math.max(mcp, hook);

  if (!last) return { status: 'never', lastSeenAt: null, hasHooks: false };

  const ageMs = Date.now() - last;
  const day   = 24 * 60 * 60 * 1000;

  let status: SetupStatus;
  if (ageMs < day)        status = 'active';
  else if (ageMs < 30 * day) status = 'idle';
  else                       status = 'stale';

  return {
    status,
    lastSeenAt: new Date(last).toISOString(),
    hasHooks:   !!hook,
  };
}

/**
 * Human-readable relative time for the status chip tooltip.
 * "12 minutes ago", "3 days ago", "never". Coarse — we don't need
 * second-level granularity here.
 */
export function relativeFromNow(iso: string | null): string {
  if (!iso) return 'never';
  const ms = Date.now() - Date.parse(iso);
  if (ms < 60 * 1000)                 return 'just now';
  if (ms < 60 * 60 * 1000)            return `${Math.floor(ms / 60_000)} min ago`;
  if (ms < 24 * 60 * 60 * 1000)       return `${Math.floor(ms / 3_600_000)} h ago`;
  if (ms < 30 * 24 * 60 * 60 * 1000)  return `${Math.floor(ms / 86_400_000)} d ago`;
  return `${Math.floor(ms / (30 * 86_400_000))} mo ago`;
}

/**
 * Chip label + color spec for each status. Used by the sidebar component
 * to render the small status badge near the user profile.
 */
export const STATUS_PRESENTATION: Record<SetupStatus, { dot: string; label: string; tooltip: string }> = {
  active: {
    dot:     'bg-success-400',
    label:   'Active',
    tooltip: 'Implexa is connected and active in your Claude.',
  },
  idle: {
    dot:     'bg-success-400/50',
    label:   'Idle',
    tooltip: "Implexa is connected, but we haven't seen recent activity (>24h).",
  },
  stale: {
    dot:     'bg-amber-400',
    label:   'Stale',
    tooltip: 'Implexa was set up >30 days ago. Reinstall if commands stopped working.',
  },
  never: {
    dot:     'bg-red-400',
    label:   'Claude not connected',
    tooltip: "We haven't seen your Claude talk to Implexa yet. Click to set up.",
  },
};
