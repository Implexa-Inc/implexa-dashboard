// node --test lib/run-recovery-parity.test.ts
//
// The recovery rule lives in TWO runtimes: the dashboard decides whether to SHOW
// the salvage affordance, the backend decides whether to HONOUR it.
//
// TWO LAYERS, AND ONLY ONE OF THEM ALWAYS RUNS — read this before trusting it:
//
//   1. CONTRACT (always runs, standalone). The rule is pinned to a VERSIONED
//      literal below. Editing lib/run-recovery.ts without editing the contract
//      fails, in any checkout, including dashboard-only CI.
//   2. CROSS-REPO (only when implexa-backend sits beside this repo). Compares the
//      same values against the backend source.
//
// Layer 2 SKIPS in standalone CI. The first version of this file skipped silently
// and still reported a pass, so it looked like enforced cross-repo parity and was
// not — the same silent-skip failure that let two whole test files go unrun
// earlier (see scripts/run-tests.mjs). Layer 1 exists so the skip costs coverage
// of "did the backend change too", not coverage of "did the rule change", and the
// skip now announces itself loudly instead of whispering.
//
// DIRECTION MATTERS in both layers: the mirror may only be optimistic-or-equal.
// Showing a button the server refuses costs a click; hiding one the server would
// have honoured strands the user in the exact dead end this feature removes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deriveRecoveredWork, RECOVERABLE_STATES } from './run-recovery.ts';

const BACKEND = join(
  import.meta.dirname, '..', '..', 'implexa-backend', 'src', 'lib', 'run-recovery.js',
);

function backendSrc(): string | null {
  try { return readFileSync(BACKEND, 'utf8'); } catch { return null; }
}

function literal(src: string, name: string): string {
  const m = src.match(new RegExp(`const ${name} = (/.*/[a-z]*);`));
  assert.ok(m, `${name} must still exist in the backend copy`);
  return m![1];
}

// ── Layer 1: THE CONTRACT ────────────────────────────────────────────────────
// Bump CONTRACT_VERSION whenever the rule intentionally changes, and update the
// backend in the same change. These literals are the agreement; the two runtimes
// are implementations of it.
const CONTRACT_VERSION = 1;
const CONTRACT = {
  terminal: "/\\b(verified|complete[d]?|finished|done|delivered|success(?:ful)?|passed|rendered|uploaded|published)\\b/i",
  progress: "/(\\b\\d{1,3}\\s*%|\\bremaining\\b|\\bin progress\\b|\\brunning\\b|\\betas?\\b|~\\s*\\d+\\s*min|\\bstep \\d+\\/\\d+:\\s*(?:encode|render|upload)\\w*\\s+(?:running|started))/i",
  states: ['stalled', 'failed'],
};

test('CONTRACT: the dashboard mirror matches the versioned rule (always runs)', () => {
  assert.equal(CONTRACT_VERSION, 1, 'bump this deliberately when the rule changes');
  const mirror = readFileSync(join(import.meta.dirname, 'run-recovery.ts'), 'utf8');
  assert.equal(literal(mirror, 'TERMINAL_MARKERS'), CONTRACT.terminal, 'TERMINAL_MARKERS drifted from the contract');
  assert.equal(literal(mirror, 'PROGRESS_MARKERS'), CONTRACT.progress, 'PROGRESS_MARKERS drifted from the contract');
  assert.deepEqual([...RECOVERABLE_STATES].sort(), [...CONTRACT.states].sort(), 'eligible states drifted from the contract');
  // Named so a future edit has to confront the reasoning, not just the diff.
  assert.ok(!RECOVERABLE_STATES.includes('running'), 'a live run must never be finalizable — it may still report');
  assert.ok(!RECOVERABLE_STATES.includes('completed'), 'a truthfully-closed run must never be re-finalized');
});

// ── Layer 2: CROSS-REPO (skips loudly when the backend is absent) ─────────────
test('the marker vocabularies are identical across the two runtimes', () => {
  const src = backendSrc();
  if (!src) { console.warn('\n  ⚠ SKIPPED (layer 2): implexa-backend is not checked out beside this repo, so cross-repo parity was NOT verified. The contract test above still ran.\n'); return; }

  const mirror = readFileSync(join(import.meta.dirname, 'run-recovery.ts'), 'utf8');
  for (const [be, fe] of [['_TERMINAL_MARKERS', 'TERMINAL_MARKERS'], ['_PROGRESS_MARKERS', 'PROGRESS_MARKERS']]) {
    assert.equal(literal(mirror, fe), literal(src, be), `${fe} has drifted from the backend's ${be}`);
  }
});

test('the eligible-state list is identical — the mirror must never be stricter', () => {
  const src = backendSrc();
  if (!src) { console.warn('  ⚠ SKIPPED (layer 2): backend absent — cross-repo state parity NOT verified.'); return; }
  // Backend expresses it inline in the guard.
  const m = src.match(/if \(!\[([^\]]*)\]\.includes\(runState\)\) return none\('not_recoverable_state'\)/);
  assert.ok(m, 'the backend state guard must still exist');
  const backendStates = m![1].split(',').map((s) => s.trim().replace(/'/g, '')).filter(Boolean);
  assert.deepEqual([...RECOVERABLE_STATES].sort(), backendStates.sort());
  // Named explicitly so a future edit has to confront the reasoning:
  assert.ok(!RECOVERABLE_STATES.includes('running'), 'a live run must never be finalizable — it may still report');
  assert.ok(!RECOVERABLE_STATES.includes('completed'), 'a truthfully-closed run must never be re-finalized');
});

// Behavioural parity on the cases that actually decide the UI.
test('the mirror agrees with the backend on the founder\'s real run', () => {
  const progress = {
    current: { at: '2026-07-18T21:17:07Z', note: 'VERIFIED: 650.60s → 624.60s, exactly 26.000s cut. Decode 0 errors.' },
    history: [
      { at: '2026-07-18T20:40:00Z', note: 'step 1/3: cutting 0:22–0:48 out' },
      { at: '2026-07-18T21:17:07Z', note: 'VERIFIED: 650.60s → 624.60s, exactly 26.000s cut. Decode 0 errors.' },
    ],
  };
  const ev = deriveRecoveredWork({ runState: 'stalled', outputMarkdown: null, progress });
  assert.equal(ev.recoverable, true);
  assert.equal(ev.looksComplete, true);
  assert.equal(ev.stepCount, 2, 'current duplicates the last history entry — counted once');
});

test('the mirror withholds the offer in exactly the cases the server refuses', () => {
  const progress = { history: [{ at: 'x', note: 'VERIFIED all done' }] };
  assert.equal(deriveRecoveredWork({ runState: 'running', progress }).recoverable, false, 'live run');
  assert.equal(deriveRecoveredWork({ runState: 'completed', progress }).recoverable, false, 'already closed');
  assert.equal(deriveRecoveredWork({ runState: 'stalled', outputMarkdown: '# real', progress }).recoverable, false, 'already reported');
  assert.equal(deriveRecoveredWork({ runState: 'stalled', progress: null }).recoverable, false, 'no evidence');
});

test('mid-flight text does not read as complete, in the mirror too', () => {
  const ev = deriveRecoveredWork({
    runState: 'stalled',
    progress: { history: [{ at: 'x', note: 'step 2/3: encode ~55% done (3:24/~10:24), ~2 min remaining' }] },
  });
  assert.equal(ev.recoverable, true, 'still offered — the user decides');
  assert.equal(ev.looksComplete, false, 'but the copy must not claim it finished');
});
