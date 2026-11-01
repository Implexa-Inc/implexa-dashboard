// node --test lib/review-recorder.test.ts
//
// The Dashboard half of the Review Room recorder (contract '1'). Every Desktop answer
// is shape-checked exactly: a malformed success must fail closed, never half-render.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CARD_FIELD_MAX, CLIENT_REASONS, COORD_MAX, DESKTOP_REASONS, FAILURE_REASONS, FAILURE_REASON_MESSAGES,
  LEARNING_REFUSAL_PREFIX, MAX_MOMENTS, MAX_MOMENT_MS, MAX_SUGGESTIONS, POINT_REGION_SIZE,
  REASON_MESSAGES, REVIEW_RECORDER_CONTRACT_VERSION, RecorderError, SILENT_REASONS,
  addMoment, cardWarnings, clampMomentRange, createReviewRecorderClient, defaultRegionFromPointer, emptyCard,
  failureMessage, formatBytes, formatRecordingDuration, isMomentList, isPointerTrack, isRecordingDetail,
  isRecordingSummary, isRecorderChange, momentsDirty, parse, pointerTrailAt, rangeFromDrag, reasonMessage, recorderAvailability,
  recorderErrorMessage, recoverAction, regionFromSpatial, regionOverlayStyle, suggestMoments,
  type Moment, type PointerSample,
} from './review-recorder.ts';
import { normalizedRectFromDrag } from './review-spatial-geometry.ts';

const ID = '9f1c2b3a-4d5e-4f60-8a7b-1c2d3e4f5a6b';
const M1 = '11111111-1111-4111-8111-111111111111';
const M2 = '22222222-2222-4222-8222-222222222222';
const NOW = '2026-10-25T12:00:00.000Z';
const TOKEN = 'abcdefghijklmnop0123456789_-';

const summary = (over: Record<string, unknown> = {}) => ({
  recordingId: ID, title: 'Checkout flow', origin: 'recorded', state: 'ready', failureReason: null,
  createdAt: NOW, durationMs: 120_000, sizeBytes: 50_000_000, width: 1920, height: 1080,
  hasMicrophone: true, hasPointerTrack: true, momentCount: 1, ...over,
});
const moment = (over: Record<string, unknown> = {}): Moment => ({
  momentId: M1, startMs: 1_000, endMs: 5_000, region: { x: 100_000, y: 100_000, width: 200_000, height: 100_000 },
  card: emptyCard(), createdAt: NOW, ...over,
} as Moment);
const track = (samples: unknown[] = [[0, 500_000, 500_000], [1_000, 510_000, 505_000], [2_000], [3_000, 0, 1_000_000]]) => ({
  contractVersion: 'pointer-track.v1', videoWidth: 1920, videoHeight: 1080, samples,
});
const detail = (over: Record<string, unknown> = {}) => ({ ...summary(), pointerTrack: track(), moments: [moment()], ...over });
const without = (o: Record<string, unknown>, key: string) => { const c = { ...o }; delete c[key]; return c; };

// ── response shapes ─────────────────────────────────────────────────────────

test('a well-formed summary and detail are accepted', () => {
  assert.equal(isRecordingSummary(summary()), true);
  assert.equal(isRecordingSummary(summary({ state: 'interrupted', durationMs: null, sizeBytes: null, width: null, height: null, momentCount: 0 })), true);
  assert.equal(isRecordingDetail(detail()), true);
  assert.equal(isRecordingDetail(detail({ pointerTrack: null, hasPointerTrack: false })), true);
});

test('failure reasons: only the Desktop codes are accepted, and each has plain English', () => {
  for (const code of FAILURE_REASONS) {
    assert.equal(isRecordingSummary(summary({ state: 'failed', failureReason: code })), true, code);
    assert.equal(failureMessage(code), FAILURE_REASON_MESSAGES[code]);
    assert.doesNotMatch(FAILURE_REASON_MESSAGES[code], /_/, `${code} leaks its code`);
  }
  assert.deepEqual([...FAILURE_REASONS].sort(), ['empty_capture', 'finalize_failed', 'media_tools_unavailable', 'source_changed', 'too_large', 'too_long']);
  assert.equal(failureMessage(null), 'This recording could not be saved.');
  assert.equal(failureMessage('something_new'), 'This recording could not be saved.', 'an unknown code is never shown raw');
});

test('summary: wrong types, missing and extra keys are refused', () => {
  for (const bad of [
    summary({ durationMs: '120000' }), summary({ durationMs: 1.5 }), summary({ durationMs: -1 }),
    summary({ origin: 'downloaded' }), summary({ state: 'paused' }), summary({ hasMicrophone: 'yes' }),
    summary({ createdAt: 'yesterday' }), summary({ momentCount: MAX_MOMENTS + 1 }), summary({ width: 0 }),
    summary({ recordingId: '../../etc/passwd' }), summary({ recordingId: '/Users/me/rec.mp4' }),
    summary({ recordingId: 'rec_0001' }), summary({ recordingId: ID.toUpperCase() }),
    summary({ state: 'failed', failureReason: 'disk_on_fire' }),
    summary({ state: 'ready', durationMs: null }),
    without(summary(), 'title'), { ...summary(), path: '/Users/me/rec.mp4' },
  ]) assert.equal(isRecordingSummary(bad), false, JSON.stringify(bad));
});

