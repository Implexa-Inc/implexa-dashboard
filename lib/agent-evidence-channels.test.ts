import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEvidenceChannels, EVIDENCE_CHANNEL_KEYS, EVIDENCE_TYPE_KEYS } from './agent-evidence-channels.ts';
import generated from '../test-fixtures/generated/marketplace-evidence-channels.json' with { type: 'json' };

const canonical = generated.canonicalProduction.anonymousViewer;
const buyer = generated.afterIndependentUserTest.buyerViewer;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function ready(value: unknown) {
  const parsed = parseEvidenceChannels(value);
  assert.equal(parsed.status, 'ready', `expected a readable projection, got: ${parsed.status === 'unavailable' ? parsed.reason : ''}`);
  return parsed.status === 'ready' ? parsed.channels : ({} as never);
}
function refused(value: unknown, why: string) {
  const parsed = parseEvidenceChannels(value);
  assert.equal(parsed.status, 'unavailable', why);
  assert.ok(parsed.status === 'unavailable' && parsed.reason.length > 0);
}

test('the backend generated projection parses, for every published viewer', () => {
  for (const [group, viewers] of Object.entries({
    canonicalProduction: generated.canonicalProduction,
    afterIndependentUserTest: generated.afterIndependentUserTest,
    withPrivateBuyerAcceptance: generated.withPrivateBuyerAcceptance,
  })) {
    for (const [viewer, projection] of Object.entries(viewers)) {
      const channels = ready(projection);
      assert.deepEqual(Object.keys(channels).sort(), [...EVIDENCE_CHANNEL_KEYS].sort(), `${group}.${viewer}`);
    }
  }
});

test('a real zero is preserved as a measured zero, not as unavailable', () => {
  const channels = ready(canonical);
  assert.equal(channels.builderTraining.status, 'evidence_available');
  const customerField = channels.customerField;
  assert.equal(customerField.status, 'insufficient_evidence');
  assert.ok('exactVersionRunCount' in customerField && customerField.exactVersionRunCount === 0);
  // "We looked and found none" is a different claim from "we could not look".
  assert.notEqual(customerField.status, 'unavailable');
});

test('every evidence type inside a channel stays separate and is never blended', () => {
  const channels = ready(canonical);
  const builderTraining = channels.builderTraining;
  assert.ok('evidence' in builderTraining);
  assert.deepEqual(Object.keys(builderTraining.evidence).sort(), [...EVIDENCE_TYPE_KEYS].sort());
  assert.deepEqual(builderTraining.evidence.deterministicVerification, { status: 'evidence_available', count: 1 });
  assert.deepEqual(builderTraining.evidence.judgeReview, { status: 'insufficient_evidence', count: 0 });
  assert.deepEqual(builderTraining.evidence.certification, { status: 'unknown', count: 0 });
});

test('neutral benchmark stays unknown, and unknown is not insufficient', () => {
  const channels = ready(canonical);
  const neutralBenchmark = channels.neutralBenchmark;
  assert.equal(neutralBenchmark.status, 'unknown');
  assert.ok('evidence' in neutralBenchmark);
  for (const type of ['deterministicVerification', 'judgeReview', 'humanAcceptance', 'certification'] as const) {
    assert.equal(neutralBenchmark.evidence[type].status, 'unknown', `${type} must not be reported as measured-and-empty`);
  }
});

test('personal fit is withheld for an anonymous viewer and empty for a foreign one', () => {
  assert.deepEqual(ready(canonical).personalFit, { status: 'unavailable' });
  const foreign = ready(generated.canonicalProduction.foreignViewer).personalFit;
  assert.equal(foreign.status, 'insufficient_evidence');
  assert.ok('exactVersionRunCount' in foreign && foreign.exactVersionRunCount === 0);
  const own = ready(buyer).personalFit;
  assert.equal(own.status, 'evidence_available');
});

