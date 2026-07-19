// node --test "app/(dashboard)/runs/[id]/recovered-affordance.test.ts"
//
// Source guard for the salvage affordance on the run detail page. page.tsx is a
// server component with JSX, so it can't be imported under node --test — this
// repo's established answer is to assert on its source (see
// continue-affordance.test.ts, which also warns: anchor on the RENDER FORM, never
// a bare tag name, because prose comments match first).
//
// What must not regress:
//   1. The affordance is gated on the shared predicate, not a hand-rolled check.
//   2. It renders INSIDE the stalled/failed banner — the place the user is
//      actually stuck, next to the trace that is the evidence.
//   3. It never claims completion on the user's behalf.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const page = readFileSync(join(import.meta.dirname, 'page.tsx'), 'utf8');

test('the page derives recoverability from the SHARED predicate', () => {
  assert.match(page, /import \{ deriveRecoveredWork \} from '@\/lib\/run-recovery'/,
    'must use the mirrored rule that run-recovery-parity.test.ts pins to the backend');
  assert.match(page, /const recovered = deriveRecoveredWork\(\{/, 'the page must derive, not hand-roll');
  // It must feed the predicate the REAL row fields; passing a subset silently
  // changes the answer (e.g. omitting outputMarkdown would offer to overwrite a
  // real deliverable).
  for (const field of ['runState: r.run_state', 'outputMarkdown: r.output_markdown', 'progress', 'stepsState']) {
    assert.ok(page.includes(field), `the predicate must receive ${field}`);
  }
});

test('the button renders inside the stalled banner, gated on recoverable', () => {
  const idx = page.indexOf('<FinalizeRecoveredButton runId=');
  assert.notEqual(idx, -1, 'the salvage button must still be rendered (anchored on its render form, not the bare name)');

  const before = page.slice(Math.max(0, idx - 1200), idx);
  assert.match(before, /\{recovered\.recoverable && \(/, 'the block must be gated on the predicate');
  assert.match(before, /Work recovered — review and finalize/, 'the founder-facing heading must be present');

  // It belongs in the amber "this run stalled" block — that is where the user is
  // stranded. Rendering it elsewhere on the page recreates the dead end.
  const banner = page.indexOf('This run stalled');
  assert.notEqual(banner, -1);
  assert.ok(banner < idx, 'the affordance must sit inside/after the stalled banner, not above it');
  const buttonRow = page.indexOf('<div className="mt-4 flex flex-wrap gap-3">', banner);
  assert.ok(idx < buttonRow, 'it must appear before the Run again / Back to home row, not buried after it');
});

test('the affordance passes the honesty signal through instead of asserting completion', () => {
  assert.match(page, /<FinalizeRecoveredButton runId=\{r\.id\} looksComplete=\{recovered\.looksComplete\} \/>/,
    'looksComplete must reach the button so it can hedge its copy when the trace is not clearly finished');
  // The page must not phrase the offer as a statement of fact.
  const idx = page.indexOf('<FinalizeRecoveredButton runId=');
  const block = page.slice(Math.max(0, idx - 1200), idx);
  assert.match(block, /If the trace above shows the work finished, you can mark it done/,
    'the copy must condition on the user reading the trace — we do not know the run finished');
});
