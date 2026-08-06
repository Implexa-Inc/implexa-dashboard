// node --test lib/run-now-saved-input-hydration.test.ts
//
// THE BUG THIS PINS. "Visual Treatment Planner — Runway + Remotion" declares
// three config questions, all `freshEachRun`, so the legacy bridge derives its
// run-input contract under the SAME three keys. The user entered all three in
// Setup, pressed Save answers, and the page said "✓ all set". The server agreed:
//
//     complete: true, needs_setup: false, ready_to_run: true
//     config: { raw_presenter_video, creative_brief, inspiration_reference }
//
// Then Run now opened a pop-up with three EMPTY controls and asked for all three
// again — and, because `raw_presenter_video` is required, refused to run until
// the video was chosen a second time. Saving had worked. The form simply never
// read what saving produced: the Run Inputs section was seeded from the file
// picker and nothing else, while the same keys were correctly filtered out of
// the saved-preferences section as duplicates. Filtered from one place, never
// seeded into the other.
//
// This walks the whole journey the report describes — SAVE, RELOAD, RUN NOW, and
// the DISPATCHED PAYLOAD — over the live contract and the live saved config, and
// asserts what a person would check at each step.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  missingRequiredInputs, orderedInputFields, reusablePreferences, serializeArtifactBindings,
  type ArtifactBinding, type WorkflowInputContract,
} from './workflow-input-contract.ts';
import {
  bindSavedArtifact, describeSavedInputError, displayedInputValue, inputOrigin,
  isBlankInputValue, readSavedRunInputs, resolveEffectiveInputs, resolveSavedBindResult,
  savedInputLabel,
  type RunInputOverrides,
} from './run-input-defaults.ts';

// ── the live workflow, verbatim in shape ────────────────────────────────────

const VIDEO_PATH = '/Users/rabigupta/Downloads/Sanna Gupta_s Video - Aug 4, 2026.mp4';
const BRIEF = 'Create a visual-first, evidence-led production plan. Use Runway sparingly for shots that genuinely require photorealistic cinematic motion.';
const INSPIRATION = 'youtube.com/watch?v=d8xRnfHWH3I';

const CONTRACT: WorkflowInputContract = {
  version: 1,
  fields: [
    {
      key: 'raw_presenter_video',
      label: 'Which raw presenter video should be planned? (upload the file or give its local path)',
      description: 'Which raw presenter video should be planned? (upload the file or give its local path)',
      kind: 'file', required: true, cardinality: 'one', order: 1,
      accept: { extensions: [], mediaTypes: [] },
    },
    {
      key: 'creative_brief',
      label: 'Optional creative brief — audience, brand, tone, evidence, exclusions, or production guidance',
      description: 'Optional creative brief — audience, brand, tone, evidence, exclusions, or production guidance.',
      kind: 'text', required: false, cardinality: 'one', order: 2,
    },
    {
      key: 'inspiration_reference',
      label: 'Optional inspiration reference — a URL or local video path used only to infer visual language',
      description: 'Optional inspiration reference — a URL or local video path used only to infer visual language.',
      kind: 'text', required: false, cardinality: 'one', order: 3,
    },
  ],
};

// outcome_schema.config_schema — the same three keys the contract owns.
const SAVED_SCHEMA = [
  { key: 'raw_presenter_video', question: 'Which raw presenter video should be planned? (upload the file or give its local path)', kind: 'file' as const },
  { key: 'creative_brief', question: 'Optional creative brief — audience, brand, tone, evidence, exclusions, or production guidance.', kind: 'text' as const, optional: true },
  { key: 'inspiration_reference', question: 'Optional inspiration reference — a URL or local video path used only to infer visual language.', kind: 'text' as const, optional: true },
];

/** GET /api/v2/agents/:slug/setup, after Save answers. */
const SETUP_RESPONSE = {
  schema: SAVED_SCHEMA,
  answers: { __agent_note: '', raw_presenter_video: VIDEO_PATH, creative_brief: BRIEF, inspiration_reference: INSPIRATION },
  runInputDefaults: { raw_presenter_video: VIDEO_PATH, creative_brief: BRIEF, inspiration_reference: INSPIRATION },
  complete: true, needs_setup: false, ready_to_run: true,
};

const VERIFIED_VIDEO: ArtifactBinding = {
  artifactId: '9f1c0f2e-1c3a-4d55-9a77-0c1c2f3a4b5c',
  sha256: 'a'.repeat(64),
  displayName: 'Sanna Gupta_s Video - Aug 4, 2026.mp4',
  mediaType: 'video/mp4',
};

