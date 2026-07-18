/**
 * <EngineOverrideBanner /> — deterministic disclosure when a run executed on a
 * DIFFERENT engine than the agent's own pin (2026-07-18 review, Stage C #3).
 *
 * The prompt-level disclosure the drain writes into its own run output is a MODEL
 * INSTRUCTION the agent can omit — this is the durable fix: rendered straight from
 * stored columns, so it can never be skipped. Sourced from
 * run_requests.original_preference (the resolved pin BEFORE the Stage C
 * exclude-override — migration 0119) vs run_requests.selected_executor (what
 * actually ran). Both are best-effort / possibly-null (pre-migration rows, or
 * 0118/0119 not yet applied to prod — see the deploy-before-migrate degrade in
 * routeAndClaim) — renders nothing rather than guessing.
 *
 * The decision logic lives in engine-override-disclosure.ts (plain, no JSX) so
 * it's unit-testable with `node --test` (this repo's native-TS pattern) — Node's
 * built-in type stripping doesn't transform JSX, so it can't run from a .tsx file.
 *
 * Copy note (P1, Stage C review 2nd round on #55): do NOT hardcode a "the pinned
 * engine couldn't handle this capability" narrative here. A pin override can be
 * capability-based (excludeEngine — browser/computer-use routing) OR purely
 * CAPACITY-based (decideStaleReroute in execution-engine.service.js overrides a
 * hard pin when the primary engine is rate-limit-capped or stuck, not incapable —
 * see execution-router.js's "is capped until..." reason strings). The headline
 * states only the neutral fact (ran on X, not pinned Y); selectionReason (verbatim,
 * whatever the router actually recorded) carries the real "why".
 */

import { computeOverrideDisclosure } from './engine-override-disclosure';

export function EngineOverrideBanner({
  originalPreference,
  selectedExecutor,
  selectionReason,
}: {
  originalPreference: string | null | undefined;
  selectedExecutor: string | null | undefined;
  selectionReason: string | null | undefined;
}) {
  const d = computeOverrideDisclosure(originalPreference, selectedExecutor, selectionReason);
  if (!d) return null;

  return (
    <div
      className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 mb-4"
      role="status"
    >
      <p className="text-sm text-ink-100">
        <span aria-hidden="true">⚠</span>{' '}
        <strong>This run used {d.ranLabel}</strong>, not your pinned {d.pinLabel} (billed to your {d.ranLabel} account).
      </p>
      <p className="text-xs text-ink-400 mt-1">
        {d.selectionReason || `${d.pinLabel} wasn't available for this run.`}
      </p>
    </div>
  );
}
