/**
 * lib/review.ts — the client for the Review Room API (backend §5.9).
 *
 * Mirrors lib/attention.ts deliberately: this returns a STATUS, never null, and a
 * failed read sets `live: false` with zero items. THE ONE RULE: unavailable is NOT
 * empty. The backend goes to real trouble to keep that distinction — every queue and
 * packet source is three-valued, an unreadable issue count comes back as `null` rather
 * than `0`, and a capped list says `truncated` — and all of it is undone by a client
 * that degrades to a calm "nothing to review".
 *
 * Shapes here were read off the LIVE deployed endpoint, not inferred from the spec.
 * That mattered: the first live call is what exposed `holds: "unavailable"` (a P0 the
 * spec could never have told us about).
 */

const BACKEND = (
  process.env.NEXT_PUBLIC_IMPLEXA_API_URL || 'https://core.implexa.ai'
).replace(/\/$/, '');

/**
 * Three-valued, per source. `disabled` is distinct from `unavailable` on purpose:
 * the delivered-output source is fail-closed until REVIEW_ROLLOUT_CUTOFF is set, and
 * "switched off" is a different fact from "we could not read it".
 */
export type SourceState = 'ready' | 'unavailable' | 'disabled';

/**
 * Why a run is in Review. PRECEDENCE IS THE BACKEND'S — the client must not
 * re-derive or collapse these. `judge_repair_unattended` in particular is a
 * distinct fact: the Judge asked for changes and NOTHING is acting on it (default
 * policy never enqueues a repair, or the enqueue failed). Folding it into `judge`
 * would hide the runs most in need of a human.
 */
export type ReviewReason =
  | 'new_result'
  | 'in_review'
  | 'judge'
  | 'judge_repair_unattended'
  | 'judge_repair_exhausted'
  | 'approval';

export type ReviewQueueItem = {
  rootRunId: string;
  latestRunId: string;
  slug: string | null;
  reason: ReviewReason;
  holdKind: string | null;
  judgeVerdict: string | null;
  repairExhausted?: boolean;
  repairUnattended?: boolean;
  judgeRepairRound?: number | null;
  sessionId?: string | null;
  sessionState?: string | null;
  /** NULL means "we could not count", NEVER "zero unresolved". */
  unresolvedIssueCount: number | null;
  versionCount: number | null;
  lineageAvailable: boolean;
  latestAt: string | null;
};

export type ReviewQueue = {
  items: ReviewQueueItem[];
  truncated: boolean;
  /** null when a per-source cap fired — the count was never observed. */
  total: number | null;
  visibleCount: number;
  sources: Record<string, SourceState>;
  /** false when the endpoint could not be reached at all. */
  live: boolean;
};

const QUEUE_UNAVAILABLE: ReviewQueue = {
  items: [], truncated: false, total: null, visibleCount: 0,
  sources: { review_endpoint: 'unavailable' }, live: false,
};

export type ReviewArtifact = {
  id: string;
  runId: string;
  relativePath: string;
  role: string | null;
  status: 'declared' | 'validated' | 'rejected' | string;
  sha256: string | null;
  sizeBytes: number | null;
  mtime: string | null;
  validatedAt: string | null;
  // NOTE: there is deliberately NO validatedPath. The browser cannot open a local
  // file and must never learn where one lives; only the desktop preview endpoint
  // (behind the desktop API key) returns that.
};

export type ReviewIssue = {
  id: string;
  sessionId: string;
  runId: string;
  artifactId: string | null;
  kind: string;
  anchor: Record<string, unknown>;
  body: string;
  status: 'draft' | 'submitted' | 'resolved' | 'dismissed' | string;
  submittedRequestId: string | null;
  createdAt: string | null;
};

export type ReviewSession = {
  id: string;
  runId: string;
  selectedArtifactId: string | null;
  state: 'draft' | 'submitting' | 'submitted' | 'accepted' | 'dismissed' | string;
  submittedRequestId: string | null;
  submittedIssueIds: string[] | null;
  compiledBrief: string | null;
  acceptedAt: string | null;
} | null;

export type ReviewPacket = {
  ok: boolean;
  run: {
    id: string; slug: string | null; runState: string | null; status: string | null;
    reviewStatus: string | null; holdKind: string | null; startedAt: string | null;
  } | null;
  lineage: { rootRunId: string | null; versions: Array<{ runId: string; label: string; runState: string | null; startedAt: string | null }> };
  artifacts: ReviewArtifact[];
  judgment: { id: string; verdict: string; summary: string; nextAction: string | null; createdAt: string | null } | null;
  verification: { receipts: Array<{ id: string; adapterKind: string; status: string; createdAt: string }> };
  session: ReviewSession;
  issues: ReviewIssue[];
  sources: Record<string, SourceState>;
  live: boolean;
};

const PACKET_UNAVAILABLE: ReviewPacket = {
  ok: false, run: null, lineage: { rootRunId: null, versions: [] }, artifacts: [],
  judgment: null, verification: { receipts: [] }, session: null, issues: [],
  sources: { review_packet: 'unavailable' }, live: false,
};

