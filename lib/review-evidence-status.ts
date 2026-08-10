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

export type EvidenceGate = {
  /** May Submit be offered? False ONLY when every spatial draft has validated evidence. */
  blocked: boolean;
  reason: 'none_required' | 'ready' | 'waiting' | 'failed' | 'unknown';
  /** Draft issues whose capture failed and can be re-requested. */
  retryIssueIds: string[];
  /** Draft issues still pending (or not yet requested). */
  waitingIssueIds: string[];
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
}): EvidenceGate {
  const spatial = args.draftIssues.filter(isSpatialIssue);
  if (!spatial.length) {
    return { blocked: false, reason: 'none_required', retryIssueIds: [], waitingIssueIds: [], statusLine: null };
  }
  const status = args.status;
  if (!status || (status.state !== 'ready')) {
    return {
      blocked: true,
      reason: 'unknown',
      retryIssueIds: [],
      waitingIssueIds: spatial.map((i) => i.id),
      statusLine: 'Checking screenshot evidence for your visual feedback…',
    };
  }
  const byIssueId = new Map(status.issues.map((e) => [String(e.issueId), e]));
  const waiting: string[] = [];
  const failed: string[] = [];
  for (const issue of spatial) {
    const entry = byIssueId.get(String(issue.id));
    const ev = entry?.evidence ?? null;
    if (ev?.ready === true) continue;
    // pending (or never requested, or entry missing) is WAITING; a terminal failure
    // state is FAILED and retryable. Ready is the only pass — everything else blocks.
    const st = ev?.status ?? null;
    if (st === 'unavailable' || st === 'revoked' || st === 'stale') failed.push(issue.id);
    else waiting.push(issue.id);
  }
  if (!waiting.length && !failed.length) {
    return { blocked: false, reason: 'ready', retryIssueIds: [], waitingIssueIds: [], statusLine: null };
  }
  if (failed.length) {
    const n = failed.length;
    return {
      blocked: true,
      reason: 'failed',
      retryIssueIds: failed,
      waitingIssueIds: waiting,
      statusLine: n === 1
        ? 'A screenshot capture failed. Retry it before submitting.'
        : `${n} screenshot captures failed. Retry them before submitting.`,
    };
  }
  const n = waiting.length;
  return {
    blocked: true,
    reason: 'waiting',
    retryIssueIds: [],
    waitingIssueIds: waiting,
    statusLine: n === 1
      ? 'Capturing screenshot evidence for your visual feedback… Submit unlocks when it is verified.'
      : `Capturing screenshot evidence for ${n} visual comments… Submit unlocks when they are verified.`,
  };
}

/** The per-issue chip shown on a spatial issue card. Null renders nothing. */
export function evidenceChip(ev: { status?: string; ready?: boolean } | null | undefined): {
  label: string; tone: 'ok' | 'waiting' | 'failed';
} | null {
  if (!ev) return { label: 'Screenshot: waiting', tone: 'waiting' };
  if (ev.ready === true) return { label: 'Screenshot: verified', tone: 'ok' };
  const st = ev.status ?? '';
  if (st === 'pending') return { label: 'Screenshot: capturing…', tone: 'waiting' };
  if (st === 'unavailable') return { label: 'Screenshot: failed', tone: 'failed' };
  if (st === 'stale' || st === 'revoked') return { label: 'Screenshot: outdated', tone: 'failed' };
  return { label: 'Screenshot: waiting', tone: 'waiting' };
}
