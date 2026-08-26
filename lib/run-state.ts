// run-state.ts - the LIVE state of a run (running / stalled / done / failed),
// so silence on the dashboard never reads as success.
//
// The trap this exists to close (observed live 2026-06-08): a scheduled SEO
// agent stalled on an interactive permission prompt, produced no output, and
// never completed. Today skill_runs is written only AFTER a run finishes, so a
// run that started and hung leaves no trace and the founder assumed success for
// an hour. (DATA_AND_LEARNING_MODEL.md: "Silence must never mean success.")
//
// THE STATE (vocabulary matches the backend migration 0065 skill_runs.run_state):
//   'running'   - in flight right now (started, not yet complete).
//   'stalled'   - started, ran past its expected window with no progress; the
//                 watchdog flags it. The exact silent-stall class.
//   'completed' - finished and delivered a result.
//   'failed'    - finished in error. A required permission is now blocked before
//                 claim and surfaced as Needs You; a real runtime denial that
//                 escapes that boundary still lands here rather than as silence.
//   'queued'    - registered, not yet started.
//
// INTEGRATION SLOT: the authoritative state is skill_runs.run_state, added by
// the parallel backend stream (migration 0065) along with started_at /
// last_progress_at / expected_duration_ms / stalled_at. The moment those columns
// land and the run-scheduled write path sets them, this surface shows true live
// state with zero UI change. Until then we DERIVE a best-effort state from the
// existing terminal columns (every pre-0065 row is finished), and selectRuns()
// degrades cleanly if the new columns are not in the schema yet.

import type { SupabaseClient } from '@supabase/supabase-js';

export type RunState = 'queued' | 'running' | 'stalled' | 'completed' | 'failed';

// One step in a run's live trace (skill_runs.progress, migration 0080). Appended
// by record_run_heartbeat(note) at each step boundary so a run shows WHERE it is.
export type RunProgressEntry = { at: string; note?: string; step?: string };
export type RunProgress = { current?: RunProgressEntry; history?: RunProgressEntry[] };

// One step in a run's live CHECKLIST (skill_runs.steps_state, migration 0089).
// Maintained by record_run_heartbeat(stepIndex/totalSteps/stepLabel) so a chain
// shows which of its steps are done / running / pending while it's in flight.
export type StepStatus = 'pending' | 'running' | 'done' | 'failed';
export type RunStep = { index: number; label?: string | null; status: StepStatus };

// A run row covering the base skill_runs columns plus the (possibly absent until
// 0065 lands) live-state columns. The optional ones are read defensively.
export type RunRow = {
  id: string;
  skill_slug: string;
  status: 'completed' | 'failed' | 'partial';
  ran_at: string;
  source?: string;
  output_markdown?: string | null;
  review_status?: string | null;
  // Why a held run needs the human. This is persisted by backend migration 0139;
  // absence means a legacy run and must use the conservative compatibility path.
  hold_kind?: 'approval_before_action' | 'review_delivered_result' | 'needs_input' | null;
  // optional base columns some surfaces request via extraColumns (e.g. /runs):
  scheduled_skill_id?: string | null;
  orchestration_id?: string | null;
  duration_ms?: number | null;
  delivery?: Record<string, unknown> | null;
  // ── 0065 live-state columns (the integration slot) ──
  run_state?: RunState | null;
  started_at?: string | null;
  last_progress_at?: string | null;
  completed_at?: string | null;
  expected_duration_ms?: number | null;
  stalled_at?: string | null;
  // ── 0080 live step trace ──
  progress?: RunProgress | null;
  // ── 0102 Completion Controller verdict (did it produce its deliverable?) ──
  verification_status?: string | null;
  // Why a terminal run closed (migration 0101). Used to distinguish the exact
  // historical clean-exit approval bug from ordinary failed executions.
  run_close_reason?: string | null;
  // ── 0089 live per-step checklist ──
  current_step_index?: number | null;
  total_steps?: number | null;
  current_step_label?: string | null;
  steps_state?: RunStep[] | null;
  // True when this run's parent routine is currently PAUSED. A paused routine
  // isn't firing, so a lingering running/stalled row is an orphan (a dead test-run
  // session, or a stall not yet swept) — it must not render as a loud "Stalled" /
  // "Running" alert. Set by the surface that knows the routine's status (the run
  // detail page joins scheduled_skills). Absent ⇒ treated as not-paused.
  routine_paused?: boolean | null;
};

