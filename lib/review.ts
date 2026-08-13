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

export type ReviewSessionArtifact = {
  artifactId: string;
  purpose: 'review_target' | 'supporting';
  displayName: string;
  createdAt: string;
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
  reviewerResolution: null | {
    id: string;
    issueId: string;
    reviewSessionId: string;
    reviewSubmissionId: string | null;
    resolvedAt: string;
    actor: { kind: 'reviewer_dashboard_user'; userId: string; provenance: Record<string, unknown> };
  };
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

export type ReviewProductionSegment = {
  id: string;
  label: string;
  ordinal: number;
  state: 'pending' | 'rendering' | 'qa_failed' | 'preview_ready';
  writableRange: { startFrame: number; endFrameExclusive: number };
  previewRange: { startFrame: number; endFrameExclusive: number } | null;
  writableOffsetFrames: number | null;
  artifact: ReviewArtifact | null;
};

export type ReviewProduction = {
  id: string;
  qualityMode: 'professional';
  planDigest: string;
  fps: number;
  totalFrames: number;
  finalRender: { ready: boolean; reasons: string[] };
  segments: ReviewProductionSegment[];
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
  production: ReviewProduction;
  session: ReviewSession;
  reviewArtifacts: ReviewSessionArtifact[];
  issues: ReviewIssue[];
  sources: Record<string, SourceState>;
  live: boolean;
};

const PACKET_UNAVAILABLE: ReviewPacket = {
  ok: false, run: null, lineage: { rootRunId: null, versions: [] }, artifacts: [],
  judgment: null, verification: { receipts: [] }, production: null, session: null, issues: [],
  reviewArtifacts: [],
  sources: { review_packet: 'unavailable' }, live: false,
};

async function sessionToken(): Promise<string | null> {
  const { createClient } = await import('@/lib/supabase/server');
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

// ── response parsers ────────────────────────────────────────────────────────
//
// A 200 IS NOT A CONTRACT. The readers below used to coerce whatever arrived into a
// valid-looking status: `items: null` became `[]`, a missing `sources` became `{}`.
// The result was the exact lie this whole surface exists to prevent — with no source
// keys there is nothing to report as unavailable, so `{ ok: true, items: null,
// sources: {} }` rendered a confident "Nothing is waiting for your review."
//
// So parsing is now REJECTION, not coercion: a response that does not carry the shape
// we contracted for is unavailable, and unavailable is loud. Extra keys are allowed —
// the backend must be free to add sources without breaking older clients — but every
// key we currently depend on must be present and three-valued.

const SOURCE_STATES = new Set<SourceState>(['ready', 'unavailable', 'disabled']);

/** Sources the queue is contracted to report. Extra keys are permitted. */
export const QUEUE_SOURCE_KEYS = ['holds', 'judgments', 'sessions', 'acceptance', 'issueCounts', 'deliveredOutputs'] as const;
/** Sources the packet is contracted to report. Extra keys are permitted. */
export const PACKET_SOURCE_KEYS = ['run', 'lineage', 'artifacts', 'judgment', 'verification', 'production', 'session', 'issues', 'reviewer_resolutions', 'review_artifacts'] as const;

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Every contracted key present AND a legal three-valued state. An unknown state string
 * is rejected rather than passed through: a consumer testing `=== 'unavailable'` would
 * silently treat `"degraded"` as healthy.
 */
function parseSources(raw: unknown, required: readonly string[]): Record<string, SourceState> | null {
  if (!isObject(raw)) return null;
  for (const key of required) {
    if (!(key in raw)) return null;
  }
  const out: Record<string, SourceState> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!SOURCE_STATES.has(v as SourceState)) return null;
    out[k] = v as SourceState;
  }
  return out;
}

const KNOWN_REASONS = new Set<string>(['new_result', 'in_review', 'judge', 'judge_repair_unattended', 'judge_repair_exhausted', 'approval']);

const isId = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
/** A real SHA-256. `sha256: ""` is a string, and it anchors nothing. */
const SHA256_RE = /^[a-f0-9]{64}$/i;
const isDigest = (v: unknown): v is string => typeof v === 'string' && SHA256_RE.test(v);
const isNullableString = (v: unknown) => v === null || v === undefined || typeof v === 'string';
const isNullableNumber = (v: unknown) => v === null || typeof v === 'number';

