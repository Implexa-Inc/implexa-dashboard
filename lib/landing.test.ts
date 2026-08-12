// node --test lib/landing.test.ts
//
// THE BUG THIS FILE EXISTS FOR.
//
// /start used to answer "does anything need me?" with two raw skill_runs
// predicates — `review_status = 'pending' or run_state = 'stalled'`, and
// `run_state in (queued, running)` — invented in the page. That is a third read
// authority, and it is blind to most of what needs a human: Judge blocks, typed
// held runs, ungranted permissions, signed-out connections, failed and
// never-armed schedules, everything the review queue knows that a column does
// not, and every partial or truncated read in all of the above.
//
// A user with a Judge-blocked run and a signed-out Google account was sent to
// Agents and told, by omission, that nothing needed them.
//
// So the tests below are mostly UNFAVOURABLE: each one puts real work or a dark
// source in exactly one model and asserts the answer is still Work.

import { test } from 'node:test';
import assert from 'node:assert/strict';
// landing.ts writes its runtime imports extensionless, like every source file
// here, so it is loaded through the register hook rather than directly.
import '../test/support/tsx-register.mjs';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const mod = await import('@/lib/landing.ts');
const { landingSnapshot, LIVE_IN_FLIGHT_STATUSES, LIVE_NEEDS_YOU_STATUSES } = mod;
const { resolveDefaultLanding } = await import('@/lib/navigation.ts');

type NeedsYouSummary    = { total: number; partial: boolean; truncated: boolean };
type ReviewQueueSummary = Parameters<typeof landingSnapshot>[1];
type LiveSummary        = Parameters<typeof landingSnapshot>[2];

const QUIET_NEEDS: NeedsYouSummary   = { total: 0, partial: false, truncated: false };
const QUIET_QUEUE: ReviewQueueSummary = { items: [], sources: { holds: 'ready', judgments: 'ready' }, truncated: false, live: true };
const QUIET_LIVE:  LiveSummary        = { status: 'ready', items: [] };

const landing = (n = QUIET_NEEDS, q = QUIET_QUEUE, l = QUIET_LIVE) =>
  resolveDefaultLanding(landingSnapshot(n, q, l));

const queueItem = { rootRunId: 'r1' } as unknown as ReviewQueueSummary['items'][number];

test('everything genuinely quiet is the ONLY way to reach Agents', () => {
  assert.equal(landing(), '/workflows');
  assert.deepEqual(landingSnapshot(QUIET_NEEDS, QUIET_QUEUE, QUIET_LIVE), {
    needsDecision: 'no', inProgress: 'no',
  });
});

// ── Rule 1: something needs a decision ───────────────────────────────────────

test('anything counted by the Needs-you model sends the user to Work', () => {
  // total spans grants, sign-ins, missed/never-armed schedules, stalls, Judge
  // blocks and typed held runs — none of which the old skill_runs predicates saw.
  assert.equal(landing({ total: 1, partial: false, truncated: false }), '/work');
});

test('a non-empty review queue sends the user to Work', () => {
  assert.equal(landing(QUIET_NEEDS, { ...QUIET_QUEUE, items: [queueItem] }), '/work');
});

test('a live card waiting on the human sends the user to Work', () => {
  for (const status of LIVE_NEEDS_YOU_STATUSES) {
    assert.equal(landing(QUIET_NEEDS, QUIET_QUEUE, { status: 'ready', items: [{ status }] }), '/work',
      `live status "${status}" needs the user`);
  }
});

// ── Rule 2: something is in flight ───────────────────────────────────────────

test('a live card in flight sends the user to Work', () => {
  for (const status of LIVE_IN_FLIGHT_STATUSES) {
    const snap = landingSnapshot(QUIET_NEEDS, QUIET_QUEUE, { status: 'ready', items: [{ status }] });
    assert.equal(snap.inProgress, 'yes', `live status "${status}" is in flight`);
    assert.equal(resolveDefaultLanding(snap), '/work');
  }
});

test('a finished card is neither in flight nor waiting', () => {
  assert.equal(landing(QUIET_NEEDS, QUIET_QUEUE, { status: 'ready', items: [{ status: 'finished' }] }), '/workflows');
});

// ── Unknown is not "no" ──────────────────────────────────────────────────────

test('a PARTIAL Needs-you read cannot produce an all-clear', () => {
  // partial ORs all five of that model's sources. Any one dark makes the list
  // unverifiable, and an unverifiable list must not become "nothing needs you".
  const snap = landingSnapshot({ total: 0, partial: true, truncated: false }, QUIET_QUEUE, QUIET_LIVE);
  assert.equal(snap.needsDecision, 'unknown');
  assert.equal(resolveDefaultLanding(snap), '/work');
});

test('a TRUNCATED Needs-you read cannot produce an all-clear', () => {
  assert.equal(landing({ total: 0, partial: false, truncated: true }), '/work');
});

test('an unavailable review SOURCE cannot produce an all-clear', () => {
  // Zero items over a source that did not answer is not zero work.
  const snap = landingSnapshot(QUIET_NEEDS, { ...QUIET_QUEUE, sources: { holds: 'ready', judgments: 'unavailable' } }, QUIET_LIVE);
  assert.equal(snap.needsDecision, 'unknown');
  assert.equal(resolveDefaultLanding(snap), '/work');
});

test('a review queue that could not be loaded at all cannot produce an all-clear', () => {
  assert.equal(landing(QUIET_NEEDS, { ...QUIET_QUEUE, live: false }), '/work');
});

test('a TRUNCATED review queue cannot produce an all-clear', () => {
  assert.equal(landing(QUIET_NEEDS, { ...QUIET_QUEUE, truncated: true }), '/work');
});