test("a buyer's private acceptance appears only in their own personal fit", () => {
  const channels = ready(generated.withPrivateBuyerAcceptance.buyerViewer);
  assert.ok('evidence' in channels.personalFit && channels.personalFit.evidence.humanAcceptance.count === 1);
  assert.ok('evidence' in channels.customerField && channels.customerField.evidence.humanAcceptance.count === 0);
  const foreign = ready(generated.withPrivateBuyerAcceptance.foreignViewer);
  assert.ok('evidence' in foreign.personalFit && foreign.personalFit.evidence.humanAcceptance.count === 0);
  assert.ok('evidence' in foreign.customerField && foreign.customerField.evidence.humanAcceptance.count === 0);
});

test('an absent projection is unavailable, and never four confident empty cards', () => {
  for (const absent of [undefined, null]) refused(absent, 'nothing to read is not a measured zero');
  assert.equal(parseEvidenceChannels(undefined).status, 'unavailable');
});

test('a malformed projection is refused rather than partially rendered', () => {
  refused({ contractVersion: 'marketplace-evidence-channels.v1' }, 'missing channels');
  refused({ channels: clone(canonical.channels) }, 'missing contract version');
  refused({ ...clone(canonical), extra: 1 }, 'an unexpected top-level key is corruption');
  refused({ ...clone(canonical), contractVersion: 'marketplace-evidence-channels.v2' }, 'an unsupported version is not readable');
  refused({ ...clone(canonical), contractVersion: 'marketplace-evidence-channel.v1' }, 'the binding contract version is not the projection contract version');
  refused('not an object', 'a scalar is not a projection');
  refused([clone(canonical)], 'an array is not a projection');
  const missingChannel = clone(canonical);
  delete (missingChannel.channels as Record<string, unknown>).personalFit;
  refused(missingChannel, 'a missing channel invalidates the whole projection');
  const extraChannel = clone(canonical);
  (extraChannel.channels as Record<string, unknown>).communityVibes = clone(canonical.channels.builderTraining);
  refused(extraChannel, 'an invented fifth channel is refused, not ignored');
});

test('a channel or evidence entry carrying an extra key is refused', () => {
  // Extra keys are the one shape the field-by-field checks below cannot catch:
  // every named field still validates, so only the whitelist refuses them.
  const extraChannelKey = clone(canonical);
  (extraChannelKey.channels.builderTraining as Record<string, unknown>).trustScore = 0.98;
  refused(extraChannelKey, 'a channel may carry only the four contract fields');
  const extraTypeKey = clone(canonical);
  (extraChannelKey.channels.builderTraining as Record<string, unknown>).trustScore = undefined;
  ((extraTypeKey.channels.builderTraining as { evidence: Record<string, Record<string, unknown>> })
    .evidence.deterministicVerification).weight = 3;
  refused(extraTypeKey, 'an evidence entry is exactly a status and a count');
});

test('one bad channel invalidates the projection instead of yielding a partial answer', () => {
  const broken = clone(canonical);
  (broken.channels.customerField as Record<string, unknown>).evidence = { deterministicVerification: { status: 'evidence_available', count: 1 } };
  refused(broken, 'a partial answer presented as a complete one is the failure mode');
});

test('fabricated and impossible counts are refused', () => {
  const impossible = clone(canonical);
  // More favorable runs than runs is arithmetically impossible.
  (impossible.channels.builderTraining as { evidence: Record<string, { count: number }> }).evidence.deterministicVerification.count = 9;
  refused(impossible, 'a count larger than its run count could not have been produced');
  for (const bad of [-1, 1.5, Number.NaN, '1', null]) {
    const mangled = clone(canonical);
    (mangled.channels.builderTraining as { evidence: Record<string, { count: unknown }> }).evidence.deterministicVerification.count = bad;
    refused(mangled, `${String(bad)} is not a bounded count`);
    const mangledRuns = clone(canonical);
    (mangledRuns.channels.builderTraining as { exactVersionRunCount: unknown }).exactVersionRunCount = bad;
    refused(mangledRuns, `${String(bad)} is not a bounded run count`);
  }
});

