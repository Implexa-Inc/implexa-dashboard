import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_MEDIA_DURATION_MS, SOURCE_STATE_COPY, classifyGenerationSource, durationSeconds,
  formatDurationMs, isAuthoritativeDurationMs, selectSource, withinSourceDuration,
} from './generation-source.ts';
import { validateTimeline, toRequestMoments, type TimelineMoment } from './professional-v2-timeline.ts';
import { parseCompiledProfessionalV2Proposal } from './generation-proposal-v2.ts';
import { V2_PREVIEW_AVAILABLE } from './professional-v2.fixtures.ts';

const ARTIFACT_A = 'b8a1d20c-4e73-4f19-9c8a-5d2e6f70b134';
const ARTIFACT_B = 'c9b2e31d-5f84-4a2b-9d1c-6e3f7a81c245';

const row = (over: Record<string, unknown> = {}) => ({
  id: ARTIFACT_A,
  status: 'validated',
  role: 'final_output',
  relative_path: 'output/final-reel.mp4',
  media_duration_ms: 30000,
  ...over,
});

// ── the duration is READ, never derived ─────────────────────────────────────

test('an artifact with a verified duration is eligible, and its length travels', () => {
  const state = classifyGenerationSource([row()]);
  assert.equal(state.state, 'eligible');
  if (state.state !== 'eligible') return;
  assert.equal(state.source.artifactId, ARTIFACT_A);
  assert.equal(state.source.mediaDurationMs, 30000);
});

test('NULL duration is NOT unlimited — it is "not yet verified", with a Desktop action', () => {
  for (const missing of [null, undefined]) {
    const state = classifyGenerationSource([row({ media_duration_ms: missing })]);
    assert.equal(state.state, 'needs_verification', String(missing));
  }
  // The copy names an ACTION, because there is nothing to do about this in the
  // browser and "unavailable" alone would be a dead end.
  assert.match(SOURCE_STATE_COPY.needs_verification.action ?? '', /Implexa Desktop/);
});

test('an out-of-range or wrongly-typed duration is treated as UNVERIFIED, never coerced', () => {
  // 0 and negative are not lengths; > 24 h is implausible; a string is a shape
  // we do not understand, and understanding it wrongly is how a fake ceiling
  // gets in. All of them mean "not verified", not "unbounded".
  for (const bad of [0, -1, 1.5, MAX_MEDIA_DURATION_MS + 1, Number.NaN]) {
    assert.equal(classifyGenerationSource([row({ media_duration_ms: bad })]).state, 'needs_verification', String(bad));
  }
  // A string is a MALFORMED ROW, which is a different thing again: we cannot
  // tell what this row says, so eligibility is unknown rather than unverified.
  assert.equal(classifyGenerationSource([row({ media_duration_ms: '30000' })]).state, 'unavailable');
  assert.equal(isAuthoritativeDurationMs('30000'), false);
});

test('a malformed or failed read is UNAVAILABLE — never evidence that there is no video', () => {
  assert.equal(classifyGenerationSource(null).state, 'unavailable');
  assert.equal(classifyGenerationSource([], new Error('down')).state, 'unavailable');
  assert.equal(classifyGenerationSource([{}]).state, 'unavailable');
  assert.equal(classifyGenerationSource([row({ id: 'not-a-uuid' })]).state, 'unavailable');
  assert.equal(classifyGenerationSource([row({ role: 42 })]).state, 'unavailable');
});

test('a run with no validated final video is INELIGIBLE, distinct from unavailable', () => {
  assert.equal(classifyGenerationSource([]).state, 'ineligible');
  assert.equal(classifyGenerationSource([row({ status: 'declared' })]).state, 'ineligible');
  assert.equal(classifyGenerationSource([row({ role: 'source' })]).state, 'ineligible');
  assert.equal(classifyGenerationSource([row({ relative_path: 'notes.md' })]).state, 'ineligible');
});

// ── ambiguity is never resolved for the user ────────────────────────────────

test('SEVERAL final videos is AMBIGUOUS — even when only one is verified', () => {
  const state = classifyGenerationSource([
    row(),
    row({ id: ARTIFACT_B, relative_path: 'output/alt.mp4', media_duration_ms: null }),
  ]);
  assert.equal(state.state, 'ambiguous');
  if (state.state !== 'ambiguous') return;
  assert.equal(state.sources.length, 2);
  // Quietly preferring the verified one would pick the user's source for them,
  // and the file they meant might be the unverified one.
  assert.equal(state.sources.find((s) => s.artifactId === ARTIFACT_B)?.mediaDurationMs, null);
});

test('choosing a source is explicit, and a foreign id chooses nothing', () => {
  const state = classifyGenerationSource([row(), row({ id: ARTIFACT_B, relative_path: 'output/alt.mp4', media_duration_ms: 90000 })]);
  if (state.state !== 'ambiguous') { assert.fail('expected ambiguous'); return; }
  assert.equal(selectSource(state.sources, ARTIFACT_B)?.mediaDurationMs, 90000);
  assert.equal(selectSource(state.sources, 'd0000000-0000-4000-8000-000000000000'), null);
  assert.equal(selectSource(state.sources, null), null);
});

// ── THE BOUNDARY ────────────────────────────────────────────────────────────

test('end === duration is valid; end === duration + 1 is not', () => {
  assert.equal(withinSourceDuration(27000, 30000, 30000), true, 'exact end');
  assert.equal(withinSourceDuration(27000, 30001, 30000), false, 'one millisecond over');
  assert.equal(withinSourceDuration(30000, 33000, 30000), false, 'start at the end');
  for (const unknown of [null, 0, -1, Number.NaN]) {
    assert.equal(withinSourceDuration(0, 3000, unknown as number | null), false, String(unknown));
  }
});

