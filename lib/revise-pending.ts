/**
 * revise-pending — the read-side (self-healing) half of the stuck "Updating…"
 * badge fix (founder-hit 2026-07-16 on cinematic-b-roll-generator).
 *
 * A revise run_request has NO skill_run row, so no server-side run backstop can
 * close it: if the executing session lands the new version via revise_workflow
 * but skips resolve_run_request(done) — a Codex failover session did exactly
 * this — the request rots at 'consumed' and the old predicate ("any open revise
 * request in the last 12h") showed "Rewrite in progress / Updating…" forever.
 *
 * The truth signal for a revise is THE VERSION LANDING (ARCHITECTURE §2.1): a
 * workflow version dated AFTER the revise request's created_at means the revise
 * finished, whatever the request row says. So the open-request check stays as
 * the TRIGGER, AND-gated with "no newer version exists". The backend also
 * auto-resolves the request when the version lands (write side); this predicate
 * keeps the badge honest even if that backstop is ever skipped again.
 *
 * Deliberately keyed on workflow VERSIONS, not aggregated_skills.updated_at:
 * updated_at bumps on unrelated writes (browser-runtime proof stamps, seeder
 * touches), which would clear the badge on a genuinely in-flight revise.
 *
 * Pure + dependency-free so it's unit-testable without rendering:
 *   node --test lib/revise-pending.test.ts
 */

export type ReviseRequestRow = {
  kind?: string | null;
  status?: string | null;
  created_at?: string | null;
};

/** Newest applied-version timestamp, order-independent. Null when no history. */
export function newestVersionAt(
  versions: Array<{ at?: string | null }> | null | undefined,
): string | null {
  let best: string | null = null;
  let bestMs = NaN;
  for (const v of versions ?? []) {
    const ms = v?.at ? Date.parse(v.at) : NaN;
    if (!Number.isNaN(ms) && (Number.isNaN(bestMs) || ms > bestMs)) {
      bestMs = ms;
      best = v!.at as string;
    }
  }
  return best;
}

/**
 * Is a revise genuinely in flight? True only when an open (pending|consumed)
 * revise request exists AND no workflow version has landed since it was asked.
 * The caller passes rows already filtered to open statuses + the time window
 * (the page's existing run_requests query); this adds the version gate.
 *
 * Conservative on missing data: no version history in scope, or an unparsable
 * request timestamp, keeps the legacy behavior (badge shows) — the predicate
 * must never hide a revise that truly hasn't landed yet.
 */
export function isRevisePending(
  requests: ReviseRequestRow[] | null | undefined,
  latestVersionAtIso: string | null,
): boolean {
  // Enforce terminal clearing here too, not only in the page query. A failed,
  // cancelled, or completed edit is no longer rewriting anything and may never
  // keep Run paused if a caller passes a broader request list.
  const revises = (requests ?? []).filter((r) =>
    r?.kind === 'revise' && (r.status === 'pending' || r.status === 'consumed'));
  if (revises.length === 0) return false;
  const landedMs = latestVersionAtIso ? Date.parse(latestVersionAtIso) : NaN;
  if (Number.isNaN(landedMs)) return true; // no landed version in scope — keep the trigger semantics
  return revises.some((r) => {
    const askedMs = r?.created_at ? Date.parse(r.created_at) : NaN;
    // Request newer than the latest landed version → its edit hasn't landed yet.
    return Number.isNaN(askedMs) ? true : askedMs > landedMs;
  });
}