/**
 * Opening the Run-now pop-up: load the setup, split it into the two sections,
 * and seed each. This is exactly what `openPreRun` does, in the same order.
 */
function openRunNow(setup: typeof SETUP_RESPONSE, { desktop = true } = {}) {
  const preferences = reusablePreferences(setup.schema, CONTRACT);
  const saved = readSavedRunInputs(CONTRACT, setup.runInputDefaults);
  let defaults = saved.bindable;
  // Desktop verifies each saved path and binds the artifact as a DEFAULT.
  if (desktop) {
    for (const field of saved.filesToVerify) {
      const outcome = resolveSavedBindResult({ ok: true, inputSessionId: 'cf3b1c8e-6f1a-4a02-9c1f-1a2b3c4d5e6f', ...VERIFIED_VIDEO }, field);
      if (outcome.kind === 'bound') defaults = bindSavedArtifact(defaults, field, outcome.binding);
    }
  }
  return { preferences, saved, defaults };
}

/** The Run-inputs half of the run-request body. */
function dispatchedPayload(defaults: ReturnType<typeof openRunNow>['defaults'], overrides: RunInputOverrides) {
  return serializeArtifactBindings(resolveEffectiveInputs(CONTRACT, defaults, overrides));
}

// ── 1. the state the report describes ───────────────────────────────────────

test('REPRO: the saved answers are filtered out of the preferences section', () => {
  // Correctly — they belong to the contract now. This is the half that worked,
  // and on its own it is what emptied the dialog.
  assert.deepEqual(reusablePreferences(SAVED_SCHEMA, CONTRACT), []);
});

test('a form seeded from nothing but the picker asks for all three again', () => {
  // The old behaviour, stated as the arithmetic it was: no defaults, so every
  // control is blank and the required one blocks Run.
  const missing = missingRequiredInputs(CONTRACT, {});
  assert.deepEqual(missing.map((f) => f.key), ['raw_presenter_video']);
  for (const field of orderedInputFields(CONTRACT)) {
    assert.ok(isBlankInputValue(displayedInputValue(field.key, {}, {})));
  }
});

// ── 2. save → reload → Run now ──────────────────────────────────────────────

test('every saved value appears in the Run-now pop-up', () => {
  const { defaults } = openRunNow(SETUP_RESPONSE);
  assert.equal(displayedInputValue('creative_brief', defaults, {}), BRIEF);
  assert.equal(displayedInputValue('inspiration_reference', defaults, {}), INSPIRATION);
  assert.deepEqual(displayedInputValue('raw_presenter_video', defaults, {}), VERIFIED_VIDEO);
});

test('a saved local path satisfies the required file input — Run is not blocked', () => {
  const { defaults } = openRunNow(SETUP_RESPONSE);
  assert.deepEqual(missingRequiredInputs(CONTRACT, resolveEffectiveInputs(CONTRACT, defaults, {})), [],
    'this is the acceptance criterion: with everything already saved, Run proceeds directly');
});

test('the pop-up says which values came from setup rather than showing them bare', () => {
  const { defaults } = openRunNow(SETUP_RESPONSE);
  for (const field of orderedInputFields(CONTRACT)) {
    assert.equal(inputOrigin(field.key, defaults, {}), 'saved');
  }
});

test('reloading the page keeps them: the values come from the server, not the tab', () => {
  // Overrides live in sessionStorage; defaults are re-read on every open. A
  // reload therefore starts from exactly what is saved.
  const first = openRunNow(SETUP_RESPONSE);
  const afterReload = openRunNow(SETUP_RESPONSE);
  assert.deepEqual(dispatchedPayload(afterReload.defaults, {}), dispatchedPayload(first.defaults, {}));
});

test('closing and reopening the pop-up erases nothing', () => {
  const { defaults } = openRunNow(SETUP_RESPONSE);
  const overrides: RunInputOverrides = { creative_brief: 'punchier, 30s' };
  // Reopening re-reads the defaults; the override the user typed is kept.
  const reopened = openRunNow(SETUP_RESPONSE);
  assert.deepEqual(dispatchedPayload(reopened.defaults, overrides), {
    raw_presenter_video: { artifactId: VERIFIED_VIDEO.artifactId, sha256: VERIFIED_VIDEO.sha256 },
    creative_brief: 'punchier, 30s',
    inspiration_reference: INSPIRATION,
  });
  assert.deepEqual(dispatchedPayload(defaults, {}).creative_brief, BRIEF, 'and the saved brief is untouched');
});

