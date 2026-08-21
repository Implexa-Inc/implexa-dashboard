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
  assert.match(src, /const outcome = resolvePickerResult\(result, field, selection\);/);
  assert.match(src, /bindInputValue\(previous, field, outcome\.binding\)/,
    'binding goes through the keyed helper, so a file can never be stored positionally');
  assert.doesNotMatch(src, /if \(!result\?\.ok \|\| !result\.artifactId/,
    'the old silent-drop guard must not return');
});

test('a cancel is a no-op and a failure is surfaced', () => {
  assert.match(src, /if \(outcome\.kind === 'canceled'\) \{[\s\S]*?verifySavedFileInputs\(\[field\], sessionId\);[\s\S]*?return;[\s\S]*?\}/,
    'a cancel leaves the current binding intact and restores verification of an untouched saved default');
  assert.match(src, /if \(outcome\.kind === 'failed'\) \{ setInputError\(field\.key, outcome\.message\); return; \}/,
    'a failure is recorded against the field the user was filling in');
});

test('the error is actually rendered next to its field', () => {
  assert.match(src, /\{inputErrors\[field\.key\] && \(/, 'the message renders per field');
  assert.match(src, /role="alert"/, 'and is announced, not just coloured');
  assert.match(src, /setInputError\(field\.key, null\);[\s\S]*?const sessionId = inputSessionRef\.current \|\| crypto\.randomUUID\(\);[\s\S]*?const result = await bridge\.pickRunInput\(/,
    'a fresh attempt clears the previous error before it freezes the session and starts');
});

test('a bound file shows its filename and that it is verified and keyed', () => {
  assert.match(src, /\{item\.displayName\}/, 'the filename is shown');
  assert.match(src, /verified, bound to \{field\.key\}/,
    'the bound state names the contract key, so upload order is visibly irrelevant');
  assert.match(src, /field\.cardinality === 'many' \? 'Add file' : \(artifacts\.length \|\| deferred\) \? 'Replace file' : 'Choose file'/,
    'the button reads Replace once a file is bound, never still Choose file — including a file bound from the saved setup, which arrives as a default rather than through the picker');
});

test('declared folder-capable fields expose a distinct folder snapshot choice', () => {
  assert.match(src, /async function chooseTypedInput\(field: WorkflowInputField, selection: 'file' \| 'directory' = 'file'\)/);
  assert.match(src, /selection,/,
    'the requested picker kind must cross the Desktop bridge boundary');
  assert.match(src, /acceptsDirectorySnapshot\(field\)[\s\S]*?chooseTypedInput\(field, 'directory'\)[\s\S]*?Choose folder/,
    'folder selection is gated on the explicit capability rather than ZIP acceptance or suggestive prose');
});

test('the Run Inputs modal and cards leave room for long contract copy', () => {
  assert.match(src, /open=\{showSetupModal\}[\s\S]*?maxWidth="max-w-2xl"/,
    'typed run inputs use the wider modal instead of squeezing long labels into max-w-md');
  assert.match(src, /<p className="text-xs text-ink-400 mt-1 leading-relaxed">\{field\.description\}<\/p>[\s\S]*?mt-3 flex flex-wrap items-center gap-2/,
    'file and folder actions render after the full-width description and wrap when needed');
  assert.doesNotMatch(src, /flex items-start justify-between gap-3[\s\S]{0,1800}?Choose folder/,
    'the action buttons must not reserve half the card width beside long contract copy');
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
  assert.match(src, /disabled=\{setupSaving \|\| Object\.keys\(preparingInputs\)\.length > 0 \|\| blankRequired\.length > 0 \|\| missingRequiredForRun\(\)\.length > 0\}/);
  assert.match(src, /if \(blankRequired\.length \|\| missingRequiredForRun\(\)\.length[\s\S]*?\|\| Object\.keys\(preparingInputRef\.current\)\.length\) return;/,
    'the synchronous submit boundary must refuse while a folder snapshot is still being prepared');
});

test('only digest identity crosses the wire — never a local path', () => {
  assert.match(src, /inputBindings: serializeArtifactBindings\(inputBindings\)/,
    'the run-create payload is the stripped serialization, not raw component state');
  assert.match(src, /deferredInputManifest:[\s\S]*selectionId: value\.selectionId[\s\S]*sizeBytes: value\.sizeBytes/,
    'a selected large file crosses only as opaque identity and bounded metadata before hashing');
  assert.doesNotMatch(src, /deferredInputManifest:[\s\S]{0,400}(?:path|sha256):/,
    'the deferred manifest cannot carry a local path or invent a digest before reading bytes');
});

test('background selection is fail-closed to cardinality one', () => {
  assert.match(src, /selection === 'file' && field\.cardinality === 'one' && bridge\.pickDeferredRunInput/,
    'v1 must not turn a many-file contract into a replacing scalar selection');
  assert.match(src, /field\.cardinality === 'many' \? 'Add file'/,
    'many-file fields retain the existing append/register picker');
});
