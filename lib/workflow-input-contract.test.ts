import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptsDirectorySnapshot, bindInputValue, describeInputPickerError, missingRequiredInputs, orderedInputFields, resolvePickerResult, serializeArtifactBindings, type WorkflowInputContract, type WorkflowInputField } from './workflow-input-contract.ts';

const contract: WorkflowInputContract = { version: 1, fields: [
  { key: 'inspiration_video', label: 'Inspiration video', description: 'Optional reference.', kind: 'file', required: false, cardinality: 'one', order: 2 },
  { key: 'target_video', label: 'Target video', description: 'Video to process.', kind: 'file', required: true, cardinality: 'one', order: 1 },
] };

test('run form order comes from persisted contract order, not object/upload order', () => {
  assert.deepEqual(orderedInputFields(contract).map((f) => f.key), ['target_video', 'inspiration_video']);
});

test('only required inputs block submission', () => {
  assert.deepEqual(missingRequiredInputs(contract, {}).map((f) => f.key), ['target_video']);
  assert.deepEqual(missingRequiredInputs(contract, { target_video: { artifactId: 'a', sha256: 'b', displayName: 'target.mp4' } }), []);
});

test('submission strips display names and preserves semantic keys', () => {
  const serialized = serializeArtifactBindings({
    inspiration_video: { artifactId: 'inspiration', sha256: '2', displayName: 'first-upload.mov' },
    target_video: { artifactId: 'target', sha256: '1', displayName: 'second-upload.mp4' },
  });
  assert.deepEqual(serialized, {
    inspiration_video: { artifactId: 'inspiration', sha256: '2' },
    target_video: { artifactId: 'target', sha256: '1' },
  });
});

test('folder snapshots are offered only by an explicit ZIP-capable file contract', () => {
  assert.equal(acceptsDirectorySnapshot({ ...contract.fields[0], accept: { mediaTypes: [], extensions: ['.zip'] } }), true);
  assert.equal(acceptsDirectorySnapshot({ ...contract.fields[0], accept: { mediaTypes: [], extensions: ['.mp4'] } }), false);
  assert.equal(acceptsDirectorySnapshot({ ...contract.fields[0], kind: 'text', accept: { mediaTypes: [], extensions: ['.zip'] } }), false);
});

// ── The Run Inputs picker boundary ──────────────────────────────────────────
// The 2026-08-05 regression: opening youtube-remotion-overlay-animator, clicking
// "Choose file" for the required `instructions_md`, and selecting a valid .md
// left the button reading "Choose file" with Run still disabled and no reason
// shown. Desktop refused the file (`incompatible_file_type`) and the dashboard
// dropped that refusal on the floor.
//
// Every `PickRunInputResult` below is a shape Desktop actually returns —
// see implexa-desktop src/execution/run-input-materializer.js (registerRunInput,
// pickAndRegisterRunInput) and src/main.js (the files:pickRunInput handler).
// scripts/acceptance-run-input-picker-cross-repo.mjs drives the real Desktop
// module into these same functions so the fixtures cannot drift.

const instructionsMd: WorkflowInputField = {
  key: 'instructions_md',
  label: 'Fresh Markdown animation brief for this run',
  description: 'Select the fresh Markdown animation brief bound to this run; it may not be replaced by a prior-run file.',
  kind: 'file',
  required: true,
  accept: { mediaTypes: ['text/markdown', 'text/plain'], extensions: ['.md'] },
  cardinality: 'one',
  order: 1,
};
const youtubeUrl: WorkflowInputField = {
  key: 'youtube_url',
  label: 'Fresh target video URL or explicit local path',
  description: 'Provide the target video selected for this run as a URL or explicit local path; never replace it with prior-run media.',
  kind: 'text',
  required: true,
  cardinality: 'one',
  order: 2,
};
const remotionProjectPath: WorkflowInputField = {
  key: 'remotion_project_path',
  label: 'Local Remotion project to edit or create',
  description: 'Which local Remotion project should be edited or created?',
  kind: 'text',
  required: false,
  cardinality: 'one',
  order: 4,
};
const overlayContract: WorkflowInputContract = {
  version: 1,
  fields: [instructionsMd, youtubeUrl, remotionProjectPath],
};
const BRIEF_SHA = 'c'.repeat(64);
// Desktop's success return for a picked "Fresh Animation Brief.md".
const registeredBrief = {
  ok: true,
  inputSessionId: '30000000-0000-4000-8000-000000000003',
  artifactId: '10000000-0000-4000-8000-000000000001',
  sha256: BRIEF_SHA,
  displayName: 'Fresh Animation Brief.md',
  mediaType: 'text/markdown',
};