// ── 3. the dispatched payload ───────────────────────────────────────────────

test('the run receives the saved values, digest-only for the file', () => {
  const { defaults } = openRunNow(SETUP_RESPONSE);
  assert.deepEqual(dispatchedPayload(defaults, {}), {
    raw_presenter_video: { artifactId: VERIFIED_VIDEO.artifactId, sha256: VERIFIED_VIDEO.sha256 },
    creative_brief: BRIEF,
    inspiration_reference: INSPIRATION,
  });
});

test('no local path is ever in the payload, even though one is what was saved', () => {
  const { defaults } = openRunNow(SETUP_RESPONSE);
  assert.ok(!JSON.stringify(dispatchedPayload(defaults, {})).includes(VIDEO_PATH));
});

test('a one-run override replaces one value and leaves the rest saved', () => {
  const { defaults } = openRunNow(SETUP_RESPONSE);
  const payload = dispatchedPayload(defaults, { inspiration_reference: 'youtube.com/watch?v=OTHER' });
  assert.equal(payload.inspiration_reference, 'youtube.com/watch?v=OTHER');
  assert.equal(payload.creative_brief, BRIEF);
});

test('an override is never written back to the saved answer', () => {
  // The saved layer is only ever replaced by a reload from the server. Nothing
  // in the pop-up's own state can reach it.
  const { defaults } = openRunNow(SETUP_RESPONSE);
  const overrides: RunInputOverrides = { creative_brief: 'just this once' };
  void dispatchedPayload(defaults, overrides);
  assert.equal(displayedInputValue('creative_brief', defaults, {}), BRIEF);
  assert.equal(inputOrigin('creative_brief', defaults, overrides), 'override');
});

// ── 4. blanks ───────────────────────────────────────────────────────────────

test('a blank optional field does not overwrite the saved preference', () => {
  // Both halves of the same rule: nothing blank is submitted, and an untouched
  // field keeps what was saved.
  const { defaults } = openRunNow(SETUP_RESPONSE);
  assert.equal(dispatchedPayload(defaults, {}).creative_brief, BRIEF);
});

test('an emptied field is CLEARED for this run — not submitted blank, not saved over', () => {
  const { defaults } = openRunNow(SETUP_RESPONSE);
  const payload = dispatchedPayload(defaults, { creative_brief: '   ' });
  assert.ok(!('creative_brief' in payload),
    'an empty string is refused by validateInputBindings — sending one turns a clear into a run-create failure');
  assert.equal(inputOrigin('creative_brief', defaults, { creative_brief: '   ' }), 'cleared');
  assert.equal(displayedInputValue('creative_brief', defaults, {}), BRIEF, 'and the saved brief survives for the next run');
});

test('clearing the REQUIRED input blocks Run rather than dispatching without it', () => {
  const { defaults } = openRunNow(SETUP_RESPONSE);
  const overrides: RunInputOverrides = { raw_presenter_video: '' };
  assert.deepEqual(
    missingRequiredInputs(CONTRACT, resolveEffectiveInputs(CONTRACT, defaults, overrides)).map((f) => f.key),
    ['raw_presenter_video'],
  );
});

test('undoing an override returns the field to the saved value', () => {
  const { defaults } = openRunNow(SETUP_RESPONSE);
  const overrides: RunInputOverrides = { creative_brief: '' };
  delete overrides.creative_brief; // what "Use saved value" does
  assert.equal(displayedInputValue('creative_brief', defaults, overrides), BRIEF);
  assert.equal(inputOrigin('creative_brief', defaults, overrides), 'saved');
});

test('"use the saved one" names WHICH one, in terms that fit the field', () => {
  const [video, brief, inspiration] = orderedInputFields(CONTRACT);
  assert.equal(savedInputLabel(video, VIDEO_PATH), 'Sanna Gupta_s Video - Aug 4, 2026.mp4',
    'a path reads as its filename');
  assert.equal(savedInputLabel(inspiration, INSPIRATION), INSPIRATION,
    'a URL is not a path — splitting it on "/" would offer "watch?v=d8xRnfHWH3I"');
  assert.ok(savedInputLabel(brief, BRIEF).length <= 42, 'and a long brief is truncated, not spilled into the button');
  assert.ok(savedInputLabel(brief, BRIEF).endsWith('…'));
});

// ── 5. what must NOT be hydrated ────────────────────────────────────────────

