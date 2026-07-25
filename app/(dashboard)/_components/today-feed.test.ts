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

test('the all-clear requires BOTH the live count and the server setup count to be zero', () => {
  // The old page claimed all-clear from server data alone, so it could render
  // "Nothing needs you" directly beneath a client-rendered list of live alerts.
  assert.match(feed, /const nothingAtAll = setupCount === 0 && liveCount === 0;/,
    'both counts, or the claim is not knowable');
  assert.match(feed, /\{nothingAtAll && !warning && \(/,
    'and an unverifiable read must suppress the all-clear entirely');
});

test('the live count comes from RunningAgents itself, not a server guess', () => {
  assert.match(feed, /<RunningAgents alertsOnly bare onCount=\{setLiveCount\} \/>/);
  assert.match(running, /onCountRef\.current\?\.\(list\.length\)/,
    'RunningAgents must report the count it actually rendered');
});

test('the count effect sits BEFORE the early returns — an empty feed still reports 0', () => {
  const effectAt = running.indexOf('onCountRef.current?.(list.length)');
  const earlyReturnAt = running.indexOf('if (!cards) return null;');
  assert.notEqual(effectAt, -1);
  assert.notEqual(earlyReturnAt, -1);
  assert.ok(effectAt < earlyReturnAt,
    'a hook after a conditional return is a React violation AND would strand the parent at a stale count');
});

test('setupCount covers every non-run-keyed blocker Today renders', () => {
  // If a row type is rendered but missing from the count, the all-clear can fire
  // while that row is on screen — the exact contradiction being removed.
  assert.match(feed, /const setupCount = data\.needGrant\.length \+ data\.signIns\.length \+ data\.missed\.length \+ data\.homeAttention\.length;/);
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

test('Results links to /inbox as the archive rather than rendering everything', () => {
  assert.match(page, /href="\/inbox"[\s\S]{0,120}View all/);
});
