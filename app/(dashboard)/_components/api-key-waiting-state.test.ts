// node --test "app/(dashboard)/_components/api-key-waiting-state.test.ts"
// (Node 22.6+ strips the types natively)
//
// REGRESSION GUARD — the key-entry "waiting" state must never trap the user.
//
// THIS BUG HAS SHIPPED TWICE. The #56 reviewer raised it as a P1 ("cancelling
// the local key window leaves the dashboard on 'Waiting for you to save…' until
// refresh — it needs a cancellation event so the Add key button returns"), and
// it was then reproduced verbatim in InlineAddKeyButton when that component was
// written for the requirements panel. The founder hit it live: clicked "Add API
// key", closed the window without saving, and both rows sat on "Waiting for
// save…" with no control at all and no way back short of a page reload.
//
// Root cause is structural, not cosmetic: the desktop bridge fires an event when
// a key IS saved (onKeysChanged) but has NO event for "the user closed the
// window without saving". So `awaiting` had exactly one exit — a successful save
// — and every other path (close, cancel, walk away) was a dead end. A real
// cancel event needs a desktop release; these two invariants fix it against the
// CURRENT installed app and stay correct once that event lands:
//
//   1. The control stays CLICKABLE while awaiting (re-opens the window).
//   2. The wait SELF-EXPIRES, so it stops claiming a save is still coming.
//
// Both components that render key entry must hold both invariants.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(import.meta.dirname, 'api-key-row.tsx'), 'utf8');

function componentBody(name: string) {
  const start = src.indexOf(`export function ${name}`);
  assert.ok(start !== -1, `${name} must still exist`);
  // Up to the next top-level export (or EOF).
  const next = src.indexOf('\nexport function ', start + 1);
  return src.slice(start, next === -1 ? undefined : next);
}

