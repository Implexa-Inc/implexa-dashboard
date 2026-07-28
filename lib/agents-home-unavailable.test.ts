// node --test lib/agents-home-unavailable.test.ts
//
// P0 REGRESSION GUARD (2026-07-28).
//
// getMyAgents() converted EVERY failure - timeout, non-200, network - into `null`, and
// coerced a malformed 200 into empty arrays. The workflows page then matched no agents
// from the feed and classified every library item as `not_activated`, rendering
// "Saved as a draft - turn it on whenever you're ready" across the entire roster.
//
// The founder's dashboard showed 48 agents "needing activation" while the backend was
// returning 33 active / 1 needs-activation / 16 drafts and the database was untouched.
// A failed READ rendered as a confident, alarming, actionable STATUS: go re-activate 48
// agents that were never off.
//
// The rule these guard: ABSENCE OF DATA IS NOT EVIDENCE OF ABSENCE OF ACTIVATION.
// Every failure must stay distinguishable from "this user genuinely has no active
// agents", all the way to the UI.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { getMyAgents, parseAgentsBody } from './agents-feed-core.ts';

const TOKEN = async () => 'jwt-token';
const AGENT = { slug: 'a', name: 'A', state: 'active', stepsLeft: 0, scheduleNl: null, lastRun: null };

const respond = (body: unknown, init: { ok?: boolean; status?: number } = {}) =>
  (async () => ({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
  })) as unknown as typeof fetch;

test('a healthy response is ready, and carries the agents through', async () => {
  const feed = await getMyAgents({
    getToken: TOKEN,
    fetchImpl: respond({ needsActivation: [], active: [AGENT], drafts: [] }),
  });
  assert.equal(feed.status, 'ready');
  if (feed.status !== 'ready') return;
  assert.equal(feed.active.length, 1);
});

test('a TIMEOUT is unavailable, not an empty roster', async () => {
  // The failure that actually fired: /me/agents measured 2.5-4.5s for 50 agents against
  // an 8s abort, and its cost grows with the roster.
  const feed = await getMyAgents({
    getToken: TOKEN,
    fetchImpl: (async () => { const e = new Error('timed out'); e.name = 'TimeoutError'; throw e; }) as unknown as typeof fetch,
  });
  assert.deepEqual(feed, { status: 'unavailable', reason: 'timeout' });
});

test('a NON-200 is unavailable, not an empty roster', async () => {
  const feed = await getMyAgents({
    getToken: TOKEN,
    fetchImpl: respond({ error: 'boom' }, { ok: false, status: 500 }),
  });
  assert.deepEqual(feed, { status: 'unavailable', reason: 'http_error' });
});

test('a NETWORK error is unavailable, not an empty roster', async () => {
  const feed = await getMyAgents({
    getToken: TOKEN,
    fetchImpl: (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch,
  });
  assert.deepEqual(feed, { status: 'unavailable', reason: 'network' });
});

test('a MALFORMED 200 is unavailable — it must NOT become empty arrays', async () => {
  // The variant that survived the first fix attempt: a 200 whose body is missing the
  // arrays used to be coerced to `{active: [], needsActivation: []}`, which is
  // indistinguishable from a real user with no agents, and renders identically to the
  // bug. Shape validation is what separates them.
  for (const body of [{}, { active: 'nope' }, null, [], { needsActivation: [] }]) {
    const feed = await getMyAgents({ getToken: TOKEN, fetchImpl: respond(body) });
    assert.deepEqual(feed, { status: 'unavailable', reason: 'malformed' }, `body ${JSON.stringify(body)}`);
  }
});

test('a body that is not JSON at all is unavailable', async () => {
  const feed = await getMyAgents({
    getToken: TOKEN,
    fetchImpl: (async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad json'); } })) as unknown as typeof fetch,
  });
  assert.deepEqual(feed, { status: 'unavailable', reason: 'malformed' });
});

test('no session is unavailable, and never reaches the network', async () => {
  let called = false;
  const feed = await getMyAgents({
    getToken: async () => null,
    fetchImpl: (async () => { called = true; throw new Error('should not fetch'); }) as unknown as typeof fetch,
  });
  assert.deepEqual(feed, { status: 'unavailable', reason: 'no_session' });
  assert.equal(called, false);
});

test('parseAgentsBody tolerates a missing drafts array but never a missing active', async () => {
  // A backend predating `drafts` is still usable. `active`/`needsActivation` are not
  // optional: they are what the page uses to decide an agent IS activated.
  const ok = parseAgentsBody({ active: [AGENT], needsActivation: [] });
  assert.equal(ok.status, 'ready');
  if (ok.status === 'ready') assert.deepEqual(ok.drafts, []);
  assert.equal(parseAgentsBody({ needsActivation: [], drafts: [] }).status, 'unavailable');
});