export type RunStateInfo = {
  state: RunState;
  /** Short badge label. */
  label: string;
  /** One-line plain-english reason (hover/expanded). */
  reason: string;
  /** True when this run needs the user's attention (stalled, or a permission-blocked failure). */
  attention: boolean;
  /** True when the failure is a missing permission the user can re-grant in one tap. */
  permissionBlocked: boolean;
  /** True when derived locally, not read from the authoritative backend run_state. */
  estimated: boolean;
};

/** Queue and execution are one watchable lifecycle on the run details page. */
export function isWatchableRunState(state: unknown): boolean {
  return state === 'queued' || state === 'running';
}

/**
 * A stale close reason on a reserved row must never turn an active queue/start
 * transition into the terminal amber "This run stalled" conclusion. Close
 * failure explanations become user-facing only after the run has actually left
 * its active queued/running lifecycle (or when the authoritative state itself
 * needs attention). Successful settlement provenance must be passed as null.
 */
export function shouldShowRunProblem(
  info: Pick<RunStateInfo, 'state' | 'attention'>,
  failureExplanation: string | null,
): boolean {
  if (info.attention || info.state === 'failed') return true;
  return !!failureExplanation && info.state !== 'queued' && info.state !== 'running';
}

/**
 * Compatibility recovery for runs closed by the pre-fix broker settlement path.
 *
 * That path could turn a clean executor exit plus intermediate artifacts into a
 * completed run even though its structured checklist was still sitting at an
 * approval gate. Free-text heartbeat prose is deliberately not authority here:
 * recovery requires a running approval/review step, completed work before it,
 * pending work after it, validated review/source evidence, and no final output.
 */
export function isApprovalContinuationRecovery({
  runState,
  reviewStatus,
  outputMarkdown,
  steps,
  progress,
  closeReason,
  hasReviewEvidence,
  hasFinalOutput,
}: {
  runState: unknown;
  reviewStatus: unknown;
  outputMarkdown: unknown;
  steps: RunStep[];
  progress?: RunProgress | null;
  closeReason?: unknown;
  hasReviewEvidence: boolean;
  hasFinalOutput: boolean;
}): boolean {
  if (runState !== 'completed' && runState !== 'failed') return false;
  if (reviewStatus === 'pending' || reviewStatus === 'needs_input') return false;
  if (typeof outputMarkdown === 'string' && outputMarkdown.trim()) return false;
  if (!hasReviewEvidence || hasFinalOutput || !Array.isArray(steps) || steps.length < 2) return false;

  // Runs affected by the pre-fix Desktop clean-exit bug were flattened to
  // failed before the approval hold could be persisted. Recover only the exact
  // adapter/presenter/render trace; generic approval prose is not authority.
  if (runState === 'failed') {
    if (closeReason !== 'exit_clean_no_completion_signal') return false;
    const entries = [
      ...(Array.isArray(progress?.history) ? progress.history : []),
      ...(progress?.current ? [progress.current] : []),
    ];
    const exactGate = entries.some((entry) => {
      const text = String(entry?.note || entry?.step || '').trim();
      return /\bdesktop\s+(?:media\s+)?adapter\b/i.test(text)
        && /\brequires?\s+approval\b/i.test(text)
        && /\brender(?:ing)?\b/i.test(text)
        && /\bpresenter\s+derivative\b/i.test(text);
    });
    return exactGate
      && steps.some((step) => step.status === 'done')
      && steps.some((step) => step.status === 'pending' || step.status === 'running');
  }

  const gate = steps.find((step) => step.status === 'running');
  if (!gate || typeof gate.label !== 'string'
      || !/\b(approval|approve|review|decision|confirm)\b/i.test(gate.label)) return false;

  return steps.some((step) => step.index < gate.index && step.status === 'done')
    && steps.some((step) => step.index > gate.index && step.status === 'pending');
}

