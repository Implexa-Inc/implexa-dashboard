/**
 * Consumer-side parser for the backend's `marketplace-evidence-channels.v1`
 * contract (backend migration 0205).
 *
 * FAIL CLOSED, AND SAY WHICH KIND OF NOTHING IT IS. Three states are genuinely
 * different and the UI must never confuse them:
 *
 *   ready       — a canonical projection. Zero counts inside it are REAL: they
 *                 mean "we looked and there is no evidence yet".
 *   unavailable — absent or malformed. We do NOT know what the evidence is, so
 *                 the resume must say so rather than render four empty cards
 *                 that look like a measured, confident zero.
 *
 * Inventing zeros from a malformed payload is the failure mode this file exists
 * to prevent: it turns "the server did not tell us" into "this agent has no
 * evidence", which is a claim nobody made.
 *
 * The shape is validated as a WHITELIST, mirroring the backend's own projection
 * guard from the consumer side. Anything unexpected — an extra key, a status
 * outside the canonical set, a count that is not a bounded integer, a favorable
 * count larger than the run count it came from — is corruption, not data.
 */

export const EVIDENCE_CHANNELS_CONTRACT_VERSION = 'marketplace-evidence-channels.v1';

export const EVIDENCE_CHANNEL_KEYS = ['builderTraining', 'neutralBenchmark', 'customerField', 'personalFit'] as const;
export const EVIDENCE_TYPE_KEYS = ['deterministicVerification', 'judgeReview', 'humanAcceptance', 'certification'] as const;

export type EvidenceChannelKey = (typeof EVIDENCE_CHANNEL_KEYS)[number];
export type EvidenceTypeKey = (typeof EVIDENCE_TYPE_KEYS)[number];

const CHANNEL_STATUSES = ['evidence_available', 'insufficient_evidence', 'unknown', 'unavailable'] as const;
export type EvidenceStatus = (typeof CHANNEL_STATUSES)[number];

export type EvidenceType = { status: EvidenceStatus; count: number };
export type EvidenceChannel =
  | { status: 'unavailable' }
  | { status: Exclude<EvidenceStatus, 'unavailable'>; exactVersionRunCount: number; latestEvidenceAt: string | null; evidence: Record<EvidenceTypeKey, EvidenceType> };

export type EvidenceChannels = Record<EvidenceChannelKey, EvidenceChannel>;

export type EvidenceChannelsResult =
  | { status: 'ready'; channels: EvidenceChannels }
  | { status: 'unavailable'; reason: string };