/**
 * A queue ROW must carry the fields the row actually uses. `items: [{}]` passed the
 * old Array.isArray check and rendered an agent called "undefined" linking to
 * /review/undefined — a dead row that looks like real review work.
 *
 * `reason` is required but NOT restricted to the known set: the backend must stay free
 * to add a classification without breaking older clients. Unknown values are surfaced
 * honestly by reasonLabel rather than silently downgraded to "New result".
 */
function isValidQueueItem(v: unknown): v is ReviewQueueItem {
  if (!isObject(v)) return false;
  // links
  if (!isId(v.rootRunId) || !isId(v.latestRunId)) return false;
  // classification
  if (typeof v.reason !== 'string' || !v.reason) return false;
  if (!isNullableString(v.slug) || !isNullableString(v.holdKind) || !isNullableString(v.judgeVerdict)) return false;
  // counts and lineage — null is meaningful ("we could not count"), undefined is not
  if (!isNullableNumber(v.unresolvedIssueCount)) return false;
  if (!isNullableNumber(v.versionCount)) return false;
  if (typeof v.lineageAvailable !== 'boolean') return false;
  if (!isNullableString(v.latestAt)) return false;
  return true;
}

/** An artifact must carry what the preview and the anchor digest need. */
function isValidArtifact(v: unknown, runId: string): boolean {
  if (!isObject(v)) return false;
  if (!isId(v.id) || !isId(v.runId)) return false;
  // BOUND TO THIS RUN. An artifact carrying another run's id would render under this
  // run's heading and be anchored against as if it were this run's deliverable.
  if (v.runId !== runId) return false;
  if (typeof v.relativePath !== 'string' || !v.relativePath) return false;
  if (typeof v.status !== 'string' || !v.status) return false;
  if (!isNullableString(v.role)) return false;
  // A VALIDATED artifact must carry a REAL digest. `sha256: ""` is a string and passes
  // a typeof check, but it anchors nothing: every issue made against it would compare
  // equal to an empty digest and never register as stale.
  if (v.status === 'validated') {
    if (!isDigest(v.sha256)) return false;
  } else if (!(v.sha256 === null || v.sha256 === undefined || isDigest(v.sha256))) {
    return false;
  }
  return true;
}

const SEGMENT_STATES = new Set(['pending', 'rendering', 'qa_failed', 'preview_ready']);

function isValidFrameRange(v: unknown): v is { startFrame: number; endFrameExclusive: number } {
  return isObject(v)
    && Number.isInteger(v.startFrame)
    && Number.isInteger(v.endFrameExclusive)
    && Number(v.startFrame) >= 0
    && Number(v.endFrameExclusive) > Number(v.startFrame);
}

function isValidProxyArtifact(v: unknown): v is ReviewArtifact {
  if (!isObject(v) || !isId(v.id) || !isId(v.runId)) return false;
  if (typeof v.relativePath !== 'string' || !v.relativePath) return false;
  return v.role === 'review_proxy' && v.status === 'validated' && isDigest(v.sha256);
}