const VALID: ReadonlySet<RunState> = new Set(['queued', 'running', 'stalled', 'completed', 'failed']);

// A failed run whose output names a missing permission. The run-scheduled wrapper
// writes "Blocked on a permission not pre-approved: <tool>" when a tool is denied
// under the scheduled-run dontAsk scope, so the silent-stall becomes a visible,
// one-tap-fixable failure. Match that and the older raw prompt wording.
const PERMISSION_BLOCK = /blocked on a permission|permission not pre-approved|allow .* to (fetch|access)|waiting on a permission|permission approval|not permitted/i;

function isPermissionBlocked(row: RunRow): boolean {
  return !!row.output_markdown && PERMISSION_BLOCK.test(row.output_markdown);
}

// ── liveness: is a 'running' run actually alive? ─────────────────────────────
//
// MIRRORS implexa-backend/src/lib/run-liveness.js — same 7-minute rule, same
// vocabulary. This page reads skill_runs DIRECTLY from Supabase (not through the
// backend's getRunById), so it cannot import that verdict; this is a second
// READER of one rule, and the rule's home is the backend. Change one, change both.
//
// THE TRAP THIS CLOSES (founder, 2026-07-15, run ec42bac6): this file's own header
// promises "silence on the dashboard never reads as success" — and then the
// 'running' branch below said, flatly, "This run is in flight right now." for a run
// whose last_progress_at had equalled started_at for twenty minutes. Nothing was in
// flight; the session that opened the row had died. The row carried the proof the
// whole time. Silence read as success on the one page you open when you're worried.
const STUCK_NO_PROGRESS_MS = 7 * 60 * 1000; // 7 min — keep in step with the backend

export type Liveness = 'alive' | 'quiet' | 'unborn' | 'unknown';

/**
 * 'alive'  - reported recently.
 * 'quiet'  - WAS reporting, now silent past the window (often an unanswered prompt).
 * 'unborn' - has NEVER reported since the row opened: no engine ever picked it up.
 * 'unknown'- no usable timestamps. Never treat as a verdict.
 *
 * Knowable because a heartbeat stamps last_progress_at = now, while the row is born
 * with last_progress_at === started_at. Equal means "not one word, ever".
 */
export function runLiveness(
  row: RunRow,
  now: number = Date.now(),
): { state: Liveness; silentMs: number | null; everReported: boolean | null } {
  const started = Date.parse(row.started_at || '');
  const progress = Date.parse(row.last_progress_at || row.started_at || '');
  if (!Number.isFinite(progress)) return { state: 'unknown', silentMs: null, everReported: null };
  const silentMs = now - progress;
  const everReported = Number.isFinite(started) ? progress > started : true;
  if (silentMs <= STUCK_NO_PROGRESS_MS) return { state: 'alive', silentMs, everReported };
  return { state: everReported ? 'quiet' : 'unborn', silentMs, everReported };
}

/**
 * deriveRunState - the live state of one run. Prefers the authoritative
 * skill_runs.run_state; falls back to the terminal status when it is absent.
 */