// A bounded UTC day, exactly as the backend publishes it. A full timestamp here
// would be a precision the contract never promised.
//
// The pattern alone is not enough. `2026-99-99T00:00:00.000Z` matches it and
// then throws RangeError when rendered, and `2026-02-30T00:00:00.000Z` does not
// throw at all — it silently NORMALIZES to March 2nd, so a shape-only check
// would publish a date the server never sent. Only a canonical round-trip
// distinguishes a real day from one that merely looks like one.
const BOUNDED_DAY = /^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/;
function isCanonicalUtcDay(value: unknown): value is string {
  if (typeof value !== 'string' || !BOUNDED_DAY.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}
// Nothing in this projection is allowed to carry identity. This is a backstop
// behind the whitelist, not a substitute for it.
const IDENTITY_LIKE = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})|([^\s@]+@[^\s@]+\.[^\s@]+)|(\/Users\/|\/home\/|[A-Za-z]:\\)|((sk_(live|test)_|ghp_|github_pat_|AKIA|whsec_)[A-Za-z0-9_-]{8,})/i;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function keysAre(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function boundedCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

const EVIDENCE_TYPE_ENTRY_KEYS = ['status', 'count'] as const;
const CHANNEL_ENTRY_KEYS = ['status', 'exactVersionRunCount', 'latestEvidenceAt', 'evidence'] as const;

function parseEvidenceType(value: unknown): EvidenceType | null {
  if (!isPlainObject(value) || !keysAre(value, EVIDENCE_TYPE_ENTRY_KEYS)) return null;
  const count = boundedCount(value.count);
  if (count === null) return null;
  if (!CHANNEL_STATUSES.includes(value.status as EvidenceStatus)) return null;
  // Only a WHOLE personalFit may be withheld. An individual evidence type that
  // claims to be unavailable has no rendering that is honest: the resume would
  // describe it as "none yet", conflating "we could not look" with a measured
  // zero — the exact confusion this contract exists to prevent.
  if (value.status === 'unavailable') return null;
  // A type cannot be simultaneously "no evidence" and carry evidence.
  if (value.status === 'evidence_available' && count === 0) return null;
  if (value.status !== 'evidence_available' && count !== 0) return null;
  return { status: value.status as EvidenceStatus, count };
}

function parseChannel(key: EvidenceChannelKey, value: unknown): EvidenceChannel | null {
  if (!isPlainObject(value)) return null;
  if (keysAre(value, ['status'])) {
    // Only the viewer-relative channel may be withheld, and only as
    // "unavailable" — a public channel that reported itself unavailable would
    // be the server declining to answer a question it always answers.
    return key === 'personalFit' && value.status === 'unavailable' ? { status: 'unavailable' } : null;
  }
  if (!keysAre(value, CHANNEL_ENTRY_KEYS)) return null;
  if (value.status === 'unavailable' || !CHANNEL_STATUSES.includes(value.status as EvidenceStatus)) return null;
  const exactVersionRunCount = boundedCount(value.exactVersionRunCount);
  if (exactVersionRunCount === null) return null;
  if (value.latestEvidenceAt !== null && !isCanonicalUtcDay(value.latestEvidenceAt)) return null;
  if (!isPlainObject(value.evidence) || !keysAre(value.evidence, EVIDENCE_TYPE_KEYS)) return null;
  const evidence = {} as Record<EvidenceTypeKey, EvidenceType>;
  let favorable = 0;
  for (const typeKey of EVIDENCE_TYPE_KEYS) {
    const parsed = parseEvidenceType(value.evidence[typeKey]);
    if (!parsed) return null;
    evidence[typeKey] = parsed;
    // Certification has no run-backed count in this contract; it is the one
    // type that is always `unknown`, so it never contributes to the run bound.
    if (typeKey !== 'certification') favorable = Math.max(favorable, parsed.count);
  }
  // More favorable runs than runs is arithmetically impossible. A card built
  // from it would publish a number nothing could have produced.
  //
  // POSITIVE counts only, on purpose. A zero count can exceed only a NEGATIVE
  // run count, which the bounded-count rule already refuses — so without this
  // restriction the two rules overlap and neither can be isolated. Together
  // they still guarantee exactly what the unrestricted form did.
  if (favorable > 0 && favorable > exactVersionRunCount) return null;
  // A channel claiming evidence with none inside it, or claiming none while
  // holding some, is a contradiction rather than a sparse result.
  const anyFavorable = EVIDENCE_TYPE_KEYS.some((typeKey) => evidence[typeKey].count > 0);
  if ((value.status === 'evidence_available') !== anyFavorable) return null;
  // ---- marketplace-evidence-channels.v1 SEMANTICS -------------------------
  // Shape consistency is not the same as being a state this contract version
  // can actually produce. V1 has no certification authority and no benchmark
  // authority, so a projection asserting either is describing a world that does
  // not exist. Refusing it here is why widening the contract later REQUIRES a
  // new contract version rather than quietly arriving inside this one.
  if (evidence.certification.status !== 'unknown' || evidence.certification.count !== 0) return null;
  if (key === 'neutralBenchmark') {
    if (value.status !== 'unknown' || exactVersionRunCount !== 0 || value.latestEvidenceAt !== null) return null;
    if (EVIDENCE_TYPE_KEYS.some((typeKey) => evidence[typeKey].status !== 'unknown' || evidence[typeKey].count !== 0)) return null;
  }
  // "Unknown" is a statement about the whole channel: it cannot hold a type
  // that was measured, and a measured channel cannot hold an unmeasured type
  // other than certification, which V1 never measures anywhere.
  const measurable = EVIDENCE_TYPE_KEYS.filter((typeKey) => typeKey !== 'certification');
  if (value.status === 'unknown') {
    if (measurable.some((typeKey) => evidence[typeKey].status !== 'unknown')) return null;
  } else if (measurable.some((typeKey) => evidence[typeKey].status === 'unknown')) return null;
  return {
    status: value.status as Exclude<EvidenceStatus, 'unavailable'>,
    exactVersionRunCount,
    latestEvidenceAt: value.latestEvidenceAt as string | null,
    evidence,
  };
}

/**
 * Parse the optional `evidenceChannels` projection off an agent resume.
 *
 * Returning `unavailable` never blanks the rest of the resume: the caller keeps
 * rendering identity, limitations, inputs, readiness and lifecycle, and shows
 * this one section as unknown.
 */
export function parseEvidenceChannels(value: unknown): EvidenceChannelsResult {
  if (value === undefined || value === null) {
    return { status: 'unavailable', reason: 'This agent version did not publish channel evidence.' };
  }
  if (!isPlainObject(value) || !keysAre(value, ['contractVersion', 'channels'])) {
    return { status: 'unavailable', reason: 'Channel evidence could not be read.' };
  }
  if (value.contractVersion !== EVIDENCE_CHANNELS_CONTRACT_VERSION) {
    return { status: 'unavailable', reason: 'Channel evidence uses an unsupported contract version.' };
  }
  if (!isPlainObject(value.channels) || !keysAre(value.channels, EVIDENCE_CHANNEL_KEYS)) {
    return { status: 'unavailable', reason: 'Channel evidence could not be read.' };
  }
  const channels = {} as EvidenceChannels;
  for (const key of EVIDENCE_CHANNEL_KEYS) {
    const parsed = parseChannel(key, value.channels[key]);
    // One bad channel invalidates the projection. Rendering the rest would be a
    // partial answer presented as a complete one.
    if (!parsed) return { status: 'unavailable', reason: 'Channel evidence could not be read.' };
    channels[key] = parsed;
  }
  // UNREACHABLE TODAY, AND KEPT ANYWAY. The whitelist above admits only
  // canonical statuses, bounded integers and a UTC-day string, so no free-form
  // value survives it to be tested here — which is why no mutant grades this
  // line. It is the guard that would still hold if a future field were added to
  // the contract before anyone thought about what it could carry.
  if (IDENTITY_LIKE.test(JSON.stringify(channels))) {
    return { status: 'unavailable', reason: 'Channel evidence could not be read.' };
  }
  return { status: 'ready', channels };
}
