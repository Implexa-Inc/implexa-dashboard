// remote-safety.ts - the remote-safe vs local-only verdict for a workflow.
//
// THE VERDICT (vocabulary matches the backend watchdog's get_routine_health):
//   'safe'    - every step runs through an API, CLI, or skill, so the routine
//               can run remotely (even while your machine is offline).
//   'local'   - a step drives a browser to reach a site with no API (an MLS,
//               Zillow, a CRM web UI), so the routine must stay on your machine
//               where Claude for Chrome runs. It can NEVER be moved remote.
//   'unknown' - not enough signal to decide.
//
// IMPORTANT - this is a best-effort HEURISTIC, not the authoritative verdict.
// The authoritative per-workflow verdict is computed by the backend routine
// watchdog and is currently only exposed through get_routine_health, which is
// (a) user-scoped and (b) only populated for OVERDUE routines, so it is not
// reachable from the dashboard's server components for an arbitrary workflow.
// Until a backend endpoint exposes the verdict per workflow (see the report),
// we derive it from the workflow's steps and label it "estimated" in the UI.
//
// SWAP NOTE: when the authoritative verdict is available (a `remote` field on
// the workflow payload, or a user-scoped workflows endpoint), pass it as the
// `authoritative` argument below and it wins over the heuristic in one line.

import type { WorkflowCard, WorkflowDetail } from '@/lib/workflow-catalog';

export type RemoteVerdict = 'safe' | 'local' | 'unknown';

export type RemoteSafety = {
  verdict: RemoteVerdict;
  reason: string;
  /** True when derived locally (not from the authoritative backend verdict). */
  estimated: boolean;
};

// Sites/surfaces that have no API and therefore need the browser to reach. The
// chrome-mcp capability's own rationale names these ("an MLS, Zillow, your CRM
// web UI"); a step whose work is gathering from one of them cannot run remote.
const BROWSER_BOUND = /\b(mls|zillow|redfin|realtor\.com|instagram|\big\b|tiktok|facebook|linkedin|crm web|web ui|web portal|portal|scroll|scrape|click through|browse the|log ins?|sign ins?|the browser)\b/i;

// Sources whose skills are CLI/API tools (run headless, remote-safe).
const API_SOURCES = new Set(['skills.sh', 'clawhub', 'anthropic', 'github']);

/**
 * isBrowserStep - does this step fundamentally need a browser?
 * A bound API/CLI skill never does. An unbound data-gathering step that names a
 * no-API surface does. Decision and skill steps are pure reasoning.
 */
function isBrowserStep(step: WorkflowDetail['steps'][number]): boolean {
  if (step.kind !== 'tool') return false;
  // Bound to a known API/CLI skill → headless, remote-safe.
  if (step.ref && API_SOURCES.has(step.ref.source)) return false;
  // A manual fallback exists → the run degrades to a paste instead of breaking,
  // so it is not a hard browser dependency.
  if (step.fallbacks.length > 0) return false;
  return BROWSER_BOUND.test(step.label);
}

/**
 * remoteSafety - derive the verdict from a full workflow detail (preferred,
 * because it has the step chain). `authoritative` short-circuits the heuristic.
 */
export function remoteSafety(
  workflow: WorkflowDetail,
  authoritative?: RemoteVerdict | null,
): RemoteSafety {
  if (authoritative) {
    return {
      verdict: authoritative,
      estimated: false,
      reason:
        authoritative === 'safe'
          ? 'The watchdog verified this runs without a browser, so it can run on a remote routine.'
          : authoritative === 'local'
            ? 'The watchdog found a browser-driven step, so this must stay on your machine.'
            : 'The watchdog could not verify whether this needs a browser.',
    };
  }

  const browserStep = workflow.steps.find(isBrowserStep);
  if (browserStep) {
    return {
      verdict: 'local',
      estimated: true,
      reason: `Step ${browserStep.order} gathers from a site with no API, which needs the browser, so this stays local.`,
    };
  }

  const toolSteps = workflow.steps.filter((s) => s.kind === 'tool');
  // No tool steps at all, or every tool step is bound to an API/CLI skill or has
  // a manual fallback → nothing forces a browser, so it can run remote.
  const allToolStepsHeadless = toolSteps.every(
    (s) => (s.ref && API_SOURCES.has(s.ref.source)) || s.fallbacks.length > 0,
  );
  if (workflow.steps.length > 0 && allToolStepsHeadless) {
    return {
      verdict: 'safe',
      estimated: true,
      reason:
        'Every step runs through a skill, an API, or a manual paste, so it can run on a remote routine.',
    };
  }

  return {
    verdict: 'unknown',
    estimated: true,
    reason:
      'This workflow has steps your model fills directly, so we cannot yet confirm it is browser-free.',
  };
}

/**
 * remoteSafetyFromCard - a coarser verdict from a catalog card (no step chain).
 * Used only where we have not fetched the full detail. Realtor/creator verticals
 * lean on no-API surfaces (MLS, Instagram); builder verticals are mostly
 * API/CLI. Always "estimated".
 */
export function remoteSafetyFromCard(card: WorkflowCard): RemoteSafety {
  const v = (card.vertical || '').toLowerCase();
  if (v === 'realtor' || v === 'creator') {
    return {
      verdict: 'local',
      estimated: true,
      reason:
        'This kind of workflow usually pulls from sites with no API (an MLS, Instagram), which needs the browser.',
    };
  }
  if (card.bound_step_count > 0 && card.bound_step_count === card.step_count) {
    return {
      verdict: 'safe',
      estimated: true,
      reason: 'Every step is bound to a skill, so it can run on a remote routine.',
    };
  }
  return {
    verdict: 'unknown',
    estimated: true,
    reason: 'Open the workflow to see whether any step needs the browser.',
  };
}

export const VERDICT_PRESENTATION: Record<
  RemoteVerdict,
  { label: string; classes: string; dot: string }
> = {
  // Follows the /overview StatCard reference pattern for darkMode:'media':
  // raw tailwind color with an explicit dark: variant so it flips correctly.
  safe: {
    label: 'Remote-safe',
    classes:
      'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
    dot: 'bg-emerald-500 dark:bg-emerald-400',
  },
  local: {
    label: 'Local-only',
    classes: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
    dot: 'bg-amber-500 dark:bg-amber-400',
  },
  unknown: {
    label: 'Unverified',
    classes: 'bg-ink-800 text-ink-300',
    dot: 'bg-ink-500',
  },
};