test('detail: the summary must agree with what it carries', () => {
  assert.equal(isRecordingDetail(detail({ momentCount: 2 })), false, 'momentCount must equal moments.length');
  assert.equal(isRecordingDetail(detail({ hasPointerTrack: false })), false, 'a track present while claiming none');
  assert.equal(isRecordingDetail(detail({ pointerTrack: null })), false, 'claims a track, carries none');
  assert.equal(isRecordingDetail(without(detail(), 'moments')), false);
  assert.equal(isRecordingDetail({ ...detail(), transcript: [] }), false, 'an unknown key is not silently dropped');
  assert.equal(isRecordingDetail(detail({ state: 'interrupted', durationMs: null })), false, 'moments with no known duration');
});

test('pointer track: samples out of range, out of order or misshapen are refused', () => {
  assert.equal(isPointerTrack(track()), true);
  assert.equal(isPointerTrack(track([])), true);
  for (const samples of [
    [[0, COORD_MAX + 1, 0]], [[0, -1, 0]], [[0, 10.5, 10]], [[0, 1, 2, 3]], [[0, 1]], [[]], [[-5]],
    [[1_000, 1, 1], [999, 1, 1]], [['0', 1, 1]], [{ t: 0, x: 1, y: 1 }],
  ]) assert.equal(isPointerTrack(track(samples)), false, JSON.stringify(samples));
  assert.equal(isPointerTrack({ ...track(), contractVersion: 'pointer-track.v2' }), false);
  assert.equal(isPointerTrack({ ...track(), videoWidth: 0 }), false);
});

test('moments: range, region and card bounds are enforced against the duration', () => {
  const d = 120_000;
  assert.equal(isMomentList([moment()], d), true);
  for (const bad of [
    moment({ startMs: 6_000 }), moment({ endMs: d + 1 }), moment({ startMs: 0, endMs: MAX_MOMENT_MS + 1 }),
    moment({ startMs: 1.5 }), moment({ momentId: 'not-a-uuid' }), moment({ momentId: '11111111-1111-1111-8111-111111111111' }),
    moment({ region: { x: 900_000, y: 0, width: 200_000, height: 10 } }), moment({ region: { x: 0, y: 0, width: 0, height: 10 } }),
    moment({ region: { x: 0, y: 0, width: 10, height: 10, z: 1 } }),
    moment({ card: { ...emptyCard(), why: 'x'.repeat(CARD_FIELD_MAX + 1) } }), moment({ card: without(emptyCard(), 'whenNot') }),
    { ...moment(), note: '' },
  ]) assert.equal(isMomentList([bad], d), false, JSON.stringify(bad));
  assert.equal(isMomentList([moment(), moment()], d), false, 'duplicate momentId');
  assert.equal(isMomentList([moment({ startMs: 0, endMs: MAX_MOMENT_MS })], d), true, 'exactly 30 s is allowed');
});

test('moment list limit: 64 is accepted, 65 is refused, and addMoment stops at 64', () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) =>
    moment({ momentId: `${String(i).padStart(8, '0')}-1111-4111-8111-111111111111`, startMs: i * 100, endMs: i * 100 + 50 }));
  assert.equal(isMomentList(many(64), 120_000), true);
  assert.equal(isMomentList(many(65), 120_000), false);
  assert.equal(addMoment(many(64), { startMs: 0, endMs: 10, region: null }, 120_000, { momentId: M2, createdAt: NOW }), null);
  const added = addMoment(many(63), { startMs: 0, endMs: 10, region: null }, 120_000, { momentId: M2, createdAt: NOW });
  assert.equal(added?.length, 64);
  assert.equal(addMoment([moment()], { startMs: 0, endMs: 10, region: null }, 120_000, { momentId: M1, createdAt: NOW }), null, 'duplicate id');
  assert.equal(addMoment([], { startMs: 0, endMs: 40_000, region: null }, 120_000, { momentId: M2, createdAt: NOW }), null, 'over 30 s');
  assert.equal(addMoment([], { startMs: 5_000, endMs: 5_000, region: null }, 120_000, { momentId: M2, createdAt: NOW }), null, 'a new mark needs a span');
  assert.equal(isMomentList([moment({ startMs: 5_000, endMs: 5_000 })], 120_000), true, 'a stored zero-length moment is still contract-valid');
});

