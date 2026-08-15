/**
 * lib/review-evidence-status.ts — the Submit gate for spatial evidence (Wave 2).
 *
 * A spatial issue must not be submitted as if complete while its screenshot evidence
 * is silently missing. The chosen state machine is the strict one, in three layers:
 * this module decides what the SUBMIT BUTTON may offer, the backend's compile gate
 * refuses anyway, and the Desktop executor fails closed on a marked continuation
 * without attached evidence. The button is therefore honest UI over a server rule,
 * never the rule itself.
 *
 * THE LOCAL PREVIEW IS NEVER "VERIFIED". The browser draws the pin instantly, but the
 * only thing this module will call ready is the backend's own `validated` projection —
 * rendered from the digest-verified original by the Desktop, hashed, and recorded.
 * `pending` is waiting; `unavailable`/`stale`/`revoked` are failures a retry can
 * meaningfully re-request; an unreadable status read is UNKNOWN, which blocks without
 * accusing anyone's screenshots of being missing.
 *
 * Pure on purpose: which submissions are blocked is exactly the kind of claim that
 * must be executable in a test rather than asserted by reading JSX.
 */

export type SessionEvidenceEntry = {
  issueId: string;
  anchorDigest: string;
  evidence?: {
    status?: string;
    ready?: boolean;
    reason?: string | null;
  } | null;
};

export type SessionEvidenceStatus = {
  state: 'ready' | 'unavailable' | 'disabled' | string;
  issues: SessionEvidenceEntry[];
} | null;

/** Does this locally-known issue carry a v2 spatial anchor? */
export function isSpatialIssue(issue: { anchor?: unknown }): boolean {
  const a = issue?.anchor as { version?: unknown; type?: unknown } | null | undefined;
  return !!a && typeof a === 'object' && a.version === 2 && a.type === 'visual_spatial';
}

/**
 * How many consecutive polls a capture may sit `pending` before the gate calls it
 * STALLED (~100s at the room's 4s poll). A stall is not a failure the backend
 * reported — it is this module refusing to let "still working" become a silent
 * forever-lock: the submit stays blocked (fail closed, the compile gate would refuse
 * anyway), but the user sees exactly which items stalled and can retry them.
 */
export const STALLED_POLL_THRESHOLD = 25;

/** Consecutive-`pending` poll counts, keyed by issue id. Owned by the poller. */
export type PendingPollCounts = Record<string, number>;

/**
 * Advance the stall clock from ONE successful poll. A capture counted here is one the
 * backend just said is `pending`; anything else — validated, failed, absent — drops
 * off the clock entirely, so a capture that completes and is later re-requested
 * starts from zero. An unreadable poll returns the previous counts untouched: it is
 * evidence of nothing, neither of progress nor of stalling.
 */
export function trackPendingPolls(prev: PendingPollCounts, status: SessionEvidenceStatus): PendingPollCounts {
  if (!status || status.state !== 'ready') return prev;
  const next: PendingPollCounts = {};
  for (const entry of status.issues) {
    const ev = entry?.evidence ?? null;
    if (ev?.status === 'pending' && ev?.ready !== true) {
      const id = String(entry.issueId);
      next[id] = (prev[id] ?? 0) + 1;
    }
  }
  return next;
}

export type EvidenceGate = {
  /** May Submit be offered? False ONLY when every spatial draft has validated evidence. */
  blocked: boolean;
  reason: 'none_required' | 'ready' | 'waiting' | 'failed' | 'stalled' | 'disabled' | 'unknown';
  /** Draft issues whose capture failed or stalled and can be re-requested. NEVER a ready one. */
  retryIssueIds: string[];
  /** Draft issues still pending (or not yet requested). */
  waitingIssueIds: string[];
  /** The subset of retryIssueIds that are stalled `pending` captures, not failures. */
  stalledIssueIds: string[];
  /** How many spatial drafts already hold validated evidence — the "N of M" numerator. */
  verifiedCount: number;
  /** How many spatial drafts the gate is watching — the "N of M" denominator. */
  spatialCount: number;
  /** The one line the footer shows while blocked, or null when it isn't. */
  statusLine: string | null;
};

/**
 * Decide the gate from the local draft list and the last status poll.
 *
 * `status` null means "no successful read yet" — UNKNOWN, blocked. The distinction
 * between waiting and failed drives which affordance appears: waiting is a spinner
 * sentence, failed is a Retry button. Both block.
 */
