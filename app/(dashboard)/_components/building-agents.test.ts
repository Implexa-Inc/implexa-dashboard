// node --test "app/(dashboard)/_components/building-agents.test.ts"
//
// THE BUG (founder, 2026-08-06): creating an agent showed "Queued" and then
// "Built" — never "Picked Up", never "Running". The dashboard half of that was a
// three-value phase vocabulary with no way to say "a worker has this", and a
// green success checkmark rendered for any request whose status reached `done`,
// including the ones the drain gave up on.
//
// Source-guard style (this repo's answer for un-importable client components):
// anchored on the render forms, never on bare names, since prose matches first.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (f: string) => readFileSync(join(import.meta.dirname, f), 'utf8');
const SRC = read('building-agents.tsx');

test('the card can express all six canonical phases', () => {
  // The old vocabulary was queued | building | built — three values, so "picked
  // up" and "failed" were literally unrenderable no matter what the server sent.
  assert.match(
    SRC,
    /type Phase = 'queued' \| 'claimed' \| 'running' \| 'built' \| 'failed' \| 'cancelled';/,
    'the phase union must match the server vocabulary (migration 0160) exactly',
  );
  for (const phase of ['queued', 'claimed', 'running', 'built', 'failed', 'cancelled']) {
    assert.match(SRC, new RegExp(`^\\s*${phase}:\\s*\\{ title:`, 'm'), `${phase} has no copy, so it would render blank`);
  }
});

test('a claimed request reads "Picked Up" — the state the user could never see', () => {
  assert.match(SRC, /claimed:\s*\{ title: 'Picked Up'/, 'the claimed phase must be labelled Picked Up');
});

test('the phase is taken from the server, never re-derived from timestamps here', () => {
  // The original defect was a private client-side mapping
  // (`consumedAt ? 'building' : 'queued'`) that disagreed with the data. One
  // derivation, server-side (lib/run-request-lifecycle) — a second copy here is
  // how it drifted the first time.
  assert.doesNotMatch(SRC, /\?\s*'building'\s*:\s*'queued'/, 'the collapsed client-side derivation must not come back');
  assert.doesNotMatch(SRC, /phase\s*[:=]\s*[^;]*status\s*===\s*'done'/, 'the client must not map status to a phase itself');
  assert.match(SRC, /const c = COPY\[b\.phase\]/, 'copy is looked up from the phase the server sent');
});

test('a failure states its reason instead of a bare "Failed"', () => {
  assert.match(
    SRC,
    /b\.phase === 'failed' \? \(b\.failureReason \|\| c\.sub\)/,
    'a failed card must show the actionable reason the server recorded',
  );
});

test('only a genuine success gets the success checkmark and the Review CTA', () => {
  // The give-up path closes a request `done`, so a checkmark keyed on "terminal"
  // rather than on "built" is exactly how a build that never ran showed up as
  // "Built ✓ Your agent is ready".
  assert.match(SRC, /b\.phase === 'built' \? \(\s*<span[^>]*bg-emerald-500/, 'the green check is keyed on built, not on terminal');
  assert.match(SRC, /\{b\.phase === 'built' \? \(\s*\n\s*<Link/, 'the Review CTA appears only for a genuinely built agent');
  assert.match(SRC, /b\.phase === 'failed' \? \(\s*<span[^>]*bg-rose-500/, 'a failed build is visually distinct, not another spinner');
});

test('the newly-built agent still opens its detail page first (PR #63 behaviour preserved)', () => {
  assert.match(
    SRC,
    /href=\{b\.workflowSlug \? `\/workflows\/\$\{encodeURIComponent\(b\.workflowSlug\)\}` : '\/workflows'\}/,
    'the build-complete card must open the agent page, not the activation checklist',
  );
  assert.match(SRC, /Review agent/, 'the CTA should say review, not setup');
  assert.doesNotMatch(SRC, /Set up & activate/, 'activation copy would push users past the actual steps');
});

test('lifecycle history is rendered, so a fast build can still prove it ran', () => {
  // "Fast builds may pass quickly through intermediate states, but the UI should
  // still retain/display lifecycle history rather than implying that execution
  // never occurred."
  assert.match(SRC, /lifecycle: LifecycleEvent\[\]/, 'the card must carry the durable lifecycle from the server');
  assert.match(SRC, /const history = \(b\.lifecycle \|\| \[\]\)\.filter\(\(e\) => e\.at\)/, 'history comes from the recorded events');
  assert.match(SRC, /<ol className=/, 'the history renders as an ordered list of stages');
  assert.match(SRC, /STEP_LABEL\[e\.event\]/, 'each recorded stage is labelled');
});

test('elapsed time is anchored on the CURRENT phase, not always on the ask', () => {
  // "Picked Up · 4m" (four minutes claimed, still not started) is the signal the
  // old card could not give at all; measuring from created_at would hide it.
  assert.match(SRC, /if \(b\.phase === 'running'\) return b\.startedAt;/);
  assert.match(SRC, /if \(b\.phase === 'claimed'\) return b\.claimedAt;/);
  assert.match(SRC, /if \(b\.phase === 'queued'\) return b\.queuedAt;/);
});

test('a failed read is not rendered as an empty queue', () => {
  // The old component did `catch { setBuilds([]) }` — an unreachable backend
  // looked exactly like "nothing is building". Unavailable is not empty.
  assert.doesNotMatch(SRC, /catch\s*\{\s*if \(alive\) setBuilds\(\[\]\); \}/, 'a failed poll must not blank the list');
  assert.match(SRC, /if \(res && res\.ok === false\) \{ setUnavailable\(true\); return; \}/, 'an explicit server failure sets the unavailable state');
  assert.match(SRC, /Couldn’t load build status/, 'and it is actually surfaced to the user');
});

test('an in-flight build cannot be dismissed out from under itself', () => {
  // The ✕ is a "clear this finished card" affordance. Offering it mid-build would
  // let a user hide a run that is still going and then wonder where it went.
  assert.match(SRC, /const done = TERMINAL\.has\(b\.phase\);/);
  assert.match(SRC, /\{done \? \(\s*\n\s*<button[\s\S]{0,200}aria-label="Dismiss"/, 'dismiss is gated on a terminal phase');
});