test('per-operation parsers accept the contract and fail closed on anything else', () => {
  assert.deepEqual(parse.start({ ok: true, recordingId: ID }), { recordingId: ID });
  assert.deepEqual(parse.status({ ok: true, active: null }), { active: null });
  assert.deepEqual(parse.status({ ok: true, active: { recordingId: ID, state: 'paused' } }), { active: { recordingId: ID, state: 'paused' } });
  assert.equal(parse.list({ ok: true, recordings: [summary()], library: { usedBytes: 1, limitBytes: 10_000_000_000 } }).recordings.length, 1);
  assert.equal(parse.get({ ok: true, recording: detail() }, ID).recordingId, ID);
  assert.deepEqual(parse.preview({ ok: true, url: `implexa-artifact://preview/${TOKEN}`, mime: 'video/mp4', token: TOKEN }),
    { url: `implexa-artifact://preview/${TOKEN}`, mime: 'video/mp4', token: TOKEN });
  assert.equal(parse.saveMoments({ ok: true, moments: [moment()] }, 120_000).length, 1);
  assert.doesNotThrow(() => parse.done({ ok: true }));

  const invalid = (fn: () => unknown) => assert.throws(fn, (e: unknown) => e instanceof RecorderError && e.reason === 'response_invalid');
  invalid(() => parse.start({ ok: true }));
  invalid(() => parse.start({ ok: true, recordingId: ID, path: '/tmp/x.mp4' }));
  invalid(() => parse.start({ ok: 'true', recordingId: ID }));
  invalid(() => parse.start(null));
  invalid(() => parse.status({ ok: true, active: { ownerId:ID,recordingId: ID, state: 'ready' } }));
  invalid(() => parse.list({ ok: true, recordings: [summary()], library: { usedBytes: -1, limitBytes: 2 } }));
  invalid(() => parse.list({ ok: true, recordings: [summary()] }));
  invalid(() => parse.list({ ok: true, recordings: {}, library: { usedBytes: 1, limitBytes: 2 } }));
  invalid(() => parse.get({ ok: true, recording: detail({ recordingId: 'someone_else' }) }, ID));
  invalid(() => parse.preview({ ok: true, url: 'implexa-artifact:///Users/me/rec.mp4', mime: 'video/mp4', token: TOKEN }));
  invalid(() => parse.preview({ ok: true, url: `implexa-artifact://preview/${TOKEN}`, mime: 'video/mp4', token: 'different-token-0000' }));
  invalid(() => parse.preview({ ok: true, url: `implexa-artifact://preview/${TOKEN}`, mime: 'video/webm', token: TOKEN }));
  invalid(() => parse.saveMoments({ ok: true, moments: [moment({ endMs: 200_000 })] }, 120_000));
  invalid(() => parse.done({ ok: true, deleted: true }));
  invalid(() => parse.done({ ok: false, reason: 'made_up_reason' }));
  invalid(() => parse.done({ ok: false, reason: 'forbidden', detail: 'x' }));
  invalid(() => parse.done({ ok: false }));

  assert.throws(() => parse.done({ ok: false, reason: 'library_full' }), (e: unknown) => e instanceof RecorderError && e.reason === 'library_full');
});

test('first-use permission setup is an active recorder state, not a ready source picker', () => {
  assert.deepEqual(parse.status({ok:true,active:{recordingId:ID,state:'permission_required'}}),
    {active:{recordingId:ID,state:'permission_required'}});
  assert.equal(isRecorderChange({ownerId:ID,recordingId:ID,state:'permission_required'}),true);
});

test('list: malformed and repeated rows are dropped and counted, not fatal', () => {
  const other = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
  const out = parse.list({ ok: true, library: { usedBytes: 1, limitBytes: 2 }, recordings: [
    summary(), summary(), { ...summary({ recordingId: other }), path: '/Users/me/x.mp4' }, summary({ recordingId: other, state: 'nope' }), 'junk',
    summary({ recordingId: other }),
  ] });
  assert.deepEqual(out.recordings.map((r) => r.recordingId), [ID, other]);
  assert.equal(out.unreadable, 4);
});

// ── the real Desktop's shapes ───────────────────────────────────────────────
//
// test-fixtures/review-recorder/desktop-contract-v1.json is generated by running the
// Desktop's own dispatcher (handleDashboardOperation over a real recording store and
// pointer track) — see its _provenance. If the Desktop's shapes drift from these
// parsers, this is the test that says so.

const desktop = JSON.parse(readFileSync(new URL('../test-fixtures/review-recorder/desktop-contract-v1.json', import.meta.url), 'utf8'));