export function deriveRunState(row: RunRow): RunStateInfo {
  const authoritative = row.run_state && VALID.has(row.run_state) ? row.run_state : null;
  const permissionBlocked = isPermissionBlocked(row);

  // Parent routine paused: a running/stalled row here is an orphan, not a live
  // alert. Render it as a quiet, terminal "Paused" state instead of the loud
  // "This run stalled" / "Running" card — the routine isn't firing, so nothing is
  // actually in flight. (A held/failed/finished run of a paused routine is real
  // history and keeps its own state below.)
  if (row.routine_paused && (authoritative === 'running' || authoritative === 'stalled')) {
    return mk(
      'completed', 'Paused',
      'This run\'s routine is paused, so it is no longer running. This is a leftover from before it was paused — nothing is in flight.',
      false, false, false,
    );
  }

  // Held at a human-approval gate takes precedence over the terminal run_state:
  // such a run is run_state='completed' + review_status='pending', so without this
  // it would read as a clean "Done" even though it's waiting on the user (the
  // confusing "Done + Approve & continue" the founder hit).
  //
  // attention is FALSE on purpose: attention means "did not finish cleanly"
  // (stalled / permission-blocked) and drives the loud RunAttentionBanner. A held
  // run finished cleanly and paused ON PURPOSE — it belongs in Alerts, not the
  // "blocked on a permission" banner. The detail page surfaces it via `pending`.
  if (row.review_status === 'pending') {
    return mk(
      'completed', 'Waiting for approval',
      'Held at a human-approval gate. Use Approve & continue to let it finish the gated step (e.g. send/post). Nothing happens without you.',
      false, false, false,
    );
  }

  // A blocked run that needs the user's input/decision to continue — distinct from
  // an approve-ready hold: there is NOTHING shippable, so it offers Continue only
  // (no Approve). Surfaces in "Needs you" same as a pending hold.
  if (row.review_status === 'needs_input') {
    return mk(
      'completed', 'Needs your input',
      'Paused with a question it can’t answer on its own. Use Continue to give it the decision or missing input. Nothing finished yet.',
      false, false, false,
    );
  }

  // Authoritative live state from the backend (post-0065 write path).
  if (authoritative) {
    switch (authoritative) {
      case 'running': {
        // "Running" is a CLAIM, and we can check it. attention stays FALSE for both
        // silent cases on purpose: a HeyGen render legitimately reports nothing for
        // minutes, so this must not become a loud false alarm. The escalation to a
        // real 'stalled' is the watchdog's job (backend sweepStalledRuns, where an
        // unborn run no longer earns the 2h per-agent window). This surface's job is
        // narrower and non-negotiable: don't tell the user it's fine when we can see
        // it isn't.
        const { state: live, silentMs } = runLiveness(row);
        const mins = Math.max(1, Math.round((silentMs ?? 0) / 60000));
        if (live === 'unborn') {
          return mk(
            'running', 'Not started',
            `Started ${mins}m ago but has never reported a single step, so nothing has picked it up yet. `
            + `Usually this means the session that was going to run it never got going. Nothing is burning — re-run it.`,
            false, false, false,
          );
        }
        if (live === 'quiet') {
          return mk(
            'running', 'Running',
            `In flight, but it hasn't reported progress in ${mins}m. A long render can be quiet for a while; `
            + `if it stays quiet it may be waiting on a prompt or stuck on a step.`,
            false, false, false,
          );
        }
        return mk('running', 'Running', 'This run is in flight right now.', false, false, false);
      }
      case 'stalled':
        return mk(
          'stalled', 'Stalled',
          permissionBlocked
            ? 'Stalled waiting on a permission approval. Re-run /implexa:schedule for this agent to pre-approve it.'
            : 'Started but ran past its expected window with no progress. It may be waiting on a prompt or stuck on a step.',
          true, permissionBlocked, false,
        );
      case 'failed':
        return mk(
          'failed', 'Failed',
          permissionBlocked
            ? 'Blocked on a permission that was not pre-approved. Re-run /implexa:schedule for this agent to grant it.'
            : 'This run finished in error. Open it to see what went wrong.',
          permissionBlocked, permissionBlocked, false,
        );
      case 'queued':
        return mk('queued', 'Queued', 'Registered and waiting to start.', false, false, false);
      case 'completed':
      default:
        return mk('completed', 'Done', 'Finished and delivered a result.', false, false, false);
    }
  }

  // Derived fallback (pre-0065, or a row the write path has not stamped). Every
  // such row is terminal, so it maps to done / failed only; running / stalled
  // appear once the backend write path lands.
  if (row.status === 'failed') {
    return mk(
      'failed', 'Failed',
      permissionBlocked
        ? 'Blocked on a permission that was not pre-approved. Re-run /implexa:schedule for this agent to grant it.'
        : 'This run finished in error. Open it to see what went wrong.',
      permissionBlocked, permissionBlocked, true,
    );
  }
  if (row.status === 'partial') {
    return mk('completed', 'Partial', 'Finished, but skipped a step. Open it to see what was left out.', false, false, true);
  }
  return mk('completed', 'Done', 'Finished and delivered a result.', false, false, true);
}

