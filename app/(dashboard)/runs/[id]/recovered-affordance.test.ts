// node --test "app/(dashboard)/runs/[id]/recovered-affordance.test.ts"

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const page = readFileSync(join(import.meta.dirname, 'page.tsx'), 'utf8');

test('the recovered-elsewhere check queries run_recovery_attempts scoped to THIS run and status=recovered', () => {
  const i = page.indexOf('alreadyRecoveredElsewhere');
  const block = page.slice(i, i + 700);
  assert.match(block, /from\('run_recovery_attempts'\)/, 'must read the recovery ledger');
  assert.match(block, /\.eq\('target_run_id', params\.id\)/, 'scoped to the run on the page, not any run');
  assert.match(block, /\.eq\('status', 'recovered'\)/, 'only a SUCCEEDED recovery counts — a failed/needs_human attempt must not hide the affordance');
});

test('THE CROSS-FEATURE FIX: when already recovered elsewhere, deriveRecoveredWork is never even consulted', () => {
  assert.match(page, /const recovered = alreadyRecoveredElsewhere\s*\n\s*\? \{ recoverable: false,/,
    'a run already recovered by a continuation must short-circuit to non-recoverable, not fall through to the trace-based derivation');
});

test('the finalize card renders ONLY when recoverable, and never claims delivery', () => {
  const i = page.indexOf('recovered.recoverable && (');
  assert.notEqual(i, -1);
  const block = page.slice(i, i + 900);
  assert.match(block, /Work recovered — review and finalize/);
  assert.match(block, /<FinalizeRecoveredButton runId=\{r\.id\} looksComplete=\{recovered\.looksComplete\} \/>/);
});

test('the button is imported from the shared component, not re-implemented inline on the page', () => {
  assert.match(page, /import \{ FinalizeRecoveredButton \} from '\.\.\/\.\.\/_components\/finalize-recovered-button'/);
});