test('the parsers accept what the real Desktop sends', () => {
  const listed = parse.list(desktop.list);
  assert.equal(listed.unreadable, 0, 'every real row parses');
  assert.deepEqual(listed.recordings.map((r) => r.state).sort(), ['failed', 'interrupted', 'ready']);
  assert.ok(listed.recordings.every((r) => r.state !== 'failed' || FAILURE_REASONS.includes(r.failureReason as never)));
  assert.equal(formatBytes(listed.library.limitBytes), '10 GB', 'the real limit reads as the copy says');

  const id = desktop.get.recording.recordingId;
  const detail = parse.get(desktop.get, id);
  assert.ok(detail.pointerTrack && detail.pointerTrack.samples.length > 0);
  assert.ok(detail.pointerTrack.samples.some((s) => s.length === 1), 'the real track carries a gap sample');
  assert.equal(detail.moments.length, detail.momentCount);
  assert.equal(parse.get(desktop.getInterrupted, desktop.getInterrupted.recording.recordingId).state, 'interrupted');
  assert.deepEqual(parse.saveMoments(desktop.saveMoments, detail.durationMs!), detail.moments);

  const reason = (v: unknown) => { try { parse.done(v); return 'accepted'; } catch (e) { return (e as RecorderError).reason; } };
  assert.equal(reason(desktop.refusals.notFound), 'recording_not_found');
  assert.equal(reason(desktop.refusals.deleteCancelled), 'delete_cancelled');
  assert.equal(reason(desktop.refusals.unknownOperation), 'recorder_operation_invalid');
  assert.equal(reason(desktop.refusals.importCancelled), 'selection_cancelled');
  assert.equal(new RecorderError('delete_cancelled').silent && new RecorderError('selection_cancelled').silent, true);
});

// ── reasons ─────────────────────────────────────────────────────────────────

test('every contract reason and client reason has a plain-English message', () => {
  assert.equal(DESKTOP_REASONS.length, 16);
  for (const reason of [...DESKTOP_REASONS, ...CLIENT_REASONS]) {
    const message = REASON_MESSAGES[reason];
    assert.ok(typeof message === 'string' && message.length > 10, reason);
    assert.doesNotMatch(message, /_/, `${reason} leaks a code into its message`);
  }
  assert.deepEqual(Object.keys(REASON_MESSAGES).sort(), [...DESKTOP_REASONS, ...CLIENT_REASONS].sort(), 'no stray or missing messages');
  assert.doesNotMatch(REASON_MESSAGES.media_tools_unavailable, /Settings/, 'there is no Settings → Tools page to send anyone to');
  assert.match(REASON_MESSAGES.media_tools_unavailable, /ffmpeg/);
  assert.doesNotMatch(REASON_MESSAGES.forbidden, /account/, 'forbidden means the request did not come from the app window');
  assert.equal(REASON_MESSAGES.recorder_busy, 'That recording is busy right now. Try again in a moment.');
  assert.match(REASON_MESSAGES.import_unsupported, /converted/);
  assert.equal(REASON_MESSAGES.library_full, 'Your recordings library is full (10 GB). Delete a recording to make room.');
  assert.deepEqual([...SILENT_REASONS].sort(), ['delete_cancelled', 'selection_cancelled']);
  assert.equal(new RecorderError('selection_cancelled').silent, true);
  assert.equal(new RecorderError('disk_full').silent, false);
  assert.equal(reasonMessage('nonsense'), REASON_MESSAGES.recorder_failed);
  assert.equal(recorderErrorMessage(new RecorderError('delete_cancelled')), null);
  assert.equal(recorderErrorMessage(new RecorderError('disk_full')), REASON_MESSAGES.disk_full);
  assert.equal(recorderErrorMessage(new Error('boom')), REASON_MESSAGES.recorder_failed);
});

// ── availability + the client ───────────────────────────────────────────────

type Call = { operation: string; args: unknown; argc: number };
function fakeWindow(reply: (op: string, args: unknown) => unknown, over: Record<string, unknown> = {}) {
  const calls: Call[] = [];
  const listeners: Array<(e: unknown) => void> = [];
  const win = {
    implexaDesktop: {
      reviewRecorderContractVersion: REVIEW_RECORDER_CONTRACT_VERSION,
      reviewRecorder: async (...a: unknown[]) => { calls.push({ operation: a[0] as string, args: a[1], argc: a.length }); return reply(a[0] as string, a[1]); },
      onReviewRecorderChanged: (cb: (e: unknown) => void) => { listeners.push(cb); return () => { listeners.splice(listeners.indexOf(cb), 1); }; },
      ...over,
    },
  };
  return { win, calls, listeners };
}

test('availability mirrors the training gate: no bridge, old bridge, wrong version', () => {
  assert.equal(recorderAvailability({}).state, 'desktop_required');
  assert.equal(recorderAvailability({ implexaDesktop: { trainingLocal: () => {} } }).state, 'desktop_update_required');
  assert.equal(recorderAvailability(fakeWindow(() => ({}), { reviewRecorderContractVersion: '999' }).win).state, 'desktop_update_required');
  assert.equal(recorderAvailability(fakeWindow(() => ({}), { reviewRecorderContractVersion: undefined }).win).state, 'desktop_update_required');
  assert.equal(recorderAvailability(fakeWindow(() => ({})).win).state, 'ready');
});