function mk(
  state: RunState, label: string, reason: string,
  attention: boolean, permissionBlocked: boolean, estimated: boolean,
): RunStateInfo {
  return { state, label, reason, attention, permissionBlocked, estimated };
}

export type RunPresentation = { label: string; classes: string; dot: string; pulse: boolean; spinCls: string };

export const RUN_STATE_PRESENTATION: Record<RunState, RunPresentation> = {
  // Follows the /overview + remote-safety pattern: raw tailwind color with an
  // explicit dark: variant so it flips correctly under forced dark mode. Active
  // states (pulse:true) render a clean spinner via spinCls; terminal ones a dot.
  running: {
    label: 'Running',
    classes: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
    dot: 'bg-sky-500 dark:bg-sky-400',
    pulse: true,
    spinCls: 'border-sky-500/30 border-t-sky-500',
  },
  stalled: {
    label: 'Stalled',
    classes: 'bg-amber-500/20 text-amber-700 dark:text-amber-300',
    dot: 'bg-amber-500 dark:bg-amber-400',
    pulse: true,
    spinCls: 'border-amber-500/30 border-t-amber-500',
  },
  completed: {
    label: 'Done',
    classes: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
    dot: 'bg-emerald-500 dark:bg-emerald-400',
    pulse: false,
    spinCls: '',
  },
  failed: {
    label: 'Failed',
    classes: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
    dot: 'bg-rose-500 dark:bg-rose-400',
    pulse: false,
    spinCls: '',
  },
  queued: {
    label: 'Queued',
    classes: 'bg-ink-800 text-ink-300',
    dot: 'bg-ink-500',
    pulse: false,
    spinCls: '',
  },
};

// A held-for-approval run derives state='completed' but label='Waiting for
// approval'; give it its own amber, spinner treatment (it's active, needs you).
const AWAITING_PRESENTATION: RunPresentation = {
  label: 'Waiting for approval',
  classes: 'bg-amber-500/20 text-amber-700 dark:text-amber-300',
  dot: 'bg-amber-500 dark:bg-amber-400',
  pulse: true,
  spinCls: 'border-amber-500/30 border-t-amber-500',
};

// A `partial` run derives state='completed' but must NOT read as a clean success
// (it skipped a step). The run-detail (/runs/[id]) and workflow-detail surfaces
// already render partial in AMBER; this gives the badge the matching treatment so
// every surface agrees. Keyed off the derived label since 'partial' is not a
// RunState. (Silence/degradation must never read as success.)
const PARTIAL_PRESENTATION: RunPresentation = {
  label: 'Partial',
  classes: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  dot: 'bg-amber-500 dark:bg-amber-400',
  pulse: false,
  spinCls: '',
};

// An orphan run of a PAUSED routine derives state='completed' but label='Paused'.
// It isn't a success and isn't live — give it a quiet, neutral (no-pulse) dot so
// it reads as inert, not as a green "Done".
const PAUSED_PRESENTATION: RunPresentation = {
  label: 'Paused',
  classes: 'bg-ink-500/15 text-ink-600 dark:text-ink-300',
  dot: 'bg-ink-500 dark:bg-ink-400',
  pulse: false,
  spinCls: '',
};