function isValidProduction(v: unknown): v is NonNullable<ReviewProduction> {
  if (!isObject(v) || !isId(v.id) || v.qualityMode !== 'professional' || !isDigest(v.planDigest)) return false;
  if (!(typeof v.fps === 'number' && Number.isFinite(v.fps) && v.fps > 0)) return false;
  if (!(Number.isInteger(v.totalFrames) && Number(v.totalFrames) > 0)) return false;
  if (!isObject(v.finalRender) || typeof v.finalRender.ready !== 'boolean') return false;
  if (!Array.isArray(v.finalRender.reasons) || !v.finalRender.reasons.every((r) => typeof r === 'string' && r.length > 0)) return false;
  if (!Array.isArray(v.segments) || v.segments.length === 0) return false;

  const ids = new Set<string>();
  const ordinals = new Set<number>();
  for (const segment of v.segments) {
    if (!isObject(segment) || !isId(segment.id) || typeof segment.label !== 'string' || !segment.label) return false;
    if (!Number.isInteger(segment.ordinal) || Number(segment.ordinal) < 0) return false;
    if (ids.has(segment.id) || ordinals.has(Number(segment.ordinal))) return false;
    ids.add(segment.id);
    ordinals.add(Number(segment.ordinal));
    if (!SEGMENT_STATES.has(String(segment.state)) || !isValidFrameRange(segment.writableRange)) return false;

    if (segment.state === 'pending') {
      if (segment.previewRange !== null || segment.writableOffsetFrames !== null || segment.artifact !== null) return false;
    } else {
      if (!isValidFrameRange(segment.previewRange) || !Number.isInteger(segment.writableOffsetFrames)) return false;
      if (Number(segment.writableOffsetFrames) < 0) return false;
      const writable = segment.writableRange;
      const preview = segment.previewRange;
      if (preview.startFrame > writable.startFrame || preview.endFrameExclusive < writable.endFrameExclusive) return false;
      if (Number(segment.writableOffsetFrames) !== writable.startFrame - preview.startFrame) return false;
      if (segment.state === 'preview_ready') {
        if (!isValidProxyArtifact(segment.artifact)) return false;
      } else if (segment.artifact !== null) return false;
    }
  }
  return true;
}

/** An issue must carry what the rail renders and what an edit/dismiss targets. */
function isValidIssue(v: unknown, runId: string, sessionId: string | null): boolean {
  if (!isObject(v)) return false;
  if (!isId(v.id) || !isId(v.sessionId) || !isId(v.runId)) return false;
  // BOUND. An issue from another run — or another session of this run — would appear in
  // this rail, and editing or dismissing it would mutate feedback the user never wrote
  // here. A packet with no session cannot legitimately carry issues at all.
  if (v.runId !== runId) return false;
  if (sessionId === null) return false;
  if (typeof v.kind !== 'string' || !v.kind) return false;
  if (typeof v.body !== 'string') return false;
  if (typeof v.status !== 'string' || !v.status) return false;
  // the anchor drives seeking and staleness; an absent one is not "no location"
  if (!isObject(v.anchor)) return false;
  if (!Object.prototype.hasOwnProperty.call(v, 'reviewerResolution')) return false;
  if (v.reviewerResolution !== null) {
    const rr = v.reviewerResolution;
    if (!isObject(rr) || !isId(rr.id) || !isId(rr.issueId) || rr.issueId !== v.id || !isId(rr.reviewSessionId)
        || !isNullableString(rr.reviewSubmissionId) || typeof rr.resolvedAt !== 'string'
        || !isObject(rr.actor) || rr.actor.kind !== 'reviewer_dashboard_user'
        || !isId(rr.actor.userId) || !isObject(rr.actor.provenance)) return false;
  }
  return true;
}

/** A lineage version is a link target. */
function isValidVersion(v: unknown): boolean {
  return isObject(v) && isId(v.runId) && typeof v.label === 'string' && !!v.label;
}

/** A session drives every lifecycle action, so it needs an id and a state. */
function isValidSession(v: unknown, runId: string): boolean {
  if (!isObject(v) || !isId(v.id) || typeof v.state !== 'string' || !v.state) return false;
  // Every lifecycle action derives from this session; one belonging to another run
  // would submit or accept the wrong work.
  if (!isId(v.runId) || v.runId !== runId) return false;
  return true;
}

/**
 * The UI renders `Judge: {verdict}` and the summary beneath it. `judgment: {}` passed
 * the old isObject check and rendered "Judge: undefined".
 */
function isValidJudgment(v: unknown): boolean {
  if (!isObject(v)) return false;
  if (!isId(v.id)) return false;
  if (typeof v.verdict !== 'string' || !v.verdict) return false;
  if (typeof v.summary !== 'string') return false;
  if (!isNullableString(v.nextAction) || !isNullableString(v.createdAt)) return false;
  return true;
}

/** The UI renders `{adapterKind}: {status}`. `receipts: [{}]` rendered "undefined: undefined". */
function isValidReceipt(v: unknown): boolean {
  if (!isObject(v)) return false;
  if (!isId(v.id)) return false;
  if (typeof v.adapterKind !== 'string' || !v.adapterKind) return false;
  if (typeof v.status !== 'string' || !v.status) return false;
  return true;
}