test('the client sends ids, the microphone flag and moments, and nothing else', async () => {
  const { win, calls } = fakeWindow((op) => {
    switch (op) {
      case 'start': case 'import': return { ok: true, recordingId: ID };
      case 'status': return { ok: true, active: null };
      case 'list': return { ok: true, recordings: [], library: { usedBytes: 0, limitBytes: 10_000_000_000 } };
      case 'get': return { ok: true, recording: detail() };
      case 'preview': return { ok: true, url: `implexa-artifact://preview/${TOKEN}`, mime: 'video/mp4', token: TOKEN };
      case 'saveMoments': return { ok: true, moments: [moment()] };
      default: return { ok: true };
    }
  });
  const c = createReviewRecorderClient(win, ID);
  await c.start(false); await c.status(); await c.list(); await c.get(ID); await c.preview(ID);
  await c.saveMoments(ID, [moment()], 120_000); await c.importVideo(); await c.recover(ID); await c.remove(ID);
  assert.deepEqual(calls.map((x) => x.operation), ['start', 'status', 'list', 'get', 'preview', 'saveMoments', 'import', 'recover', 'delete']);
  const allowed = new Set(['recordingId', 'microphone', 'moments', 'expectedOwnerId']);
  for (const call of calls) {
    if (call.args === undefined) { assert.equal(call.argc, 1, `${call.operation} sends no args object`); continue; }
    for (const key of Object.keys(call.args as object)) assert.ok(allowed.has(key), `${call.operation} sent ${key}`);
    const id = (call.args as { recordingId?: unknown }).recordingId;
    if (id !== undefined) assert.equal(id, ID);
  }
  assert.deepEqual(calls[0].args, { microphone: false,expectedOwnerId:ID });
});

test('the client refuses path-like ids and invalid drafts before calling the bridge', async () => {
  const { win, calls } = fakeWindow(() => ({ ok: true }));
  const c = createReviewRecorderClient(win, ID);
  for (const id of ['../x', '/Users/me/a.mp4', 'a/b', 'a.mp4', 'C:\\x', '%2e%2e', '', 'x'.repeat(129), 'rec_0001', `${ID}/..`]) {
    await assert.rejects(c.get(id), (e: unknown) => e instanceof RecorderError && e.reason === 'request_invalid', id);
    await assert.rejects(c.remove(id), (e: unknown) => e instanceof RecorderError && e.reason === 'request_invalid', id);
  }
  await assert.rejects(c.saveMoments(ID, [moment({ endMs: 999_999 })], 120_000),
    (e: unknown) => e instanceof RecorderError && e.reason === 'moments_invalid');
  assert.equal(calls.length, 0);
});

test('bridge throws, refusals and missing bridges become typed errors', async () => {
  const thrower = createReviewRecorderClient(fakeWindow(() => { throw new Error('ipc gone'); }).win, ID);
  await assert.rejects(thrower.list(), (e: unknown) => e instanceof RecorderError && e.reason === 'recorder_failed');
  const refuser = createReviewRecorderClient(fakeWindow(() => ({ ok: false, reason: 'selection_cancelled' })).win, ID);
  await assert.rejects(refuser.importVideo(), (e: unknown) => e instanceof RecorderError && e.silent);
  await assert.rejects(createReviewRecorderClient({}).list(), (e: unknown) => e instanceof RecorderError && e.reason === 'desktop_required');
});

test('change events are validated and unsubscribe works', () => {
  const { win, listeners } = fakeWindow(() => ({ ok: true }));
  const seen: unknown[] = [];
  const off = createReviewRecorderClient(win, ID).subscribe((e) => seen.push(e));
  listeners[0]({ ownerId:ID,recordingId: ID, state: 'ready' });
  listeners[0]({ recordingId: '../x', state: 'ready' });
  listeners[0]({ recordingId: 'rec_0001', state: 'ready' });
  listeners[0]({ ownerId:ID,recordingId: ID, state: 'ready', path: '/x' });
  assert.deepEqual(seen, [{ ownerId:ID,recordingId: ID, state: 'ready' }]);
  off();
  assert.equal(listeners.length, 0);
  assert.equal(typeof createReviewRecorderClient({}).subscribe(() => {}), 'function', 'no bridge: a no-op unsubscribe');
});

test('start-failure events accept only bounded diagnostics and remain owner-scoped', () => {
  const event = { ownerId: ID, recordingId: ID, state: 'start_failed',
    failure: { phase: 'display', errorName: 'NotAllowedError', reason: 'not_reported' } };
  assert.equal(isRecorderChange(event), true);
  for (const reason of ['permission_media_types', 'permission_frame', 'permission_url', 'permission_consumed', 'permission_check']) {
    assert.equal(isRecorderChange({ ...event, failure: { ...event.failure, reason } }), true);
  }
  for (const bad of [
    { ...event, failure: undefined }, { ...event, failure: { ...event.failure, phase: 'PRIVATE' } },
    { ...event, failure: { ...event.failure, errorName: 'PRIVATE' } },
    { ...event, failure: { ...event.failure, reason: 'PRIVATE' } },
    { ...event, failure: { ...event.failure, message: 'PRIVATE source or path' } },
    { ...event, state: 'ready' }, { ...event, path: '/private' },
  ]) assert.equal(isRecorderChange(bad), false);
  const { win, listeners } = fakeWindow(() => ({ ok: true }));
  const seen: unknown[] = [];
  const off = createReviewRecorderClient(win, ID).subscribe((e) => seen.push(e));
  listeners[0]({ ...event, ownerId: M1 });
  listeners[0](event);
  assert.deepEqual(seen, [event]);
  off();
});