const moment = (over: Partial<TimelineMoment> = {}): TimelineMoment => ({
  id: 'hook', prompt: 'a slow aerial push over a bay bridge at sunrise',
  startSeconds: 27, endSeconds: 30, ratio: '720:1280',
  variantsRequested: 2, judgeMode: 'ranked', maxRepairs: 1, ...over,
});

test('the TIMELINE enforces the ceiling, and names the source length when it refuses', () => {
  const exact = validateTimeline([moment()], 30000);
  assert.equal(exact.ok, true, JSON.stringify(exact.issues));

  const over = validateTimeline([moment({ endSeconds: 30.001 })], 30000);
  assert.equal(over.ok, false);
  const issue = over.issues.find((i) => i.code === 'moment_outside_source_duration');
  assert.ok(issue, 'the refusal must be typed');
  // The message states the bound, so the user can fix it without guessing.
  assert.match(issue!.message, /0:30\.000/);
});

test('an UNKNOWN duration refuses every moment — the browser has no fallback either', () => {
  const unknown = validateTimeline([moment()], null);
  assert.equal(unknown.ok, false);
  assert.ok(unknown.issues.some((i) => i.code === 'source_duration_unknown'));
  assert.match(unknown.issues.find((i) => i.code === 'source_duration_unknown')!.message, /Implexa Desktop/);
});

test('a timeline call with NO source argument still validates shape only — the two are distinct', () => {
  // `undefined` means "this call is not about a source" (the fixture
  // regenerator, the cost reconciler). `null` means "there is a source and we do
  // not know how long it is". Conflating them would break the first or admit
  // the second.
  assert.equal(validateTimeline([moment()]).ok, true);
  assert.equal(validateTimeline([moment()], null).ok, false);
});

test('SERIALIZING IS SENDING: an out-of-range timeline never becomes a request body', () => {
  assert.ok(toRequestMoments([moment()], 30000));
  assert.equal(toRequestMoments([moment({ endSeconds: 30.001 })], 30000), null);
  assert.equal(toRequestMoments([moment()], null), null);
});

// ── the compiled document carries the bound source ──────────────────────────

test('a REAL compiled v2 proposal exposes the source it was compiled against', () => {
  const compiled = parseCompiledProfessionalV2Proposal(
    (V2_PREVIEW_AVAILABLE as { proposal: unknown }).proposal,
  );
  assert.ok(compiled, 'the real fixture must parse');
  assert.match(compiled!.sourceBinding.sourceArtifactId, /^[0-9a-f-]{36}$/);
  assert.equal(Number.isSafeInteger(compiled!.sourceBinding.mediaDurationMs), true);
  // The binding's windows are exactly the graph's moments.
  assert.equal(compiled!.sourceBinding.windows.length, compiled!.moments.length);
  for (const moment_ of compiled!.moments) {
    const window = compiled!.sourceBinding.windows.find((w) => w.momentId === moment_.momentId);
    assert.ok(window);
    assert.equal(window!.startMs, moment_.startMs);
    assert.equal(window!.endMs, moment_.endMs);
  }
});

test('a v2 document with a MISSING or INCOHERENT binding does not parse at all', () => {
  const base = structuredClone(V2_PREVIEW_AVAILABLE as unknown as { proposal: Record<string, unknown> }).proposal;
  const graph = base.professional_control as Record<string, unknown>;
  const binding = graph.source_binding as Record<string, unknown>;

  // Missing: the pre-0158 shape. Those were priced with no ceiling and the
  // backend will refuse to approve them, so rendering one as an approvable plan
  // would offer a button that cannot work.
  const stripped = structuredClone(base);
  delete (stripped.professional_control as Record<string, unknown>).source_binding;
  assert.equal(parseCompiledProfessionalV2Proposal(stripped), null);

  // A window past the binding's OWN duration: a document that contradicts
  // itself must never be rendered as a plan.
  const overflowed = structuredClone(base);
  const overflowedBinding = (overflowed.professional_control as Record<string, unknown>).source_binding as {
    media_duration_ms: number; windows: Array<{ end_ms: number }>;
  };
  overflowedBinding.windows[0].end_ms = overflowedBinding.media_duration_ms + 1;
  assert.equal(parseCompiledProfessionalV2Proposal(overflowed), null);

  // A binding that OMITS a moment could omit exactly the one that breaks the
  // ceiling, and every remaining window would pass.
  const short = structuredClone(base);
  const shortBinding = (short.professional_control as Record<string, unknown>).source_binding as { windows: unknown[] };
  shortBinding.windows = [];
  assert.equal(parseCompiledProfessionalV2Proposal(short), null);

  assert.ok(binding, 'the fixture carries a binding to begin with');
});

// ── presentation ────────────────────────────────────────────────────────────

test('the source length is shown to the MILLISECOND, because the boundary is', () => {
  // A user whose moment ends at 64.5 s on a 64.5 s source has to see that those
  // are the same number. `1:04` would make an exact fit look like an overrun.
  assert.equal(formatDurationMs(64500), '1:04.500');
  assert.equal(formatDurationMs(30000), '0:30.000');
  assert.equal(formatDurationMs(3661001), '61:01.001');
  assert.equal(formatDurationMs(0), '—');
  assert.equal(formatDurationMs(Number.NaN), '—');
});

test('durationSeconds gives an input max, and 0 for anything unverified', () => {
  assert.equal(durationSeconds(30000), 30);
  assert.equal(durationSeconds(30500), 30.5);
  assert.equal(durationSeconds(0), 0);
});
