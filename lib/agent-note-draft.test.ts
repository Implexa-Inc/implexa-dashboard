// node --test lib/agent-note-draft.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setAgentNoteDraft, getAgentNoteDraft, clearAgentNoteDraft } from './agent-note-draft.ts';

test('the draft store carries a note per slug and clears cleanly', () => {
  assert.equal(getAgentNoteDraft('a'), undefined, 'unset slug → undefined (distinct from a saved empty note)');
  setAgentNoteDraft('a', 'hello');
  setAgentNoteDraft('b', 'world');
  assert.equal(getAgentNoteDraft('a'), 'hello');
  assert.equal(getAgentNoteDraft('b'), 'world');
  // an empty string is a REAL value (the user cleared their note) — not undefined
  setAgentNoteDraft('a', '');
  assert.equal(getAgentNoteDraft('a'), '');
  clearAgentNoteDraft('a');
  assert.equal(getAgentNoteDraft('a'), undefined);
  assert.equal(getAgentNoteDraft('b'), 'world', 'clearing one slug leaves others');
});

test('a falsy slug is a no-op, never a crash', () => {
  setAgentNoteDraft('', 'x');
  assert.equal(getAgentNoteDraft(''), undefined);
});

// ── wiring guards: the standing note must be carried + saved, and the one-off
//    note must stay a separate channel (the two-concepts split is LOCKED). ─────

test('the Setup card mirrors its note into the shared draft on every edit', () => {
  const src = readFileSync(join(process.cwd(), 'app', '(dashboard)', '_components', 'agent-setup-card.tsx'), 'utf8');
  assert.match(src, /setNoteValue\(e\.target\.value\); setAgentNoteDraft\(slug, e\.target\.value\)/,
    'typing in the Setup note must update the draft, so an unsaved edit reaches the pop-up');
});

test('the Run-now pop-up seeds the standing note from the draft, falling back to the saved note', () => {
  const src = readFileSync(join(process.cwd(), 'app', '(dashboard)', '_components', 'agent-actions.tsx'), 'utf8');
  assert.match(src, /const draft = getAgentNoteDraft\(slug\)/, 'must read the draft');
  assert.match(src, /setStandingNote\(draft !== undefined \? draft : note\)/,
    'a live unsaved draft wins; else the saved note (undefined draft, NOT falsy — an empty draft is a real cleared note)');
});

test('submit saves the standing note via __agent_note and clears the draft — one-off note never touches it', () => {
  const src = readFileSync(join(process.cwd(), 'app', '(dashboard)', '_components', 'agent-actions.tsx'), 'utf8');
  const fn = src.slice(src.indexOf('async function submitPreRun'), src.indexOf('async function doQueue'));
  assert.ok(fn.length > 0, 'submitPreRun must exist');
  assert.match(fn, /__agent_note: standingNote\.trim\(\)/, 'the standing note is what gets saved');
  assert.match(fn, /clearAgentNoteDraft\(slug\)/, 'the draft is dropped once persisted');
  // The one-off per-run note must NOT be written to the standing note.
  assert.doesNotMatch(fn, /__agent_note: (perRunNote|runNote)/,
    'the one-off note must never be written to the standing note (two-concepts split)');
});