test('directory snapshot failures are actionable rather than swallowed', () => {
  const zipField: WorkflowInputField = { ...instructionsMd, label: 'Project bundle', accept: { mediaTypes: [], extensions: ['.zip'] } };
  assert.match(describeInputPickerError('directory_changed_while_snapshotting', zipField), /changed/);
  assert.match(describeInputPickerError('directory_contains_symlink', zipField), /symlink/);
  assert.match(describeInputPickerError('directory_snapshot_failed', zipField), /verified ZIP/);
});

test('a registered markdown brief binds to instructions_md and shows its filename', () => {
  const outcome = resolvePickerResult(registeredBrief, instructionsMd);
  assert.equal(outcome.kind, 'bound');
  if (outcome.kind !== 'bound') return;
  assert.equal(outcome.binding.displayName, 'Fresh Animation Brief.md', 'the UI has a filename to show');
  assert.equal(outcome.binding.sha256, BRIEF_SHA, 'the Desktop-verified digest is what gets bound');
  assert.equal(outcome.inputSessionId, registeredBrief.inputSessionId);
  const bindings = bindInputValue({}, instructionsMd, outcome.binding);
  assert.deepEqual(Object.keys(bindings), ['instructions_md'], 'bound to its named key, not upload order');
  assert.deepEqual(missingRequiredInputs(overlayContract, bindings), [youtubeUrl],
    'the brief satisfies its own required field and nothing else');
});

test('a filename with spaces survives to the UI and over the wire', () => {
  const outcome = resolvePickerResult(
    { ...registeredBrief, displayName: 'Fresh Animation Brief Aug 5.md' }, instructionsMd);
  assert.equal(outcome.kind, 'bound');
  if (outcome.kind !== 'bound') return;
  assert.equal(outcome.binding.displayName, 'Fresh Animation Brief Aug 5.md');
  const serialized = serializeArtifactBindings(bindInputValue({}, instructionsMd, outcome.binding));
  assert.deepEqual(serialized, { instructions_md: { artifactId: registeredBrief.artifactId, sha256: BRIEF_SHA } });
});

test('cancelling changes nothing and shows no error', () => {
  // Current Desktop.
  assert.deepEqual(resolvePickerResult({ ok: false, canceled: true }, instructionsMd), { kind: 'canceled' });
  // Desktop 0.3.3 and earlier: a bare { ok:false } with no code IS a cancel.
  assert.deepEqual(resolvePickerResult({ ok: false }, instructionsMd), { kind: 'canceled' });
});

test('cancelling after a file is chosen keeps the file bound', () => {
  const bound = resolvePickerResult(registeredBrief, instructionsMd);
  assert.equal(bound.kind, 'bound');
  if (bound.kind !== 'bound') return;
  const bindings = bindInputValue({}, instructionsMd, bound.binding);
  const after = resolvePickerResult({ ok: false, canceled: true }, instructionsMd);
  assert.equal(after.kind, 'canceled', 'a cancel is not a removal');
  assert.deepEqual(missingRequiredInputs(overlayContract, bindings), [youtubeUrl]);
});

