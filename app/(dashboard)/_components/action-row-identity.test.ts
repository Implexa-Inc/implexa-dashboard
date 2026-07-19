// node --test "app/(dashboard)/_components/action-row-identity.test.ts"
//
// REGRESSION GUARD for the mirrored-typing bug.
//
// ActionRow was declared INSIDE RunActionItems, so it received a new function
// identity on every parent render. Each keystroke in the note textarea
// (setNotes → re-render) remounted the whole row, and autoFocus reset the caret
// to position 0 — so every character landed at the front and typed text came out
// backwards: "add a web search" → "hcraes sbew a dda". The founder hit it live.
//
// This is invisible in review (the JSX looks identical either way) and invisible
// to typecheck, so it needs a structural guard.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(import.meta.dirname, 'run-action-items.tsx'), 'utf8');

test('ActionRow is declared at MODULE level, never inside the parent component', () => {
  const rowIdx = src.indexOf('function ActionRow(');
  assert.notEqual(rowIdx, -1, 'ActionRow must still exist');
  // Module level = column 0. A nested declaration is indented.
  const lineStart = src.lastIndexOf('\n', rowIdx) + 1;
  assert.equal(src.slice(lineStart, rowIdx), '',
    'ActionRow must be top-level — nesting it remounts the textarea on every keystroke and reverses typed text');

  // And it must not be re-created inside the parent by any other means.
  const parentIdx = src.indexOf('export default function RunActionItems');
  assert.notEqual(parentIdx, -1);
  assert.ok(rowIdx < parentIdx,
    'ActionRow must be defined BEFORE (outside) RunActionItems, not within its body');
});

test('the note textarea is controlled from state that survives re-render', () => {
  // The caret bug only bites because the field autoFocuses on mount; if the row
  // ever remounts per keystroke again this is what makes it visible.
  assert.match(src, /autoFocus/, 'the textarea still autofocuses — which is why remounting is destructive');
});