export function evidenceGate(args: {
  draftIssues: Array<{ id: string; anchor?: unknown }>;
  status: SessionEvidenceStatus;
  /** The poller's stall clock. Absent means "no stall detection", never "stalled". */
  pendingPolls?: PendingPollCounts;
}): EvidenceGate {
  const spatial = args.draftIssues.filter(isSpatialIssue);
  if (!spatial.length) {
    return {
      blocked: false, reason: 'none_required', retryIssueIds: [], waitingIssueIds: [],
      stalledIssueIds: [], verifiedCount: 0, spatialCount: 0, statusLine: null,
    };
  }
  const status = args.status;
  // `disabled` is the backend's word for "0155 is not applied here". With spatial
  // drafts present that is a contradiction the server's own compile gate fails closed
  // on (run-review.service compileSubmission refuses it as an unreadable evidence
  // source) — so the button mirrors it: BLOCKED, in typed words, with a retry
  // affordance, never the generic "Checking…" spinner that reads as forever-pending.
  if (status && status.state === 'disabled') {
    return {
      blocked: true,
      reason: 'disabled',
      retryIssueIds: spatial.map((i) => i.id),
      waitingIssueIds: [],
      stalledIssueIds: [],
      verifiedCount: 0,
      spatialCount: spatial.length,
      statusLine: 'Screenshot capture is disabled on this backend, but this review has visual comments that need verified frames. Sending stays blocked — retry the captures, or remove the visual comments.',
    };
  }
  if (!status || (status.state !== 'ready')) {
    return {
      blocked: true,
      reason: 'unknown',
      retryIssueIds: [],
      waitingIssueIds: spatial.map((i) => i.id),
      stalledIssueIds: [],
      verifiedCount: 0,
      spatialCount: spatial.length,
      statusLine: 'Checking screenshot evidence for your visual feedback…',
    };
  }
  const polls = args.pendingPolls ?? {};
  const byIssueId = new Map(status.issues.map((e) => [String(e.issueId), e]));
  const waiting: string[] = [];
  const failed: string[] = [];
  const stalled: string[] = [];
  for (const issue of spatial) {
    const entry = byIssueId.get(String(issue.id));
    const ev = entry?.evidence ?? null;
    if (ev?.ready === true) continue;
    // pending (or never requested, or entry missing) is WAITING; a terminal failure
    // state is FAILED and retryable; a pending capture past the stall bound is
    // STALLED — blocked like waiting, retryable like failed. Ready is the only pass.
    const st = ev?.status ?? null;
    if (st === 'unavailable' || st === 'revoked' || st === 'stale') failed.push(issue.id);
    else if (st === 'pending' && (polls[String(issue.id)] ?? 0) >= STALLED_POLL_THRESHOLD) stalled.push(issue.id);
    else waiting.push(issue.id);
  }
  // Derived, not counted in the loop, so a ready projection can never be double-booked.
  const verifiedCount = spatial.length - waiting.length - failed.length - stalled.length;
  const progress = `${verifiedCount} of ${spatial.length} verified`;
  if (!waiting.length && !failed.length && !stalled.length) {
    return {
      blocked: false, reason: 'ready', retryIssueIds: [], waitingIssueIds: [],
      stalledIssueIds: [], verifiedCount, spatialCount: spatial.length, statusLine: null,
    };
  }
  if (failed.length || stalled.length) {
    const parts: string[] = [];
    if (failed.length) {
      parts.push(failed.length === 1 ? 'A screenshot capture failed' : `${failed.length} screenshot captures failed`);
    }
    if (stalled.length) {
      parts.push(stalled.length === 1
        ? 'a capture looks stalled (still pending after ~100s)'
        : `${stalled.length} captures look stalled (still pending after ~100s)`);
    }
    return {
      blocked: true,
      // `stalled` only when NOTHING failed outright — a real failure is the louder fact.
      reason: failed.length ? 'failed' : 'stalled',
      retryIssueIds: [...failed, ...stalled],
      waitingIssueIds: waiting,
      stalledIssueIds: stalled,
      verifiedCount,
      spatialCount: spatial.length,
      statusLine: `${parts.join(', and ')}. Retry before submitting — ${progress}.`,
    };
  }
  const n = waiting.length;
  return {
    blocked: true,
    reason: 'waiting',
    retryIssueIds: [],
    waitingIssueIds: waiting,
    stalledIssueIds: [],
    verifiedCount,
    spatialCount: spatial.length,
    statusLine: n === 1
      ? `Capturing screenshot evidence for your visual feedback… ${progress}. Submit unlocks when all are verified.`
      : `Capturing screenshot evidence for ${n} visual comments… ${progress}. Submit unlocks when all are verified.`,
  };
}

/** The per-issue chip shown on a spatial issue card. Null renders nothing. */
export function evidenceChip(
  ev: { status?: string; ready?: boolean } | null | undefined,
  opts: { stalled?: boolean } = {},
): {
  label: string; tone: 'ok' | 'waiting' | 'failed';
} | null {
  // Verified is checked FIRST: a stale stall count must never relabel a capture the
  // backend has already validated.
  if (ev?.ready === true) return { label: 'Screenshot: verified', tone: 'ok' };
  if (!ev) return { label: 'Screenshot: waiting', tone: 'waiting' };
  const st = ev.status ?? '';
  if (st === 'pending') {
    return opts.stalled === true
      ? { label: 'Screenshot: stalled — retry', tone: 'failed' }
      : { label: 'Screenshot: capturing…', tone: 'waiting' };
  }
  if (st === 'unavailable') return { label: 'Screenshot: failed', tone: 'failed' };
  if (st === 'stale' || st === 'revoked') return { label: 'Screenshot: outdated', tone: 'failed' };
  return { label: 'Screenshot: waiting', tone: 'waiting' };
}