test('every registration failure produces a visible, actionable message', () => {
  // Exactly the codes Desktop can return, from run-input-materializer.js + main.js.
  const codes = [
    'incompatible_file_type', 'not_linked', 'forbidden', 'registration_unavailable',
    'registration_rejected', 'registration_identity_mismatch', 'source_changed_while_hashing',
    'not_a_regular_file', 'invalid_input_registration', 'input_registration_failed',
    'source_read_short', 'EACCES: permission denied, open',
  ];
  for (const code of codes) {
    const outcome = resolvePickerResult({ ok: false, error: code }, instructionsMd);
    assert.equal(outcome.kind, 'failed', `${code} must not be swallowed`);
    if (outcome.kind !== 'failed') continue;
    assert.ok(outcome.message.length > 20, `${code} needs a real message, got "${outcome.message}"`);
  }
  // The one the user actually hit names the file type it wants.
  const refused = resolvePickerResult({ ok: false, error: 'incompatible_file_type' }, instructionsMd);
  assert.equal(refused.kind, 'failed');
  if (refused.kind === 'failed') assert.match(refused.message, /\.md/, 'it says which extension is accepted');
});

test('a success that cannot be bound is reported as a failure, not silence', () => {
  const partials = [
    { ...registeredBrief, sha256: undefined },
    { ...registeredBrief, artifactId: undefined },
    { ...registeredBrief, displayName: undefined },
    { ...registeredBrief, inputSessionId: undefined },
  ];
  for (const partial of partials) {
    const outcome = resolvePickerResult(partial, instructionsMd);
    assert.equal(outcome.kind, 'failed', 'an unbindable success must surface, not vanish');
  }
  // A bridge that throws is handled the same way by the caller's catch.
  assert.equal(resolvePickerResult(null, instructionsMd).kind, 'canceled');
});

test('a failed pick leaves the required field unsatisfied, so Run stays disabled', () => {
  const outcome = resolvePickerResult({ ok: false, error: 'incompatible_file_type' }, instructionsMd);
  assert.equal(outcome.kind, 'failed');
  const stillMissing = missingRequiredInputs(overlayContract, { youtube_url: 'https://youtu.be/abc' });
  assert.deepEqual(stillMissing.map((f) => f.key), ['instructions_md']);
});

test('replacing a chosen brief swaps the binding rather than accumulating', () => {
  const first = resolvePickerResult(registeredBrief, instructionsMd);
  assert.equal(first.kind, 'bound');
  if (first.kind !== 'bound') return;
  let bindings = bindInputValue({}, instructionsMd, first.binding);
  const second = resolvePickerResult({
    ...registeredBrief,
    artifactId: '10000000-0000-4000-8000-00000000000b',
    sha256: 'd'.repeat(64),
    displayName: 'Brief Two.md',
  }, instructionsMd);
  assert.equal(second.kind, 'bound');
  if (second.kind !== 'bound') return;
  bindings = bindInputValue(bindings, instructionsMd, second.binding);
  assert.deepEqual(bindings.instructions_md, second.binding, 'a cardinality-one field replaces');
  assert.equal(Array.isArray(bindings.instructions_md), false);
  assert.deepEqual(serializeArtifactBindings(bindings), {
    instructions_md: { artifactId: '10000000-0000-4000-8000-00000000000b', sha256: 'd'.repeat(64) },
  });
});

test('a brief bound to the wrong field key cannot satisfy the required one', () => {
  const outcome = resolvePickerResult(registeredBrief, instructionsMd);
  assert.equal(outcome.kind, 'bound');
  if (outcome.kind !== 'bound') return;
  // Same artifact, stored under the optional Remotion-project key.
  const misbound = bindInputValue({}, remotionProjectPath, outcome.binding);
  assert.deepEqual(missingRequiredInputs(overlayContract, misbound).map((f) => f.key),
    ['instructions_md', 'youtube_url'], 'an optional field cannot stand in for a required one');
});