test('InlineAddKeyButton never renders a dead span while awaiting — the exact founder-reported trap', () => {
  const body = componentBody('InlineAddKeyButton');
  // The original bug, verbatim: `if (awaiting) { return <span>…</span>; }` —
  // an early return that drops the button entirely.
  assert.doesNotMatch(
    body,
    /if \(awaiting\)\s*\{\s*return\s*<span/,
    'awaiting must NOT early-return a non-interactive <span> — that is precisely what left the row with no way back',
  );
  // The button must be reachable on the awaiting path: the only early returns
  // allowed before it are the fully-ready state and no-bridge (plain web).
  assert.match(body, /if \(saved && granted\)\s*\{\s*return/, 'the ready state may early-return (nothing to do)');
  assert.match(body, /if \(!bridge\?\.openKeySetup\)/, 'no-bridge may early-return (nothing to click)');
  // The awaiting state must RELABEL the same button, never replace it. The label
  // is computed across three states (add / grant-only / awaiting), so assert the
  // awaiting branch specifically rather than one literal ternary.
  assert.match(body, /const label = awaiting\s*\n?\s*\? 'Waiting… — reopen'/, 'awaiting relabels the same button');
  assert.match(body, /: \(saved \? 'Use saved key' : 'Add API key'\)/, 'the non-awaiting label distinguishes grant-only from first-time add');
});

test('KeyRow keeps its Add-key control visible while awaiting', () => {
  const body = componentBody('KeyRow');
  // The original hid the whole button CLUSTER behind `!awaiting`. Anchored on the
  // cluster's own div so it stays specific: other elements (e.g. the unverified
  // "Check again" hint) may legitimately be awaiting-conditional — hiding a hint
  // while the window is open is fine; hiding the only control is the trap.
  assert.doesNotMatch(
    body,
    /!awaiting && \(\s*\n\s*<div className="flex-none/,
    'the control cluster must not be hidden by !awaiting — that strands the row mid-flow',
  );
  // Gated on readiness only (see the saved-AND-granted test below for why the
  // gate is `ready` rather than the provider boolean).
  assert.match(body, /\{!ready && \(/, 'the cluster is gated on readiness only');
  assert.match(body, /\{awaiting \? 'Reopen' : \(\(needsGrantOnly \|\| verifyUnknown\) \? 'Use saved key' : 'Add key'\)\}/,
    'the button relabels to Reopen while awaiting, and distinguishes grant-only from first-time add');
});

// REVIEW BLOCKER (2026-07-18): the grant-only flow was wired in ONE of three
// surfaces. The other two still read the PROVIDER boolean alone, which recreates
// the very dead end the change exists to remove — a Runway key saved for Agent A
// makes a brand-new Agent B look ready, with no way to authorize B.
test('KeyRow (activation/setup) gates on saved AND granted-for-this-agent, not the provider boolean alone', () => {
  const body = componentBody('KeyRow');
  // It must ASK for the per-agent grant…
  assert.match(body, /bridge\.keysGrantedFor\(slug\)/, 'KeyRow must read the per-agent grant');
  // …and derive readiness from BOTH booleans.
  assert.match(body, /const ready = !!item\.configured && granted !== false && !verifyFailed;/, 'ready = saved AND not-denied for this agent AND actually verified');
  assert.match(body, /const needsGrantOnly = !!item\.configured && granted === false;/, 'saved-but-ungranted is its own state');
  // The control must be gated on `ready`, NOT on item.configured — gating on the
  // provider boolean is exactly what hid the button from an ungranted agent.
  assert.match(body, /\{!ready && \(/, 'the control cluster is gated on ready, not item.configured');
  assert.doesNotMatch(body, /\{!item\.configured && \(\s*\n\s*<div className="flex-none/, 'must NOT gate the control cluster on the provider boolean alone');
  // And it must offer the grant-only action rather than inviting a re-paste.
  assert.match(body, /\(needsGrantOnly \|\| verifyUnknown\) \? 'Use saved key' : 'Add key'/, 'a saved-but-ungranted agent — and a saved-but-unverifiable one — are both offered "Use saved key"');
});

// A premature retry re-runs the agent BEFORE it can read the key — a keyless run
// and a second Needs-You for the same underlying cause.
test('CapabilityCard retries only once THIS AGENT is granted, never on the provider boolean', () => {
  const src = readFileSync(join(import.meta.dirname, 'capability-card.tsx'), 'utf8');
  const start = src.indexOf('useEffect(() => {\n    if (!awaitingKey) return;');
  assert.ok(start !== -1, 'the awaiting-key effect must still exist');
  const body = src.slice(start, src.indexOf('}, [awaitingKey])', start));

  // The grant check must come FIRST and must early-return, so the provider
  // fallback below can never run on a build that has keysGrantedFor.
  const grantIdx = body.indexOf('bridge.keysGrantedFor');
  const cfgIdx = body.indexOf('bridge.keysConfigured!()');
  assert.ok(grantIdx !== -1, 'must consult the per-agent grant');
  assert.ok(cfgIdx !== -1, 'the provider fallback is still present for older desktop builds');
  assert.ok(grantIdx < cfgIdx, 'the per-agent grant must be checked BEFORE the provider fallback');
  assert.match(body, /if \(grants && grants\[awaitingKey\] === true\) \{ done = true; setAwaitingKey\(null\); await onRetry\(\); \}\s*\n\s*return;/,
    'the grant branch must early-return so a granted-false agent never falls through to the provider check');
  assert.match(body, /if \(bridge\.keysGrantedFor && card\.slug\)/, 'the fallback is used only when the per-agent read is unavailable');
});

// P2 (2026-07-18 review): an ABSENT bridge method and a FAILED call are different
// facts. Collapsing both into granted=null made an IPC error render a saved key as
// "ready" and hide the grant button — the same dead end, reachable through a
// transient failure. Not a secret-access bypass (the local vault still denies an
// ungranted key), but the UI strands the user with no way forward.
test('KeyRow never renders "ready" when the per-agent check FAILED (vs. is absent)', () => {
  const body = componentBody('KeyRow');
  // The two cases must be tracked separately.
  assert.match(body, /const \[verifyFailed, setVerifyFailed\] = useState\(false\)/, 'a failed check needs its own state, distinct from granted=null');
  assert.match(body, /\.catch\(\(\) => \{ if \(alive\) \{ setGranted\(null\); setVerifyFailed\(true\); \} \}\)/,
    'a rejected keysGrantedFor must set verifyFailed, not silently look like a legacy desktop');
  // Absent method stays the legacy path — explicitly NOT a failure.
  assert.match(body, /if \(!bridge\?\.keysGrantedFor\) \{ setGranted\(null\); setVerifyFailed\(false\); return; \}/,
    'an absent method is a legitimate legacy fallback, not an error');
  // And readiness must exclude the unverified case.
  assert.match(body, /const ready = !!item\.configured && granted !== false && !verifyFailed;/,
    '"don\'t know" must never render as "ready"');
  // The user must be able to recover without a reload.
  assert.match(body, /onClick=\{checkGrant\}/, 'the unverified state needs a re-check affordance');
});

test('both components expire the wait instead of polling forever', () => {
  assert.match(src, /const KEY_WAIT_TIMEOUT_MS = 90 \* 1000;/, 'a shared, named timeout — not a magic number duplicated per component');
  for (const name of ['KeyRow', 'InlineAddKeyButton']) {
    const body = componentBody(name);
    assert.match(
      body,
      /setTimeout\(\(\) => \{ done = true; setAwaiting\(false\); \}, KEY_WAIT_TIMEOUT_MS\)/,
      `${name} must self-expire the awaiting state`,
    );
    assert.match(body, /clearTimeout\(expiry\)/, `${name} must clear its expiry timer on unmount (no leak, no setState after unmount)`);
  }
});
