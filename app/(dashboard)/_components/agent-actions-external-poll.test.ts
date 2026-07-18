// node --test "app/(dashboard)/_components/agent-actions-external-poll.test.ts"
// (Node 22.6+ strips the types natively)
//
// REGRESSION GUARD — the agent detail page's "Run now" button must discover a
// run queued on a DIFFERENT surface, not just follow one it already knew about.
//
// What broke (2026-07-18): <RunContinueBox/> on /runs/[id] queues a kind='continue'
// run-request. The agent page's <AgentActions/> has an "externally-observed
// in-flight run" poll specifically meant to catch this (its own comment: "queued/
// running came from the SERVER... Track it via the live feed instead"). But that
// poll effect was gated `if (state !== 'queued' && state !== 'running') return;`
// — so it only ever RAN if `state` was already queued/running. Since `state`
// starts at 'idle' whenever the server-computed `inFlight` prop was null (i.e.
// whenever nothing was queued yet AT PAGE LOAD), the poll never started, so it
// could never discover a run that got queued afterward from a different page.
// Founder hit this directly: queued a continue from the run page's pop-up, closed
// it, came back to the agent page (still mounted the whole time) — button still
// said "Run now".
//
// Fix: the poll now runs unconditionally from mount (empty dependency array), so
// it can DISCOVER an external run, not just follow one already known. This file
// pins the source structure directly (this codebase's established pattern for a
// .tsx file with no JSX-shaped test path — see runs/[id]/continue-affordance.test.ts).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(import.meta.dirname, 'agent-actions.tsx'), 'utf8');

function externalPollEffectBody() {
  const anchor = 'Externally-observed in-flight run:';
  const start = src.indexOf(anchor);
  assert.ok(start !== -1, 'the externally-observed in-flight run effect and its comment must still exist');
  const end = src.indexOf('\n  }, [', start);
  assert.ok(end !== -1, 'could not find the end of the external-poll useEffect');
  const depsEnd = src.indexOf(');', end);
  return src.slice(start, depsEnd + 2);
}

test('the external-poll effect runs unconditionally from mount, not gated on state already being queued/running', () => {
  const body = externalPollEffectBody();
  // The regression: an early return keyed on `state` at the TOP of the effect
  // (before the interval is even created) means it never starts polling from idle.
  assert.doesNotMatch(
    body,
    /^\s*if \(state !== 'queued' && state !== 'running'\) return;/m,
    'must not early-return on state before creating the interval — that is exactly what stopped it discovering an externally-queued run',
  );
  // The effect must depend on mount only (`[]`), not on `state` — depending on
  // `state` would tear the interval down and lose its `misses` counter on every
  // status flip, and (before this fix) is what let the top-of-effect gate above
  // suppress it from ever starting while idle.
  assert.match(body, /\}, \[\]\);\s*$/, 'the external-poll effect must have an empty dependency array (runs once, from mount)');
});

test('the external-poll effect reads current state via stateRef, not a stale closure, when deciding to reset to idle', () => {
  const body = externalPollEffectBody();
  assert.match(
    body,
    /stateRef\.current === 'queued' \|\| stateRef\.current === 'running'/,
    'the reset-to-idle branch must check stateRef.current (kept fresh by a separate effect), not `state` captured in the mount-once closure',
  );
});

test('a run-request started from THIS component still defers to its own dedicated poll', () => {
  const body = externalPollEffectBody();
  // Two guards must survive: one at effect setup (skip entirely if a request was
  // already in flight from this exact component when it mounted) and one INSIDE
  // the interval tick (so a request started here mid-poll doesn't get double-tracked).
  assert.match(body, /if \(requestId\.current\) return;\s*\/\/ user-initiated runs use the poll above/,
    'effect-setup guard must survive');
  const tickGuardCount = (body.match(/if \(requestId\.current\) return;/g) || []).length;
  assert.equal(tickGuardCount, 2, 'the requestId guard must appear both at effect setup AND inside each interval tick');
});