// ── ranges ──────────────────────────────────────────────────────────────────

test('range clamp: ordered, integer, inside the duration, at most 30 s', () => {
  assert.deepEqual(clampMomentRange(5_000, 1_000, 60_000), { startMs: 1_000, endMs: 5_000 });
  assert.deepEqual(clampMomentRange(-50, 2_000.6, 60_000), { startMs: 0, endMs: 2_001 });
  assert.deepEqual(clampMomentRange(55_000, 70_000, 60_000), { startMs: 55_000, endMs: 60_000 });
  assert.deepEqual(clampMomentRange(0, 45_000, 60_000), { startMs: 0, endMs: MAX_MOMENT_MS });
  assert.equal(clampMomentRange(NaN, 1, 60_000), null);
  assert.equal(clampMomentRange(0, 1, -1), null);
});

test('drag range keeps the anchor, caps at 30 s either way, and snaps', () => {
  assert.deepEqual(rangeFromDrag(40_000, 0, 60_000), { startMs: 10_000, endMs: 40_000 }, 'leftward drag pulls the start, not the end');
  assert.deepEqual(rangeFromDrag(10_000, 59_000, 60_000), { startMs: 10_000, endMs: 40_000 });
  assert.deepEqual(rangeFromDrag(1_234, 5_678, 60_000, 100), { startMs: 1_200, endMs: 5_700 });
  assert.deepEqual(rangeFromDrag(58_000, 75_000, 60_000), { startMs: 58_000, endMs: 60_000 });
});

// ── regions ─────────────────────────────────────────────────────────────────

// A 16:9 video (1600×900) in an 800×600 element: content 800×450, letterboxed 75 px.
// The overlay (ReviewSpatialOverlay) normalizes the drag; regionFromSpatial maps it.
const ELEMENT = { left: 100, top: 50, width: 800, height: 600 };
const drag = (startClientX: number, startClientY: number, endClientX: number, endClientY: number, naturalWidth = 1600, naturalHeight = 900) => {
  const rect = normalizedRectFromDrag({ startClientX, startClientY, endClientX, endClientY, elementRect: ELEMENT, naturalWidth, naturalHeight });
  return rect ? regionFromSpatial({ kind: 'rect', ...rect }) : null;
};

test('region normalization excludes letterbox bars and maps to the video frame', () => {
  assert.deepEqual(drag(100, 125, 900, 575), { x: 0, y: 0, width: COORD_MAX, height: COORD_MAX });
  assert.deepEqual(drag(300, 237.5, 700, 462.5), { x: 250_000, y: 250_000, width: 500_000, height: 500_000 });
  assert.equal(drag(300, 100, 700, 400), null, 'a drag that starts on the top bar marks nothing');
  assert.deepEqual(drag(500, 350, 2_000, 2_000), { x: 500_000, y: 500_000, width: 500_000, height: 500_000 }, 'off the picture stops at its edge');
  // Pillarbox: a portrait video (900×1600) in the same element is 337.5 px wide.
  assert.equal(drag(150, 100, 400, 300, 900, 1600), null);
  assert.deepEqual(drag(331.25, 50, 668.75, 650, 900, 1600), { x: 0, y: 0, width: COORD_MAX, height: COORD_MAX });
  assert.equal(drag(300, 300, 300, 400), null, 'zero width');
});

test('a click (or keyboard Enter) becomes a 20% box around the point, kept inside the frame', () => {
  assert.deepEqual(regionFromSpatial({ kind: 'point', x: 0.5, y: 0.5, width: null, height: null }),
    { x: 400_000, y: 400_000, width: POINT_REGION_SIZE, height: POINT_REGION_SIZE });
  assert.deepEqual(regionFromSpatial({ kind: 'point', x: 0.99, y: 0, width: null, height: null }),
    { x: 800_000, y: 0, width: POINT_REGION_SIZE, height: POINT_REGION_SIZE });
  assert.equal(regionFromSpatial({ kind: 'rect', x: 0.1, y: 0.1, width: null, height: 0.2 }), null);
  assert.equal(regionFromSpatial({ kind: 'point', x: NaN, y: 0, width: null, height: null }), null);
  // Float noise at the far edge never produces x + width > 1e6.
  assert.deepEqual(regionFromSpatial({ kind: 'rect', x: 0.9999996, y: 0, width: 0.0000004, height: 1 }), { x: 999_999, y: 0, width: 1, height: COORD_MAX });
});