/**
 * Parse a queue response. Returns null when the payload is not the shape we contracted
 * for, so the caller can return QUEUE_UNAVAILABLE rather than a live-looking empty.
 */
export function parseReviewQueueResponse(body: unknown): ReviewQueue | null {
  if (!isObject(body) || body.ok !== true) return null;
  // MANDATORY. `items: null` is malformed, not "no items".
  if (!Array.isArray(body.items)) return null;
  // ...and every ROW must be usable. One malformed row poisons the whole read rather
  // than being dropped: silently discarding it would under-report review work, which
  // is the same class of lie as an empty list.
  if (!body.items.every(isValidQueueItem)) return null;
  const sources = parseSources(body.sources, QUEUE_SOURCE_KEYS);
  if (!sources) return null;
  // `total` is legitimately null (a per-source cap fired and the count was never
  // observed), but it must be null or a number — never absent-and-guessed.
  if (!(body.total === null || typeof body.total === 'number')) return null;
  if (typeof body.visibleCount !== 'number') return null;
  if (typeof body.truncated !== 'boolean') return null;
  return {
    items: body.items as ReviewQueueItem[],
    truncated: body.truncated,
    total: body.total as number | null,
    visibleCount: body.visibleCount,
    sources,
    live: true,
  };
}

/**
 * Parse a packet response. Returns null on a malformed shape so the caller can return
 * PACKET_UNAVAILABLE — an "actionable empty review" (a real run id, no artifacts, no
 * issues, nothing marked unavailable) would tell the user their agent delivered
 * nothing, which is a different and much worse claim than "we could not load this".
 */