test('a many-cardinality field appends under its key instead of overwriting', () => {
  const many: WorkflowInputField = { ...instructionsMd, key: 'reference_docs', cardinality: 'many', required: false };
  const a = resolvePickerResult(registeredBrief, many);
  const b = resolvePickerResult({ ...registeredBrief, artifactId: 'second', sha256: 'e'.repeat(64), displayName: 'Two.md' }, many);
  assert.equal(a.kind, 'bound');
  assert.equal(b.kind, 'bound');
  if (a.kind !== 'bound' || b.kind !== 'bound') return;
  const bindings = bindInputValue(bindInputValue({}, many, a.binding), many, b.binding);
  assert.equal((bindings.reference_docs as unknown[]).length, 2);
  assert.deepEqual(Object.keys(bindings), ['reference_docs'], 'still one key, never positional');
});

test('a required text input is not satisfied by blank or whitespace', () => {
  // `youtube_url` is a required TEXT field: the target video as a URL or an
  // explicit local path. An empty box, or one holding only spaces, must keep
  // Run disabled rather than sending a run with no target.
  for (const value of ['', '   ', '\t\n']) {
    assert.deepEqual(
      missingRequiredInputs(overlayContract, { instructions_md: registeredBrief as never, youtube_url: value }).map((f) => f.key),
      ['youtube_url'],
      `"${value.replace(/\s/g, '·')}" must not satisfy a required text input`,
    );
  }
  assert.deepEqual(
    missingRequiredInputs(overlayContract, { instructions_md: registeredBrief as never, youtube_url: 'https://youtu.be/abc' }),
    [],
    'a real value does satisfy it',
  );
});

test('a required many-cardinality input is not satisfied by an empty list', () => {
  const manyContract: WorkflowInputContract = {
    version: 1,
    fields: [{ ...instructionsMd, key: 'reference_docs', cardinality: 'many', required: true, order: 1 }],
  };
  assert.deepEqual(missingRequiredInputs(manyContract, { reference_docs: [] }).map((f) => f.key), ['reference_docs'],
    'an empty list is no file at all');
  const bound = resolvePickerResult(registeredBrief, manyContract.fields[0]);
  assert.equal(bound.kind, 'bound');
  if (bound.kind !== 'bound') return;
  assert.deepEqual(missingRequiredInputs(manyContract, bindInputValue({}, manyContract.fields[0], bound.binding)), []);
});

test('a refusal names both restrictions when the field declares both', () => {
  // An accept block is an intersection. Naming only the extension would tell a
  // user whose correctly-suffixed file was refused to pick the same thing again.
  const both = resolvePickerResult({ ok: false, error: 'incompatible_file_type' }, instructionsMd);
  assert.equal(both.kind, 'failed');
  if (both.kind !== 'failed') return;
  assert.match(both.message, /\.md/, 'names the extension');
  assert.match(both.message, /text\/markdown/, 'and the media type');
  assert.match(both.message, /only one of the two/, 'and says why matching one was not enough');

  const extensionOnly = resolvePickerResult({ ok: false, error: 'incompatible_file_type' },
    { ...instructionsMd, accept: { extensions: ['.md'], mediaTypes: [] } });
  assert.equal(extensionOnly.kind, 'failed');
  if (extensionOnly.kind === 'failed') {
    assert.match(extensionOnly.message, /Choose a \.md file/);
    assert.doesNotMatch(extensionOnly.message, /only one of the two/, 'no intersection to explain');
  }

  const mediaOnly = resolvePickerResult({ ok: false, error: 'incompatible_file_type' },
    { ...instructionsMd, accept: { extensions: [], mediaTypes: ['text/markdown'] } });
  assert.equal(mediaOnly.kind, 'failed');
  if (mediaOnly.kind === 'failed') assert.match(mediaOnly.message, /accepts text\/markdown/);

  const unrestricted = resolvePickerResult({ ok: false, error: 'incompatible_file_type' },
    { ...instructionsMd, accept: { extensions: [], mediaTypes: [] } });
  assert.equal(unrestricted.kind, 'failed', 'still reported, just without a type hint');
});