test('a status that contradicts its own counts is refused', () => {
  const hollow = clone(canonical);
  (hollow.channels.builderTraining as { evidence: Record<string, { count: number }> }).evidence.deterministicVerification.count = 0;
  refused(hollow, 'evidence_available with nothing inside it is a contradiction');
  const hidden = clone(canonical);
  (hidden.channels.customerField as { status: string }).status = 'evidence_available';
  refused(hidden, 'a channel cannot claim evidence it does not carry');
  const mislabelled = clone(canonical);
  (mislabelled.channels.builderTraining as { evidence: Record<string, { status: string }> }).evidence.judgeReview.status = 'evidence_available';
  refused(mislabelled, 'a type cannot claim evidence while counting zero');
  const invented = clone(canonical);
  (invented.channels.builderTraining as { status: string }).status = 'excellent';
  refused(invented, 'a status outside the canonical set is refused');
});

test('only personal fit may be withheld, and only as unavailable', () => {
  for (const key of ['builderTraining', 'neutralBenchmark', 'customerField'] as const) {
    const withheld = clone(canonical);
    (withheld.channels as Record<string, unknown>)[key] = { status: 'unavailable' };
    refused(withheld, `${key} is a public channel and is always answerable`);
  }
  const withheldFit = clone(canonical);
  (withheldFit.channels as Record<string, unknown>).personalFit = { status: 'unavailable' };
  assert.equal(parseEvidenceChannels(withheldFit).status, 'ready');
  const wrongWithheld = clone(canonical);
  (wrongWithheld.channels as Record<string, unknown>).personalFit = { status: 'unknown' };
  refused(wrongWithheld, 'a one-key channel may only be the withheld form');
});

test('an unbounded timestamp is refused, because the contract promises a UTC day', () => {
  for (const stamp of ['2026-08-11T13:47:52.123Z', '2026-08-11', 1754870400000, 'yesterday']) {
    const precise = clone(canonical);
    (precise.channels.builderTraining as { latestEvidenceAt: unknown }).latestEvidenceAt = stamp;
    refused(precise, `${String(stamp)} is not a bounded UTC day`);
  }
  const absent = clone(canonical);
  (absent.channels.builderTraining as { latestEvidenceAt: unknown }).latestEvidenceAt = null;
  assert.equal(parseEvidenceChannels(absent).status, 'ready', 'null is the honest absence of a timestamp');
});

test('V1 has no certification authority, so any certification claim is refused', () => {
  for (const claim of [{ status: 'evidence_available', count: 1 }, { status: 'insufficient_evidence', count: 0 }]) {
    const claimed = clone(canonical);
    (claimed.channels.builderTraining as { evidence: Record<string, unknown> }).evidence.certification = claim;
    refused(claimed, `certification ${claim.status} describes an authority V1 does not have`);
  }
  // The only state V1 can produce.
  assert.equal(parseEvidenceChannels(clone(canonical)).status, 'ready');
});

test('V1 has no benchmark authority, so a measured neutral benchmark is refused', () => {
  const measured = clone(canonical);
  const benchmark = measured.channels.neutralBenchmark as {
    status: string; exactVersionRunCount: number; latestEvidenceAt: string | null; evidence: Record<string, { status: string; count: number }>;
  };
  benchmark.status = 'evidence_available';
  benchmark.exactVersionRunCount = 3;
  benchmark.evidence.deterministicVerification = { status: 'evidence_available', count: 3 };
  refused(measured, 'a benchmark result cannot exist while no benchmark authority does');

  const counted = clone(canonical);
  (counted.channels.neutralBenchmark as { exactVersionRunCount: number }).exactVersionRunCount = 2;
  refused(counted, 'an unmeasured channel cannot have run against anything');

  const stamped = clone(canonical);
  (stamped.channels.neutralBenchmark as { latestEvidenceAt: string | null }).latestEvidenceAt = '2026-08-11T00:00:00.000Z';
  refused(stamped, 'an unmeasured channel has no latest evidence to date');

  const measuredEmpty = clone(canonical);
  (measuredEmpty.channels.neutralBenchmark as { status: string; evidence: Record<string, { status: string; count: number }> }).status = 'insufficient_evidence';
  (measuredEmpty.channels.neutralBenchmark as { evidence: Record<string, { status: string; count: number }> }).evidence.deterministicVerification = { status: 'insufficient_evidence', count: 0 };
  (measuredEmpty.channels.neutralBenchmark as { evidence: Record<string, { status: string; count: number }> }).evidence.judgeReview = { status: 'insufficient_evidence', count: 0 };
  (measuredEmpty.channels.neutralBenchmark as { evidence: Record<string, { status: string; count: number }> }).evidence.humanAcceptance = { status: 'insufficient_evidence', count: 0 };
  refused(measuredEmpty, 'measured-and-empty is a different claim from never measured');
});