test('a retired key is not offered as a default for the input that replaced it', () => {
  // The server strips these, and this is the client half of the same rule: a
  // saved `source_video` may not stand in for `target_video_source`, which
  // declares itself fresh every run.
  const replacing: WorkflowInputContract = {
    version: 1,
    fields: [{
      key: 'target_video_source', label: 'Target video source',
      description: 'Fresh URL or explicit local path. Required every run; never substitute a prior-run source.',
      kind: 'text', required: true, cardinality: 'one', order: 1, replaces: ['source_video'],
    }],
  };
  const saved = readSavedRunInputs(replacing, { source_video: '/Users/someone/Downloads/Months Old.mp4' });
  assert.deepEqual(saved.values, {});
  assert.deepEqual(saved.bindable, {});
});

test('a stale saved choice is not offered as if it were still selectable', () => {
  const choice: WorkflowInputContract = {
    version: 1,
    fields: [{
      key: 'aspect_ratio', label: 'Aspect ratio', description: 'Frame shape for this run.',
      kind: 'choice', required: false, cardinality: 'one', order: 1, options: ['16:9', '9:16'],
    }],
  };
  assert.deepEqual(readSavedRunInputs(choice, { aspect_ratio: '4:3' }).bindable, {},
    'offering it would fail invalid_choice_binding at run-create instead of at the form');
});

test('an older backend that sends no defaults leaves the form asking, as before', () => {
  const { defaults } = openRunNow({ ...SETUP_RESPONSE, runInputDefaults: {} });
  assert.deepEqual(defaults, {});
  assert.deepEqual(missingRequiredInputs(CONTRACT, resolveEffectiveInputs(CONTRACT, defaults, {})).map((f) => f.key),
    ['raw_presenter_video']);
});

// ── 6. a browser cannot verify a file, and must say so rather than lie ──────

test('without Desktop the saved path is named, not silently dropped', () => {
  const { saved, defaults } = openRunNow(SETUP_RESPONSE, { desktop: false });
  assert.equal(saved.values.raw_presenter_video, VIDEO_PATH,
    'the pop-up still has the saved source to show — a valid source must not read as missing');
  assert.deepEqual(missingRequiredInputs(CONTRACT, resolveEffectiveInputs(CONTRACT, defaults, {})).map((f) => f.key),
    ['raw_presenter_video'],
    'and it is honestly still unbound: only the machine holding the file can verify it');
});

test('every way verification can fail produces something the user can act on', () => {
  const field = orderedInputFields(CONTRACT)[0];
  for (const code of ['saved_input_missing', 'saved_input_not_a_local_path', 'incompatible_file_type',
    'saved_input_unavailable', 'saved_inputs_unsupported', 'not_linked', 'something_unheard_of']) {
    const outcome = resolveSavedBindResult({ ok: false, error: code }, field);
    assert.equal(outcome.kind, 'failed');
    assert.ok(outcome.kind === 'failed' && outcome.message.length > 20, `${code} must explain itself`);
  }
  assert.match(describeSavedInputError('saved_input_missing', field), /isn’t there any more/);
  assert.equal(resolveSavedBindResult({ ok: true, artifactId: VERIFIED_VIDEO.artifactId }, field).kind, 'failed',
    'a success we cannot bind is a failure, not a silent no-op');
});

// ── 7. the wiring, since this repo has no DOM renderer ──────────────────────

test('the pop-up seeds its run inputs from the setup it just loaded', () => {
  const src = readFileSync(new URL('../app/(dashboard)/_components/agent-actions.tsx', import.meta.url), 'utf8');
  assert.match(src, /const savedInputs = readSavedRunInputs\(inputContract, runInputDefaults\);/,
    'the defaults must be seeded where the setup is loaded — a helper nothing calls is how the blank form survived');
  assert.match(src, /const inputBindings = resolveEffectiveInputs\(inputContract, inputDefaults, inputOverrides\);/,
    'one merged value feeds the gate, the payload and the controls, so they cannot disagree');
  assert.match(src, /const modalInputSessionId = inputSessionRef\.current \|\| crypto\.randomUUID\(\);[\s\S]*?void verifySavedFileInputs\(savedInputs\.filesToVerify, modalInputSessionId\);/,
    'saved file paths are verified under the same frozen session used by manual choices, not assumed or rebound later');
  assert.match(src, /setInputOverrides\(\{\}\);/,
    'a queued run consumes its overrides — otherwise the NEXT run silently inherits them');
  assert.ok(!/setInputBindings\(/.test(src),
    'there is no third place to write bindings; every change is a default or an override');
});
