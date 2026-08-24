// node --test "app/(dashboard)/_components/today-feed.test.ts"
//
// Home's three-zone redesign (2026-07-24). The load-bearing property is not the
// layout — it is that exactly ONE thing on the page may claim "nothing needs
// you", and that it can only claim it while knowing BOTH counts.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = import.meta.dirname;
const feed = readFileSync(join(dir, 'today-feed.tsx'), 'utf8');
const page = readFileSync(join(dir, '..', 'overview', 'page.tsx'), 'utf8');
const running = readFileSync(join(dir, 'running-agents.tsx'), 'utf8');

// ── UNKNOWN IS NOT EMPTY ─────────────────────────────────────────────────────
// The first cut of this gated the all-clear on `liveCount === 0` with the count
// initialised to 0 — so during the first poll, and after any failed poll, an
// unknown live state read as an empty one and Home could say "Nothing needs you"
// over real work. Exactly the collapse lib/attention.ts's header forbids
// ("unavailable is NOT empty"), reintroduced one layer up. The live read is now
// three-valued and the claim requires it to be READY.

test('the all-clear requires the live read to be READY — not merely to count zero', () => {
  assert.match(feed, /const liveKnown = live\.status === 'ready';/,
    'loading and unavailable are unknown, and unknown may never satisfy an all-clear');
  assert.match(feed, /const nothingAtAll = blockingCount === 0 && liveKnown && live\.count === 0;/,
    'server blockers empty AND live read ready AND live empty — all three');
  assert.match(feed, /\{nothingAtAll && !warning && \(/,
    'and an unverifiable server read must suppress it entirely');
});

test('a LOADING live read cannot produce an all-clear (the first-paint window)', () => {
  // Initial state must be 'loading', not a zero count that looks ready.
  assert.match(feed, /useState<LiveState>\(\{ status: 'loading', count: 0 \}\)/,
    'the feed starts UNKNOWN; a 0 here without the status would read as ready-and-empty');
});

test('an UNAVAILABLE live read is announced, not silently treated as calm', () => {
  assert.match(feed, /const liveUnavailable = live\.status === 'unavailable';/);
  assert.match(feed, /\{liveUnavailable && \([\s\S]{0,400}couldn&apos;t check your live runs/,
    'a failed live read must say so, in the same voice as the server-side warning');
});

test('a MALFORMED 2xx is unavailable too — a success is not proof we understood it', () => {
  // The third variant of this bug: callBackend only throws on a non-2xx, so a
  // dropped/renamed/re-shaped `items` field (or an empty 200 body) arrived as an
  // ordinary success and `Array.isArray(...) ? ... : []` made it a confident
  // empty list. The full matrix is proven behaviourally in lib/live-feed.test.ts;
  // this pins that the component actually ROUTES through that guard.
  assert.match(running, /const items = parseLiveItems<LiveCard>\(res\);/,
    'shape validation must be the single home in lib/live-feed, not re-inlined here');
  assert.match(running, /if \(items === null\) \{\s*\n\s*const held = fold\(\{ kind: 'unreadable' \}\);[\s\S]{0,200}setFailed\(true\);/,
    'an unreadable body must mark the read unavailable — it may republish the last known cards, marked stale, but it may never be folded in as an answer');
  assert.doesNotMatch(running, /if \(items === null\)[\s\S]{0,200}setCards\(normalized\)/,
    'an unreadable body must never reach the fold as if it were data');
  assert.doesNotMatch(running, /Array\.isArray\(res\?\.items\)/,
    'the inline coercion that laundered malformed into empty must not come back');
});

test('RunningAgents reports STATE, and a failed fetch is unavailable — never an empty list', () => {
  assert.match(running, /const liveStatus: LiveState\['status'\] = failed \? 'unavailable' : cards === null \? 'loading' : 'ready';/);
  assert.match(running, /onStateRef\.current\?\.\(\{ status: liveStatus, count: list\.length \}\)/,
    'status travels WITH the count, or the count is unreadable');
  // The original bug: `catch { setCards([]) }` made failure indistinguishable
  // from emptiness. Failure must set the flag, not fabricate an empty result.
  assert.match(running, /catch \{[\s\S]{0,900}setFailed\(true\);/);
  assert.doesNotMatch(running, /catch \{ if \(alive\) setCards\(\[\]\); \}/,
    'a failed live read must never be laundered into an empty one');
  // Stronger than the original: the last known cards are republished, marked
  // stale, rather than merely left in place — so the surface can say WHAT it is
  // showing instead of presenting an old state as a current one.
  assert.match(running, /catch \{[\s\S]{0,900}const held = fold\(\{ kind: 'unreadable' \}\);/,
    'a failed read must go through the continuity fold, which marks what it returns stale');
});

test('the state effect sits BEFORE the early returns (React rule + no stale parent state)', () => {
  const effectAt = running.indexOf('onStateRef.current?.({ status: liveStatus');
  const earlyReturnAt = running.indexOf('if (!cards) return null;');
  assert.notEqual(effectAt, -1);
  assert.notEqual(earlyReturnAt, -1);
  assert.ok(effectAt < earlyReturnAt,
    'a hook after a conditional return is a React violation AND would strand the parent at a stale state');
});

test('blockingCount covers every row Today renders', () => {
  // If a row type is rendered but missing from the count, the all-clear can fire
  // while that row is on screen — the exact contradiction being removed.
  assert.match(feed, /const blockingCount =\s*\n?\s*data\.needGrant\.length \+ data\.signIns\.length \+ data\.missed\.length \+ data\.homeAttention\.length;/);
  for (const rendered of ['data.homeAttention.map', 'data.needGrant.map', 'data.signIns.map', 'data.missed.map']) {
    assert.ok(feed.includes(rendered), `${rendered} is rendered, so it must be counted`);
  }
});

test('Home no longer stacks three separately-headed "needs you" sections', () => {
  assert.doesNotMatch(page, /NeedsYouStrip/, 'the Set-up strip is gone from Home (it still serves /connections)');
  assert.doesNotMatch(page, /<RunningAgents/, 'Alerts is no longer a top-level Home section — TodayFeed owns it');
  assert.match(page, /<TodayFeed\s+data=\{needsYou\}/, 'one surface answers "what needs me?"');
  // The warning is computed on the SERVER and passed in — TodayFeed is a client
  // component and cannot import lib/attention (it reaches next/headers). Caught
  // by `next build`, not by tsc or the unit tests.
  assert.match(page, /warning=\{attentionWarning\(\{ partial: needsYou\.partial, truncated: needsYou\.truncated/,
    'the unverifiable-read warning must still reach Today, or its all-clear loses its suppressor');
});

test('Results makes a claim about RESULTS only — it can never contradict Today', () => {
  const i = page.indexOf('ZONE 3');
  const zone = page.slice(i, i + 1200);
  assert.match(zone, /No results yet\./, 'the empty state is about deliverables');
  assert.doesNotMatch(zone, /Nothing needs you/, 'it must not re-assert the all-clear Today owns');
  assert.doesNotMatch(zone, /needsYou\.homeCount/, 'and must not re-derive needs-you state at all');
});

test('Results links to the Delivered archive rather than rendering everything', () => {
  // The archive moved from /inbox to Work's Delivered filter when Review and
  // Results stopped being destinations of their own (DESIGN.md §8.2). /inbox
  // still redirects there, but this link points at the canonical URL directly
  // so the reader does not take an extra hop.
  assert.match(page, /href="\/work\?view=delivered"[\s\S]{0,120}View all/);
});