test('an individual evidence type may never be withheld', () => {
  // Only a WHOLE personalFit is withheld. A withheld TYPE has no honest
  // rendering: the resume would call it "none yet", which is a measured zero.
  for (const channelKey of ['builderTraining', 'customerField', 'personalFit'] as const) {
    const withheld = clone(buyer);
    const channel = withheld.channels[channelKey] as { evidence?: Record<string, unknown> };
    if (!channel.evidence) continue;
    channel.evidence.deterministicVerification = { status: 'unavailable', count: 0 };
    refused(withheld, `${channelKey} cannot withhold one evidence type`);
  }
});

test('unknown is a statement about a whole channel, never a mix', () => {
  const mixed = clone(canonical);
  const benchmark = mixed.channels.neutralBenchmark as { evidence: Record<string, { status: string; count: number }> };
  benchmark.evidence.judgeReview = { status: 'insufficient_evidence', count: 0 };
  refused(mixed, 'an unknown channel cannot contain a measured type');

  const unmeasuredInside = clone(canonical);
  (unmeasuredInside.channels.builderTraining as { evidence: Record<string, { status: string; count: number }> })
    .evidence.judgeReview = { status: 'unknown', count: 0 };
  refused(unmeasuredInside, 'a measured channel cannot contain an unmeasured type');
});

test('a date that only looks like a day is refused, including one that silently normalizes', () => {
  for (const stamp of [
    '2026-99-99T00:00:00.000Z', // matches the shape, throws RangeError when rendered
    '2026-13-01T00:00:00.000Z',
    '2026-00-10T00:00:00.000Z',
    '2026-08-00T00:00:00.000Z',
    '2026-08-32T00:00:00.000Z',
    '2026-02-30T00:00:00.000Z', // normalizes to March 2nd rather than throwing
    '2025-02-29T00:00:00.000Z', // not a leap year: normalizes to March 1st
  ]) {
    const invalid = clone(canonical);
    (invalid.channels.builderTraining as { latestEvidenceAt: string }).latestEvidenceAt = stamp;
    refused(invalid, `${stamp} is not a real UTC day`);
  }
  // A genuine leap day is a real day and must still parse.
  const leapDay = clone(canonical);
  (leapDay.channels.builderTraining as { latestEvidenceAt: string }).latestEvidenceAt = '2024-02-29T00:00:00.000Z';
  assert.equal(parseEvidenceChannels(leapDay).status, 'ready', 'a real leap day is a real day');
});

test('a projection carrying identity, a path, an email or a secret is refused', () => {
  for (const leak of ['11111111-1111-4111-8111-111111111111', 'builder@example.com', '/Users/alice/private.txt', 'sk_live_1234567890abcdef']) {
    const leaky = clone(canonical);
    (leaky.channels.builderTraining as { latestEvidenceAt: unknown }).latestEvidenceAt = leak;
    refused(leaky, `${leak} must never reach the resume`);
  }
});

test('the parser derives no score, ratio, or rank of any kind', () => {
  const channels = ready(buyer);
  const serialized = JSON.stringify(channels);
  for (const forbidden of ['score', 'rating', 'stars', 'percent', 'rank', 'reliability', 'confidence']) {
    assert.equal(serialized.toLowerCase().includes(forbidden), false, `${forbidden} must never be synthesized`);
  }
  const keys = new Set(Object.values(channels).flatMap((channel) => Object.keys(channel)));
  assert.deepEqual([...keys].sort(), ['evidence', 'exactVersionRunCount', 'latestEvidenceAt', 'status']);
});
