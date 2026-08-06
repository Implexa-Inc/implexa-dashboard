import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Wiring guards for the Run Inputs picker inside the pre-run modal (the
// setup-tiers.test.ts idiom): agent-actions.tsx is a React component that cannot
// be rendered under node:test, so these assert the SOURCE wiring that
// lib/workflow-input-contract's own behavioural tests cannot see — that the
// decision logic is actually reached, that a failure is actually shown, and that
// a cancel actually leaves the binding alone.
//
// The 2026-08-05 regression was a silent `return` on every non-success. These
// guards exist so it cannot come back.

const src = readFileSync(new URL('./agent-actions.tsx', import.meta.url), 'utf8');

test('the picker result is routed through the tested resolver, not re-decided inline', () => {
  assert.match(src, /resolvePickerResult/, 'the component imports and uses the resolver');
  assert.match(src, /const outcome = resolvePickerResult\(result, field\);/);
  assert.match(src, /bindInputValue\(previous, field, outcome\.binding\)/,
    'binding goes through the keyed helper, so a file can never be stored positionally');
  assert.doesNotMatch(src, /if \(!result\?\.ok \|\| !result\.artifactId/,
    'the old silent-drop guard must not return');
});

test('a cancel is a no-op and a failure is surfaced', () => {
  assert.match(src, /if \(outcome\.kind === 'canceled'\) return;/,
    'a cancel changes nothing — the current binding survives');
  assert.match(src, /if \(outcome\.kind === 'failed'\) \{ setInputError\(field\.key, outcome\.message\); return; \}/,
    'a failure is recorded against the field the user was filling in');
});

test('the error is actually rendered next to its field', () => {
  assert.match(src, /\{inputErrors\[field\.key\] && \(/, 'the message renders per field');
  assert.match(src, /role="alert"/, 'and is announced, not just coloured');
  assert.match(src, /setInputError\(field\.key, null\);\s*\n\s*const result = await bridge\.pickRunInput\(/,
    'a fresh attempt clears the previous error before it starts');
});

test('a bound file shows its filename and that it is verified and keyed', () => {
  assert.match(src, /\{item\.displayName\}/, 'the filename is shown');
  assert.match(src, /verified, bound to \{field\.key\}/,
    'the bound state names the contract key, so upload order is visibly irrelevant');
  assert.match(src, /\{field\.cardinality === 'many' \? 'Add file' : artifacts\.length \? 'Replace' : 'Choose file'\}/,
    'the button reads Replace once a file is bound, never still Choose file — including a file bound from the saved setup, which arrives as a default rather than through the picker');
});

test('removing a file clears its error and takes the value out of THIS run', () => {
  // A removal writes an override, not a mutation of the saved answer: the file
  // leaves this run and stays saved for the next one. It must still clear the
  // field's error, or a stale failure message outlives the value it described.
  assert.match(src, /setInputError\(field\.key, null\);\s*\n\s*\/\/[^\n]*\n\s*\/\/[^\n]*\n\s*if \(field\.cardinality === 'many'\) \{/,
    'a removal must not leave a stale failure message behind');
  assert.doesNotMatch(src, /setInputDefaults\(\(previous\) => \{[\s\S]{0,200}?delete next\[field\.key\]/,
    'removing a file for one run must never delete what Setup saved');
});

test('required typed inputs still gate the Run button', () => {
  assert.match(src, /disabled=\{setupSaving \|\| blankRequired\.length > 0 \|\| missingRequiredInputs\(inputContract, inputBindings\)\.length > 0\}/);
  assert.match(src, /if \(blankRequired\.length \|\| missingRequiredInputs\(inputContract, inputBindings\)\.length\) return;/);
});

test('only digest identity crosses the wire — never a local path', () => {
  assert.match(src, /inputBindings: serializeArtifactBindings\(inputBindings\)/,
    'the run-create payload is the stripped serialization, not raw component state');
});
