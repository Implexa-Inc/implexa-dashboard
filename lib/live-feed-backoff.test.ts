// node --test lib/live-feed-backoff.test.ts
//
// The shared live-feed poller's cadence and pause rules (pure). Plus the
// structural pins on lib/live-feed-poll.ts and agent-actions.tsx that keep
// the "one poller, not one per component" shape from regressing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  LIVE_POLL_BASE_MS,
  LIVE_POLL_STEPS,
  nextLiveFeedDelay,
  shouldPauseLivePolling,
} from './live-feed-backoff.ts';

test('a live card holds the base cadence; idle escalates one step per tick and caps', () => {
  assert.equal(nextLiveFeedDelay(LIVE_POLL_BASE_MS, true), LIVE_POLL_BASE_MS);
  let d: number = LIVE_POLL_BASE_MS;
  const seen: number[] = [];
  for (let i = 0; i < 8; i += 1) { d = nextLiveFeedDelay(d, false); seen.push(d); }
  assert.deepEqual(seen.slice(0, 4), [10000, 20000, 45000, 90000], 'one step per idle tick');
  assert.ok(seen.slice(4).every((x) => x === 90000), 'holds at the cap, never beyond');
  assert.equal(nextLiveFeedDelay(90000, true), LIVE_POLL_BASE_MS, 'activity snaps back from the cap');
});

test('every step is one of the declared steps (no drifting cadence)', () => {
  let d: number = LIVE_POLL_BASE_MS;
  for (let i = 0; i < 10; i += 1) {
    d = nextLiveFeedDelay(d, false);
    assert.ok((LIVE_POLL_STEPS as readonly number[]).includes(d));
  }
});

test('polling pauses for hidden tabs and while typing — and only then', () => {
  assert.equal(shouldPauseLivePolling(undefined), false, 'no document (SSR) → not paused');
  assert.equal(shouldPauseLivePolling({}), false, 'visible, nothing focused → poll');
  assert.equal(shouldPauseLivePolling({ hidden: true }), true, 'hidden tab → paused');
  assert.equal(shouldPauseLivePolling({ activeElement: { tagName: 'INPUT' } }), true, 'typing in an input → paused');
  assert.equal(shouldPauseLivePolling({ activeElement: { tagName: 'textarea' } }), true, 'textarea (any case) → paused');
  assert.equal(shouldPauseLivePolling({ activeElement: { tagName: 'DIV', isContentEditable: true } }), true, 'contenteditable → paused');
  assert.equal(shouldPauseLivePolling({ activeElement: { tagName: 'BUTTON' } }), false, 'a focused button must NOT pause the label refresh');
});

// ── structural pins ──────────────────────────────────────────────────────────

const pollerSrc = readFileSync(join(import.meta.dirname, 'live-feed-poll.ts'), 'utf8');
const actionsSrc = readFileSync(join(import.meta.dirname, '..', 'app', '(dashboard)', '_components', 'agent-actions.tsx'), 'utf8');

test('ONE shared poller: agent-actions subscribes instead of running its own live-feed interval', () => {
  assert.match(actionsSrc, /subscribeLiveFeed\(/, 'the discovery effect must ride the shared poller');
  assert.doesNotMatch(actionsSrc, /setInterval\([\s\S]{0,400}scheduled-skills\/live/,
    'a per-component live-feed interval is the double-poll regression (two instances = two 5s timers)');
  assert.match(pollerSrc, /shouldPauseLivePolling/, 'the poller must apply the pause rules');
  assert.match(pollerSrc, /nextLiveFeedDelay/, 'the poller must apply the idle backoff');
  assert.match(pollerSrc, /if \(!subscribers\.size\) stop\(\)/, 'last unsubscribe must stop the timer');
});

test('exactly one revise refresh loop: ReviseLandedPoller owns it, agent-actions does not', () => {
  assert.doesNotMatch(actionsSrc, /setInterval\([\s\S]{0,200}router\.refresh/,
    'the 20s refresh interval in agent-actions duplicated ReviseLandedPoller — two loops replayed the whole server render twice');
});

test('the poller reaches Supabase/the backend through the STUBBABLE module ids', () => {
  // lib/test/render.ts aliases exactly '@/lib/supabase/client' and '@/lib/api'
  // to its stubs. Importing either by relative path bypasses that alias and
  // bundles the real Supabase browser client into jsdom, whose token
  // auto-refresh timer keeps the test process alive forever — the whole suite
  // hangs with no failing assertion to point at it.
  assert.match(pollerSrc, /from '@\/lib\/supabase\/client'/);
  assert.match(pollerSrc, /from '@\/lib\/api'/);
  assert.doesNotMatch(pollerSrc, /from '\.\/(supabase\/client|api)'/);
});

test('the per-run note survives remounts (per-tab draft), and queuing snaps the shared cadence', () => {
  assert.match(actionsSrc, /readRunNoteDraft\(slug\)/, 'runNote must hydrate from the per-tab draft');
  assert.match(actionsSrc, /writeRunNoteDraft\(slug, runNote\)/, 'runNote must persist as it is typed');
  assert.match(actionsSrc, /notifyRunActivity\(\)/, 'a queued run must reset the shared poll cadence');
});