test('region overlay folds the letterbox back in', () => {
  const style = regionOverlayStyle({ x: 0, y: 0, width: COORD_MAX, height: COORD_MAX },
    { elementWidth: 800, elementHeight: 600, videoWidth: 1600, videoHeight: 900 })!;
  assert.equal(style.leftPct, 0);
  assert.equal(style.topPct, 12.5);
  assert.equal(style.heightPct, 75);
});

test('a pointer resting since before the range still gives its region (the sampler records nothing while still)', () => {
  const samples: PointerSample[] = [[0, 500_000, 500_000], [60_000, 100_000, 100_000]];
  assert.deepEqual(defaultRegionFromPointer(samples, 10_000, 20_000), { x: 480_000, y: 480_000, width: 40_000, height: 40_000 });
  // Seeded from the position at the start, plus the movement within the range.
  assert.deepEqual(defaultRegionFromPointer(samples, 50_000, 60_000), { x: 80_000, y: 80_000, width: 440_000, height: 440_000 });
  // A sample exactly at the start is the position at the start; nothing earlier is used.
  assert.deepEqual(defaultRegionFromPointer(samples, 60_000, 60_000), { x: 80_000, y: 80_000, width: 40_000, height: 40_000 });
  assert.equal(defaultRegionFromPointer([[0, 1, 1], [5_000]], 6_000, 7_000), null, 'resting off the display is no region');
});

test('default region is the padded, clamped pointer box in the range; null without samples', () => {
  const samples: PointerSample[] = [[0, 100_000, 100_000], [1_000, 300_000, 200_000], [2_000], [3_000, 900_000, 900_000], [9_000, 5_000, 990_000]];
  assert.deepEqual(defaultRegionFromPointer(samples, 0, 1_500), { x: 80_000, y: 80_000, width: 240_000, height: 140_000 });
  assert.deepEqual(defaultRegionFromPointer(samples, 9_000, 9_000), { x: 0, y: 970_000, width: 25_000, height: 30_000 }, 'clamped at the frame edges');
  assert.equal(defaultRegionFromPointer(samples, 2_000, 2_500), null, 'the pointer had left the display');
  assert.equal(defaultRegionFromPointer(null, 0, 10), null);
  assert.equal(defaultRegionFromPointer([], 0, 10), null);
});

// ── suggestions ─────────────────────────────────────────────────────────────

test('dwell suggestions: ≥ 1.2 s within 1.5%, broken by movement or a gap', () => {
  const samples: PointerSample[] = [
    [0, 100_000, 100_000], [500, 105_000, 104_000], [1_500, 110_000, 100_000], // 2.0 s dwell, broken at 2_000
    [2_000, 400_000, 400_000], [3_000, 420_000, 400_000],                      // moved 20_000: breaks at 3_000 (1.0 s, too short)
    [3_000, 420_000, 400_000], [4_500],                                        // 1.5 s, broken by the pointer leaving
    [5_000, 700_000, 700_000], [5_900, 702_000, 702_000],                      // 1.0 s, broken at 6_000: too short
    [6_000, 800_000, 800_000],
  ];
  const s = suggestMoments(samples, 10_000);
  assert.deepEqual(s.map((x) => [x.startMs, x.endMs]), [[0, 2_000], [3_000, 4_500], [6_000, 10_000]]);
  assert.ok(s[0].region, 'each suggestion carries its pointer box');
});

test('suggestions cap at 12 (longest kept, in time order) and each at 30 s', () => {
  const samples: PointerSample[] = [];
  for (let i = 0; i < 20; i++) {
    samples.push([i * 10_000, (i % 2) * 500_000, 0]);
  }
  const s = suggestMoments(samples, 200_000 + 45_000);
  assert.equal(s.length, MAX_SUGGESTIONS);
  assert.ok(s.every((x) => x.endMs - x.startMs <= MAX_MOMENT_MS));
  assert.deepEqual(s.map((x) => x.startMs), [...s.map((x) => x.startMs)].sort((a, b) => a - b));
  assert.equal(s.at(-1)!.endMs - s.at(-1)!.startMs, MAX_MOMENT_MS, 'the last dwell runs to the end and is capped');
  assert.deepEqual(suggestMoments(null, 1_000), []);
});

