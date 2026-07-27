// node --test "app/(dashboard)/_components/setup-choice-field.test.ts"
//
// THE BUG (founder, 2026-07-24): the Setup card offered an "Other (type your
// own)" answer; the pre-Run dialog rendered ONLY the canned options. A saved
// custom answer therefore matched no <option> in the pre-Run dialog, showed
// blank, and on Run got POSTed back over the real answer — silently swapping the
// user's careful instruction (e.g. "keep the pacing, only cut what's unusable")
// for a canned one. Not a missing option: DATA LOSS.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = import.meta.dirname;
const field = readFileSync(join(dir, 'setup-choice-field.tsx'), 'utf8');
const setupCard = readFileSync(join(dir, 'agent-setup-card.tsx'), 'utf8');
const preRun = readFileSync(join(dir, 'agent-actions.tsx'), 'utf8');

const codeOnly = (s: string) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

test('BOTH surfaces render the SAME control — divergence was the bug', () => {
  assert.match(setupCard, /<SetupChoiceField/, 'the Setup card uses the shared field');
  assert.match(preRun, /<SetupChoiceField/, 'the pre-Run dialog uses the shared field');
  // Neither may keep a hand-rolled choice <select> that lacks Other.
  assert.doesNotMatch(codeOnly(setupCard), /<select/, 'the Setup card must not keep its own choice select');
  assert.doesNotMatch(codeOnly(preRun), /f\.options\.map\(\(o\) => <option/,
    'the pre-Run dialog must not keep its own bare option list (the one that dropped Other)');
});

test('the shared field always OFFERS Other', () => {
  assert.match(field, /Other \(type your own\)/, 'the Other option must exist for every choice question');
  assert.match(field, /value=\{OTHER\}/, 'and be selectable');
});

test('a saved custom value OPENS in Other mode — it is never discarded', () => {
  // The crux: a non-empty value that is not among the options IS an Other answer.
  // Deriving this (not trusting a flag) is what makes it survive a remount in a
  // DIFFERENT surface — which is exactly where the old dialog lost it.
  assert.match(field, /const derivedOther = !!value && !options\.includes\(value\)/,
    'Other mode is derived from the value, so a saved custom answer shows instead of blanking');
  assert.match(field, /const isOther = manualOther \|\| derivedOther/);
});

test('switching INTO Other keeps an existing custom answer, only clears from a canned option', () => {
  assert.match(field, /if \(!derivedOther\) onChange\(''\)/,
    're-selecting Other must not wipe a custom answer that is already there');
});

test('the pre-Run dialog no longer overwrites a saved answer with a blank canned value', () => {
  // The dialog still POSTs setupValues on Run (that is intended — you can change
  // an answer there). The fix is that setupValues now HOLDS the custom answer via
  // the shared field, so the POST re-saves the real value, not a dropped one.
  assert.match(preRun, /body: \{ answers: \{ \.\.\.setupValues, __agent_note: standingNote\.trim\(\) \}, source \}/,
    'the write-back still spreads setupValues (now alongside the standing note)');
  assert.match(preRun, /onChange=\{\(next\) => setSetupValues\(\(v\) => \(\{ \.\.\.v, \[f\.key\]: next \}\)\)\}/,
    'and setupValues is fed by the shared field, so it carries the custom answer instead of losing it');
});
