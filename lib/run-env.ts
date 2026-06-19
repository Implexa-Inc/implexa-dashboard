/**
 * lib/run-env.ts — read the caller's default run-environment workspace root.
 *
 * Agents write deliverable paths RELATIVE to the folder they ran in (e.g.
 * `reels/day-18/`). To turn one of those into something the user can actually
 * open, we need the absolute root of that folder. The backend already stores it
 * per-user (set_user_run_env → user_run_env.workspace_root), surfaced at
 * /api/v2/me/run-env. This is the one place the dashboard reads it for the
 * clickable-file-path affordance (see <RunMarkdown> / <FilePathCode>).
 *
 * Isomorphic: callBackend is fetch-based, so this works from a server component
 * (run page) or a client component (inbox list) alike. Degrades to null on any
 * error so a missing/un-migrated run-env just falls back to copying the
 * relative path — never throws into the caller.
 */

import { callBackend } from '@/lib/api';

export async function getWorkspaceRoot(jwt?: string | null): Promise<string | null> {
  if (!jwt) return null;
  try {
    const res = await callBackend('/api/v2/me/run-env', { jwt });
    const machines: Array<{ machine_label?: string; workspace_root?: string | null }> =
      res?.machines || [];
    const def = machines.find((m) => m.machine_label === 'default') || machines[0];
    return def?.workspace_root?.trim() || null;
  } catch {
    return null;
  }
}