test('a `disabled` review source is configuration, not failure', () => {
  // Only 'unavailable' is a broken read; treating 'disabled' as unknown would
  // pin every user to Work forever on an ordinary config.
  assert.equal(landing(QUIET_NEEDS, { ...QUIET_QUEUE, sources: { holds: 'ready', acceptance: 'disabled' } }), '/workflows');
});

test('an unreadable live feed cannot produce an all-clear, for either rule', () => {
  for (const reason of ['no_session', 'http_error', 'timeout', 'network', 'malformed'] as const) {
    const snap = landingSnapshot(QUIET_NEEDS, QUIET_QUEUE, { status: 'unavailable', reason });
    assert.equal(snap.needsDecision, 'unknown', `live ${reason}`);
    assert.equal(snap.inProgress, 'unknown', `live ${reason}`);
    assert.equal(resolveDefaultLanding(snap), '/work');
  }
});

test('KNOWN work outranks an unknown source rather than being masked by it', () => {
  // 'yes' must beat 'unknown': a partial read that still found something is a
  // decisive answer, not a shrug.
  const snap = landingSnapshot(
    { total: 3, partial: true, truncated: true },
    { ...QUIET_QUEUE, live: false },
    { status: 'unavailable', reason: 'timeout' },
  );
  assert.equal(snap.needsDecision, 'yes');
  assert.equal(resolveDefaultLanding(snap), '/work');
});

test('every single dark source alone is enough to withhold the all-clear', () => {
  const dark: Array<[string, () => string]> = [
    ['needs-you partial',   () => landing({ total: 0, partial: true, truncated: false })],
    ['needs-you truncated', () => landing({ total: 0, partial: false, truncated: true })],
    ['queue offline',       () => landing(QUIET_NEEDS, { ...QUIET_QUEUE, live: false })],
    ['queue truncated',     () => landing(QUIET_NEEDS, { ...QUIET_QUEUE, truncated: true })],
    ['queue source dark',   () => landing(QUIET_NEEDS, { ...QUIET_QUEUE, sources: { holds: 'unavailable' } })],
    ['live unreadable',     () => landing(QUIET_NEEDS, QUIET_QUEUE, { status: 'unavailable', reason: 'network' })],
  ];
  for (const [name, run] of dark) {
    assert.equal(run(), '/work', `${name} must not resolve to Agents`);
  }
});

// ── Failing closed when a model throws ───────────────────────────────────────

test('a model that THREW is treated as unreadable, never as empty', () => {
  // lib/landing-load.ts substitutes these when a read rejects. Each must be the
  // "we could not see this" shape; an "there is nothing" shape here would turn
  // an outage into a confident all-clear.
  const { UNREADABLE_NEEDS, UNREADABLE_QUEUE, UNREADABLE_LIVE } = mod;

  assert.equal(landingSnapshot(UNREADABLE_NEEDS, QUIET_QUEUE, QUIET_LIVE).needsDecision, 'unknown');
  assert.equal(landingSnapshot(QUIET_NEEDS, UNREADABLE_QUEUE, QUIET_LIVE).needsDecision, 'unknown');
  assert.equal(landingSnapshot(QUIET_NEEDS, QUIET_QUEUE, UNREADABLE_LIVE).inProgress, 'unknown');

  // All three dark at once — the total-outage case.
  assert.equal(
    resolveDefaultLanding(landingSnapshot(UNREADABLE_NEEDS, UNREADABLE_QUEUE, UNREADABLE_LIVE)),
    '/work',
  );
});

test('/start consumes the composed snapshot and owns no query of its own', () => {
  // The exact regression this file documents: the page derived the answer from
  // raw skill_runs predicates. It must read the authoritative models through
  // loadLandingSnapshot and nothing else.
  const raw = readFileSync(join(process.cwd(), 'app', '(dashboard)', 'start', 'page.tsx'), 'utf8');
  // Comments are stripped first: the file's docblock NAMES the old predicates in
  // order to warn against them, and matching those would make this vacuous.
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.match(code, /loadLandingSnapshot/, 'the snapshot must come from the composed loader');
  assert.match(code, /resolveDefaultLanding/, 'the rule must come from lib/navigation');
  assert.doesNotMatch(code, /\.from\(/, '/start must not query a table directly');
  assert.doesNotMatch(code, /skill_runs|review_status|run_state/, '/start must not re-derive needs-you state');
});

// `timeout` so a BROKEN deadline fails this test in two seconds instead of
// hanging the suite on the never-resolving promise below.
test('a model that never answers hits the deadline and reads as unreadable', { timeout: 2000 }, async () => {
  // /start sits in the sign-in path; the review queue alone allows itself 20s
  // for a cold database. A slow model must not stall the redirect — and must
  // not be mistaken for an empty one on the way out.
  const { settleWithin, UNREADABLE_QUEUE, LANDING_READ_DEADLINE_MS } = mod;
  const never = new Promise<never>(() => {});

  assert.deepEqual(await settleWithin(never, 10, UNREADABLE_QUEUE), UNREADABLE_QUEUE);
  assert.equal(landingSnapshot(QUIET_NEEDS, UNREADABLE_QUEUE, QUIET_LIVE).needsDecision, 'unknown');
  assert.ok(LANDING_READ_DEADLINE_MS > 0 && LANDING_READ_DEADLINE_MS < 20_000,
    'the landing deadline must be well inside the review queue own 20s ceiling');
});

test('a rejection also yields the fallback, and a fast answer is never overridden', async () => {
  const { settleWithin, UNREADABLE_QUEUE } = mod;
  assert.deepEqual(await settleWithin(Promise.reject(new Error('boom')), 10, UNREADABLE_QUEUE), UNREADABLE_QUEUE);
  assert.deepEqual(await settleWithin(Promise.resolve('fast'), 10_000, 'slow'), 'fast');
});