test('trail: the last 1.5 s, split at gaps', () => {
  const samples: PointerSample[] = [[0, 1, 1], [1_000, 2, 2], [1_200], [1_400, 3, 3], [2_000, 4, 4], [3_000, 5, 5]];
  // The window starts at 500 ms, where the pointer still was at (1, 1).
  assert.deepEqual(pointerTrailAt(samples, 2_000), [[[1, 1], [2, 2]], [[3, 3], [4, 4]]]);
  assert.deepEqual(pointerTrailAt(samples, 100), [[[1, 1]]]);
  assert.deepEqual(pointerTrailAt([], 100), []);
  // A still pointer keeps its dot: the last position before the window seeds it.
  assert.deepEqual(pointerTrailAt([[0, 7, 7]], 60_000), [[[7, 7]]]);
  assert.deepEqual(pointerTrailAt([[0, 7, 7], [10_000, 8, 8]], 10_500), [[[7, 7], [8, 8]]]);
  assert.deepEqual(pointerTrailAt([[0, 7, 7], [1_000]], 60_000), [], 'the pointer left the display');
});

// ── misc ────────────────────────────────────────────────────────────────────

test('dirty detection and formatting', () => {
  assert.equal(momentsDirty([moment()], [moment()]), false);
  assert.equal(momentsDirty([moment()], [moment({ card: { ...emptyCard(), why: 'x' } })]), true);
  assert.equal(formatRecordingDuration(65_000), '1:05');
  assert.equal(formatRecordingDuration(3_723_000), '1:02:03');
  assert.equal(formatRecordingDuration(null), '—');
  assert.equal(formatBytes(10 * 1024 ** 3), '10 GB');
  assert.equal(formatBytes(1.5 * 1024 ** 2), '1.5 MB');
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(null), '—');
});

test('recover is offered for interrupted, and as "Try again" for a failed recording (not a failed upload)', () => {
  assert.deepEqual(recoverAction({ state: 'interrupted', origin: 'recorded' }), { label: 'Recover' });
  assert.deepEqual(recoverAction({ state: 'failed', origin: 'recorded' }), { label: 'Try again' });
  assert.equal(recoverAction({ state: 'failed', origin: 'imported' }), null);
  assert.equal(recoverAction({ state: 'ready', origin: 'recorded' }), null);
  assert.equal(recoverAction({ state: 'finalizing', origin: 'recorded' }), null);
});

test('card rules: What to do length and the learning text rules warn, field by field', () => {
  assert.deepEqual(cardWarnings(emptyCard()), {}, 'an empty draft is not nagged');
  assert.deepEqual(cardWarnings({ ...emptyCard(), whatToDo: 'Keep the price visible in every frame' }), {});
  assert.match(cardWarnings({ ...emptyCard(), whatToDo: 'Too short' }).whatToDo![0], /12–300 characters/);
  assert.match(cardWarnings({ ...emptyCard(), whatToDo: 'x'.repeat(301) }).whatToDo![0], /12–300 characters/);
  const flagged: Array<[string, RegExp]> = [
    ['See https://example.com/brand for colours', /web address/],
    ['Like on www.example.org', /web address/],
    ['Check acme.com first', /web address/],
    ['Email jo@example.com about it', /email address/],
    ['Ask @jordan_k before changing', /@handle/],
    ['Use the file in /Users/jo/brand/logo', /file path/],
    ['Same as ~/Desktop/old', /file path/],
    ['Open C:\\Brand\\logo', /file path/],
    ['Match final_v2.mp4 exactly', /file name/],
    ['Call 5551234567 if unsure', /long number/],
  ];
  for (const [text, kind] of flagged) {
    const w = cardWarnings({ ...emptyCard(), why: text });
    assert.ok(w.why?.length === 1, text);
    assert.ok(w.why![0].startsWith(LEARNING_REFUSAL_PREFIX), text);
    assert.match(w.why![0], kind, text);
  }
  for (const ok of ['A/B testing the hero', 'Use 16:9 at 1080p', 'Keep it under 30 s', 'Wait 2.5 seconds', 'Hold for 123456 frames', 'Email the team']) {
    assert.deepEqual(cardWarnings({ ...emptyCard(), howToCheck: ok }), {}, ok);
  }
  const both = cardWarnings({ ...emptyCard(), whatToDo: 'Go to x.com', whenNot: 'ping @sam' });
  assert.equal(both.whatToDo!.length, 2, 'length and text rule are separate warnings');
  assert.match(both.whenNot![0], /@handle/);
});

test('account-bound bridge refuses missing identity and never publishes foreign-owner notifications',async()=>{
 const {win,calls}=fakeWindow(()=>({ok:true,active:null}));
 await assert.rejects(createReviewRecorderClient(win).status(),(error:any)=>error.reason==='not_linked');
 assert.equal(calls.length,0);
 const foreign='11111111-2222-4333-8444-555555555555';let listener:any;
 const w=fakeWindow(()=>({ok:true,active:null}),{onReviewRecorderChanged:(cb:any)=>{listener=cb;return()=>{};}}).win;
 const seen:any[]=[];createReviewRecorderClient(w,ID).subscribe(value=>seen.push(value));
 listener({ownerId:foreign,recordingId:ID,state:'ready'});listener({recordingId:ID,state:'ready'});
 assert.equal(seen.length,0);listener({ownerId:ID,recordingId:ID,state:'ready'});assert.equal(seen.length,1);
});