async function sessionToken(): Promise<string | null> {
  const { createClient } = await import('@/lib/supabase/server');
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

export async function getReviewQueue(): Promise<ReviewQueue> {
  const jwt = await sessionToken();
  // Not signed in is not a failure to report: nothing can be awaiting review.
  if (!jwt) return { ...QUEUE_UNAVAILABLE, sources: {}, live: false };
  try {
    const res = await fetch(`${BACKEND}/api/v2/review`, {
      headers: { authorization: `Bearer ${jwt}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return QUEUE_UNAVAILABLE;
    const body = await res.json();
    if (!body?.ok) return QUEUE_UNAVAILABLE;
    return {
      items: Array.isArray(body.items) ? body.items : [],
      truncated: !!body.truncated,
      // Preserve null. Coercing to 0 would turn "unknown" into a confident count.
      total: typeof body.total === 'number' ? body.total : null,
      visibleCount: typeof body.visibleCount === 'number' ? body.visibleCount : (body.items || []).length,
      sources: (body.sources && typeof body.sources === 'object') ? body.sources : {},
      live: true,
    };
  } catch {
    return QUEUE_UNAVAILABLE;
  }
}

export async function getReviewPacket(runId: string): Promise<ReviewPacket> {
  const jwt = await sessionToken();
  if (!jwt) return PACKET_UNAVAILABLE;
  try {
    const res = await fetch(`${BACKEND}/api/v2/review/runs/${encodeURIComponent(runId)}`, {
      headers: { authorization: `Bearer ${jwt}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return PACKET_UNAVAILABLE;
    const body = await res.json();
    if (!body?.ok) return PACKET_UNAVAILABLE;
    return {
      ok: true,
      run: body.run ?? null,
      lineage: body.lineage ?? { rootRunId: null, versions: [] },
      artifacts: Array.isArray(body.artifacts) ? body.artifacts : [],
      judgment: body.judgment ?? null,
      verification: body.verification ?? { receipts: [] },
      session: body.session ?? null,
      issues: Array.isArray(body.issues) ? body.issues : [],
      sources: (body.sources && typeof body.sources === 'object') ? body.sources : {},
      live: true,
    };
  } catch {
    return PACKET_UNAVAILABLE;
  }
}

// ── honesty helpers ─────────────────────────────────────────────────────────

/** Sources that are genuinely broken. `disabled` is configuration, not failure. */
export function unavailableSources(sources: Record<string, SourceState>): string[] {
  return Object.entries(sources || {}).filter(([, v]) => v === 'unavailable').map(([k]) => k);
}

/**
 * One honest sentence whenever the list cannot be trusted as complete — and the
 * "may I say all-clear?" test. Returns null ONLY when the list is complete and every
 * source answered.
 */
export function reviewQueueWarning(q: Pick<ReviewQueue, 'sources' | 'truncated' | 'live'>): string | null {
  if (!q.live) return "We couldn't load your review queue just now. This list may be incomplete — try again shortly.";
  if (q.truncated) return 'There is more review work than we can show here. This list is not complete.';
  const bad = unavailableSources(q.sources);
  if (bad.length) return "We couldn't check every source just now, so something may be missing from this list.";
  return null;
}

/** True only when we can honestly claim there is nothing to review. */
export function canClaimAllClear(q: Pick<ReviewQueue, 'items' | 'sources' | 'truncated' | 'live'>): boolean {
  return q.items.length === 0 && reviewQueueWarning(q) === null;
}

/**
 * How to render the unresolved-issue count. `null` means the backend could not read
 * it — showing "0 issues" there tells the user their feedback is handled when we do
 * not know that.
 */
export function unresolvedIssueLabel(count: number | null | undefined): string {
  if (count === null || count === undefined) return 'Issue count unavailable';
  if (count === 0) return 'No open issues';
  return count === 1 ? '1 open issue' : `${count} open issues`;
}

/**
 * The headline classification. Distinct copy per reason — collapsing
 * judge_repair_unattended into judge would hide that nothing is acting on the run.
 */
export function reasonLabel(reason: ReviewReason | string): string {
  switch (reason) {
    case 'approval': return 'Approval needed';
    case 'judge_repair_exhausted': return 'Automatic fixes gave up';
    case 'judge_repair_unattended': return 'Needs changes — nothing is fixing it';
    case 'judge': return 'Judge flagged this';
    case 'in_review': return 'In review';
    case 'new_result':
    default: return 'New result';
  }
}

/**
 * The action a row may offer. An approval hold authorizes REMAINING WORK; it is not a
 * delivered result, so it must never render "Accept result" (spec §7.8).
 */
export function primaryActionLabel(item: Pick<ReviewQueueItem, 'reason' | 'holdKind'>): string {
  if (item.reason === 'approval' || item.holdKind === 'approval_before_action') return 'Approve next action';
  return 'Review result';
}

/** Human lineage summary. Never guesses when lineage could not be computed. */
export function versionSummary(item: Pick<ReviewQueueItem, 'versionCount' | 'lineageAvailable'>): string {
  if (!item.lineageAvailable || item.versionCount === null) return 'Version history unavailable';
  if (item.versionCount <= 1) return 'Original';
  return `${item.versionCount} versions`;
}
