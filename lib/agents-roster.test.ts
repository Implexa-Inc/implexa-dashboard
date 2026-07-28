// node --test lib/agents-roster.test.ts
//
// P0 REGRESSION GUARD (2026-07-28), BEHAVIOURAL.
//
// The first version of this guard was a regex asserting that a particular loop spelling
// existed in workflows/page.tsx. That proves a line of code is present; it does NOT
// prove the invariant, and it would pass against any refactor that reintroduced the bug
// with different syntax. So the merge was extracted into a pure function and is called
// here with real inputs.
//
// THE INVARIANT: `section: 'not_activated'` is a CLAIM about an agent's state, and may
// be made ONLY from a READY feed.
//
// What it looked like when it broke: 48 agents rendered as "Saved as a draft - turn it
// on whenever you're ready" while the backend was returning 33 active / 1
// needs-activation / 16 drafts and nothing had been deactivated.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildRoster } from './agents-roster.ts';

// The real categorizer is regex-matching on names; irrelevant to sectioning, so stub it.
const categorize = () => ({ key: 'other', label: 'Other', emoji: 'x' }) as never;

const lib = (n: number) => Array.from({ length: n }, (_, i) => ({
  slug: `agent-${i}`, name: `Agent ${i}`, source: 'generated',
}));

const feedAgent = (slug: string, over: Record<string, unknown> = {}) => ({
  slug, name: slug, state: 'active', stepsLeft: 0, scheduleNl: null, lastRun: null, ...over,
} as never);

test('UNAVAILABLE feed + 48 library agents → ZERO classified agents', () => {
  // The exact production shape of the bug.
  const { agents, feedReady } = buildRoster({
    feed: { status: 'unavailable', reason: 'timeout' },
    mine: lib(48),
    paused: [], categorize,
  });
  assert.equal(feedReady, false);
  assert.equal(agents.length, 0, 'an unavailable feed must classify NOTHING');
  assert.equal(agents.filter((a) => a.section === 'not_activated').length, 0,
    'this is the defect: 48 agents rendered as drafts from a failed read');
});

test('every unavailable reason classifies nothing — not just timeout', () => {
  for (const reason of ['timeout', 'http_error', 'network', 'malformed', 'no_session'] as const) {
    const { agents } = buildRoster({ feed: { status: 'unavailable', reason }, mine: lib(48), paused: [] });
    assert.equal(agents.length, 0, `reason=${reason} must classify nothing`);
  }
});

test('an unavailable feed does not even surface PAUSED agents', () => {
  // Paused comes from a separate query that may well have succeeded, but rendering a
  // partial roster invites the same misreading: the user cannot tell a short list from
  // a complete one.
  const { agents } = buildRoster({
    feed: { status: 'unavailable', reason: 'network' },
    mine: lib(3),
    paused: [{ skill_slug: 'paused-one' }], categorize,
  });
  assert.equal(agents.length, 0);
});

test('READY but EMPTY feed + library agents → legitimate not_activated rows', () => {
  // The case that must still work. A user who genuinely has never activated anything
  // SHOULD see "needs activation" — the fix must not suppress the true positive.
  const { agents, feedReady } = buildRoster({
    feed: { status: 'ready', active: [], needsActivation: [], drafts: [] },
    mine: lib(3),
    paused: [], categorize,
  });
  assert.equal(feedReady, true);
  assert.equal(agents.length, 3);
  assert.ok(agents.every((a) => a.section === 'not_activated'),
    'with a READY feed listing no activations, the library really is unactivated');
});

test('READY populated feed → correct sections, and the feed wins over the library', () => {
  const { agents } = buildRoster({
    feed: {
      status: 'ready',
      active: [feedAgent('agent-0', { mode: 'scheduled' }), feedAgent('agent-1', { mode: 'on_demand' })],
      needsActivation: [feedAgent('agent-2', { state: 'created' })],
      drafts: [],
    },
    mine: lib(4),                       // agent-0..3 — 0,1,2 also in the feed
    paused: [{ skill_slug: 'agent-9' }], categorize,
  });
  const by = Object.fromEntries(agents.map((a) => [a.slug, a.section]));
  assert.equal(by['agent-0'], 'scheduled');
  assert.equal(by['agent-1'], 'on_demand');
  assert.equal(by['agent-2'], 'not_activated', 'mid-activation is genuinely not activated yet');
  assert.equal(by['agent-3'], 'not_activated', 'library-only agent, feed confirmed it is not activated');
  assert.equal(by['agent-9'], 'paused');
  assert.equal(agents.length, 5, 'no duplicates: the feed entry wins over the library one');
});

test('an ACTIVE agent is never downgraded to not_activated by the library loop', () => {
  // The user-visible symptom: "Final Video Editor With Avatar Presenter" showed as a
  // draft while the backend reported it active with an on-demand schedule.
  const { agents } = buildRoster({
    feed: { status: 'ready', active: [feedAgent('final-video-editor', { mode: 'on_demand' })], needsActivation: [], drafts: [] },
    mine: [{ slug: 'final-video-editor', name: 'Final Video Editor', source: 'generated' }],
    paused: [], categorize,
  });
  assert.equal(agents.length, 1);
  assert.equal(agents[0].section, 'on_demand');
});