/** Visual treatment for a run-state badge: degraded `partial`, held
 *  `Waiting for approval`, and orphaned `Paused` get their own treatment;
 *  else the per-state spec. */
export function presentationFor(info: RunStateInfo): RunPresentation {
  if (info.label === 'Partial') return PARTIAL_PRESENTATION;
  if (info.label === 'Waiting for approval') return AWAITING_PRESENTATION;
  if (info.label === 'Paused') return PAUSED_PRESENTATION;
  return RUN_STATE_PRESENTATION[info.state];
}

// ── defensive read of skill_runs (the integration slot) ─────────────────────
// The base columns are always present; the 0065 live-state columns may not be
// in the schema yet. We try the rich select first and fall back to the base set
// on a "column does not exist" error, so this works both before and after the
// parallel migration lands, with no code change.

const BASE_COLUMNS = 'id, skill_slug, source, status, ran_at, output_markdown, review_status';
const STATE_COLUMNS = 'run_state, started_at, last_progress_at, completed_at, expected_duration_ms, stalled_at, verification_status';

// PostgREST raises 42703 (undefined_column) when we ask for a column that does
// not exist yet. That, and only that, triggers the fallback.
function isMissingColumn(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === '42703' || /column .* does not exist/i.test(error.message || '');
}

export type SelectRunsOpts = {
  limit?: number;
  /** Only rows that produced a deliverable (output_markdown IS NOT NULL). */
  onlyWithOutput?: boolean;
  /** Extra base columns to fetch (e.g. '/runs' needs delivery, duration_ms). */
  extraColumns?: string;
  /** Scope to one agent's runs (the agent page's Runs tab). */
  slug?: string;
};

/**
 * selectRuns - recent skill_runs for the caller (RLS-scoped), newest first,
 * including live-state columns when the schema has them. Falls back cleanly to
 * the base columns (state columns dropped) until migration 0065 lands.
 */
export async function selectRuns(
  supabase: SupabaseClient,
  opts: SelectRunsOpts = {},
): Promise<RunRow[]> {
  const limit = opts.limit ?? 50;
  const base = opts.extraColumns ? `${BASE_COLUMNS}, ${opts.extraColumns}` : BASE_COLUMNS;
  const rich = `${base}, ${STATE_COLUMNS}`;
  const build = (cols: string) => {
    let q = supabase.from('skill_runs').select(cols).order('ran_at', { ascending: false }).limit(limit);
    if (opts.onlyWithOutput) q = q.not('output_markdown', 'is', null);
    if (opts.slug) q = q.eq('skill_slug', opts.slug);
    return q;
  };

  const withoutManagerScaffolds = async (rows: RunRow[]): Promise<RunRow[]> => {
    if (!rows.length) return rows;
    const { data, error } = await supabase
      .from('run_requests')
      .select('run_id')
      .in('kind', ['judge', 'recover'])
      .in('run_id', rows.map((row) => row.id));
    // Preserve primary history if this ancillary classification read is
    // temporarily unavailable. Direct permalinks have a second target guard.
    if (error) return rows;
    const hidden = new Set(((data as Array<{ run_id: string | null }> | null) ?? [])
      .map((row) => row.run_id).filter((id): id is string => !!id));
    return rows.filter((row) => !hidden.has(row.id));
  };

  const richRes = await build(rich);
  if (!richRes.error) return withoutManagerScaffolds((richRes.data as unknown as RunRow[]) || []);
  if (!isMissingColumn(richRes.error)) {
    // A real error (auth, RLS, network): surface nothing rather than throwing,
    // matching the rest of the dashboard's degrade-to-empty server reads.
    return [];
  }
  const baseRes = await build(base);
  return baseRes.error ? [] : withoutManagerScaffolds((baseRes.data as unknown as RunRow[]) || []);
}