export function parseReviewPacketResponse(body: unknown, expectedRunId?: string): ReviewPacket | null {
  if (!isObject(body) || body.ok !== true) return null;
  if (!isObject(body.run) || !isId(body.run.id)) return null;
  // IDENTITY. A valid-looking packet for a DIFFERENT run is the worst shape here: the
  // page would render run B's artifacts, lineage and issues under run A's heading, and
  // every action the user then took would target the wrong run. Refuse rather than
  // display someone else's work as this one.
  if (expectedRunId && body.run.id !== expectedRunId) return null;
  const runId = body.run.id;

  // SESSION FIRST — every issue must belong to it, so it has to be resolved before
  // they can be checked.
  if (!(body.session === null || isValidSession(body.session, runId))) return null;
  const sessionId = body.session === null ? null : (body.session as Record<string, unknown>).id as string;

  if (!Array.isArray(body.artifacts) || !body.artifacts.every((a) => isValidArtifact(a, runId))) return null;
  const artifactIds = new Set((body.artifacts as Array<Record<string, unknown>>).map((a) => String(a.id)));

  if (!Array.isArray(body.reviewArtifacts) || !body.reviewArtifacts.every((entry) => {
    if (!isObject(entry) || !isId(entry.artifactId) || !isId(entry.displayName) || !isId(entry.createdAt)) return false;
    if (!['review_target', 'supporting'].includes(String(entry.purpose))) return false;
    if (!artifactIds.has(String(entry.artifactId))) return false;
    const artifact = (body.artifacts as Array<Record<string, unknown>>).find((a) => a.id === entry.artifactId);
    return entry.purpose === 'review_target'
      ? artifact?.role === 'review_input'
      : artifact?.role === 'review_attachment';
  })) return null;
  const reviewArtifactIds = (body.reviewArtifacts as Array<Record<string, unknown>>).map((entry) => String(entry.artifactId));
  if (new Set(reviewArtifactIds).size !== reviewArtifactIds.length) return null;

  if (!Array.isArray(body.issues) || !body.issues.every((i) => isValidIssue(i, runId, sessionId))) return null;
  // REFERENTIAL INTEGRITY. An issue anchored to an artifact the packet does not contain
  // renders a rail entry that can never be seeked to or highlighted — a comment
  // pointing at nothing.
  for (const i of body.issues as Array<Record<string, unknown>>) {
    if (i.artifactId !== null && i.artifactId !== undefined && !artifactIds.has(String(i.artifactId))) return null;
  }
  if (body.session !== null) {
    const sel = (body.session as Record<string, unknown>).selectedArtifactId;
    if (sel !== null && sel !== undefined && !artifactIds.has(String(sel))) return null;
  }

  // Sources first: the lineage rule below depends on whether lineage was READABLE.
  const sources = parseSources(body.sources, PACKET_SOURCE_KEYS);
  if (!sources) return null;
  // A non-ready source cannot truthfully supply rows. Accepting stale-looking rows
  // would make attachment controls appear authoritative over a read that failed.
  if (sources.review_artifacts !== 'ready' && reviewArtifactIds.length > 0) return null;

  if (!isObject(body.lineage)) return null;
  const versions = (body.lineage as Record<string, unknown>).versions;
  if (!Array.isArray(versions) || !versions.every(isValidVersion)) return null;
  const versionIds = (versions as Array<Record<string, unknown>>).map((v) => String(v.runId));
  // Duplicate ids would render two rows claiming to be the same version.
  if (new Set(versionIds).size !== versionIds.length) return null;
  // A SUCCESSFUL lineage always contains at least the run being viewed, as "Original".
  // So an EMPTY versions array is only honest when lineage was not readable — when the
  // source says `ready`, empty is malformed, and rendering it produced a confident
  // "No revisions yet." over a computation that actually failed or was mis-shaped.
  // (An empty array cannot include the run id, so this single check also rejects the
  // empty-while-ready case — no separate length guard, which would be decorative.)
  if (sources.lineage === 'ready') {
    if (!versionIds.includes(runId)) return null;
  } else if (versionIds.length > 0 && !versionIds.includes(runId)) {
    return null;
  }

  if (!isObject(body.verification)) return null;
  const receipts = (body.verification as Record<string, unknown>).receipts;
  if (!Array.isArray(receipts) || !receipts.every(isValidReceipt)) return null;

  // judgment is legitimately null; when present every field the UI renders must be there.
  if (!(body.judgment === null || isValidJudgment(body.judgment))) return null;
  if (!(body.production === null || isValidProduction(body.production))) return null;

  return {
    ok: true,
    run: body.run as ReviewPacket['run'],
    lineage: body.lineage as ReviewPacket['lineage'],
    artifacts: body.artifacts as ReviewArtifact[],
    judgment: body.judgment as ReviewPacket['judgment'],
    verification: body.verification as ReviewPacket['verification'],
    production: body.production as ReviewProduction,
    session: body.session as ReviewSession,
    reviewArtifacts: body.reviewArtifacts as ReviewSessionArtifact[],
    issues: body.issues as ReviewIssue[],
    sources,
    live: true,
  };
}

export async function getReviewQueue(): Promise<ReviewQueue> {
  const jwt = await sessionToken();
  // Not signed in is not a failure to report: nothing can be awaiting review.
  if (!jwt) return { ...QUEUE_UNAVAILABLE, sources: {}, live: false };
  try {
    const res = await fetch(`${BACKEND}/api/v2/review`, {
      headers: { authorization: `Bearer ${jwt}` },
      cache: 'no-store',
      // The backend resolves independent lineage reads concurrently, but this is a
      // human-facing queue over several sources and can still encounter a cold DB.
      // Production took ~12s before that fix; keep enough margin that a transient cold
      // read does not turn valid review work into a false unavailable state.
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return QUEUE_UNAVAILABLE;
    const body = await res.json();
    // Reject, do not coerce. A malformed 200 is a read we could not make.
    return parseReviewQueueResponse(body) ?? QUEUE_UNAVAILABLE;
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
    // Reject, do not coerce. Defaulting the missing pieces would render an
    // "actionable empty review" over a response we did not understand.
    return parseReviewPacketResponse(body, runId) ?? PACKET_UNAVAILABLE;
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
    case 'new_result': return 'New result';
    // An unknown classification from a newer backend must NOT be downgraded to
    // "New result" — that is the same silent demotion the backend's own precedence
    // rules exist to prevent. Say plainly that it needs a look.
    default: return 'Needs review';
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
