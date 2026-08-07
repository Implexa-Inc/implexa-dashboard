// node --test lib/run-now-input-identity.test.ts
//
// THE BUG THIS PINS. The Run-now form for the cinematic b-roll planner asked for
// the raw video twice: once as the legacy setup question `source_video` ("Which
// file is the raw video you want b-rolls planned for?", holding a local path
// saved weeks earlier) and once as the canonical `target_video_source`, whose own
// description reads "Required every run; never substitute a prior-run source."
// The saved `visual_style` URL overlapped `inspiration_video_source` the same way.
//
// The pop-up already de-duplicated the two lists — by EXACT KEY. `source_video`
// and `target_video_source` are different strings, so both rendered, and both
// reached the run.
//
// These tests exercise the real resolution helpers on the real contract and the
// real saved configuration, and assert the counts a person would count.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  orderedInputFields, missingRequiredInputs, reusablePreferences, supersededSetupKeys,
  type WorkflowInputContract,
} from './workflow-input-contract.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// The workflow's canonical contract, with the retirements this change declares.
const CONTRACT: WorkflowInputContract = {
  version: 1,
  fields: [
    {
      key: 'target_video_source', label: 'Target video source',
      description: 'Fresh URL or explicit local path to the target video for this run. Required every run; never substitute a prior-run source.',
      kind: 'text', required: true, cardinality: 'one', order: 1,
      replaces: ['source_video'],
    },
    {
      key: 'creative_brief_md', label: 'Creative brief / beat sheet',
      description: 'Optional Markdown creative brief or beat sheet selected securely for this run.',
      kind: 'file', required: false, cardinality: 'one', order: 2,
      accept: { extensions: ['.markdown', '.md'], mediaTypes: ['text/markdown', 'text/plain'] },
    },
    {
      key: 'inspiration_video_source', label: 'Inspiration video source',
      description: 'Optional fresh URL or explicit local path to an inspiration video for this run.',
      kind: 'text', required: false, cardinality: 'one', order: 3,
      replaces: ['visual_style'],
    },
  ],
};

// The workflow's saved setup, verbatim in shape from the live row.
const SAVED_SCHEMA = [
  { key: 'source_video', question: 'Which file is the raw video you want b-rolls planned for?', kind: 'text' as const },
  { key: 'visual_style', question: 'What visual style should the b-rolls follow?', kind: 'text' as const },
  { key: 'broll_density', question: 'How many b-rolls per minute?', kind: 'text' as const },
  { key: 'aspect_ratio', question: 'What aspect ratio?', kind: 'choice' as const, options: ['16:9 (YouTube/landscape)', '9:16 (Reels/TikTok)'] },
  { key: 'default_engine', question: 'Preferred generation engine?', kind: 'text' as const },
];

/** Every control the pop-up would render, in the order a person reads them. */
function renderedControls(schema: typeof SAVED_SCHEMA, contract: WorkflowInputContract | null) {
  return [
    ...reusablePreferences(schema, contract).map((f) => ({ section: 'preferences', key: f.key, label: f.question })),
    ...orderedInputFields(contract).map((f) => ({ section: 'run-inputs', key: f.key, label: f.label })),
  ];
}

test('the form shows exactly one target-video control', () => {
  const controls = renderedControls(SAVED_SCHEMA, CONTRACT);
  const target = controls.filter((c) => /raw video|target video/i.test(c.label));
  assert.equal(target.length, 1, `expected one, got: ${target.map((c) => c.label).join(' | ')}`);
  assert.equal(target[0].key, 'target_video_source');
  assert.equal(target[0].section, 'run-inputs');
});

test('it does NOT show "Which file is the raw video…" alongside Target video source', () => {
  const labels = renderedControls(SAVED_SCHEMA, CONTRACT).map((c) => c.label);
  assert.ok(labels.includes('Target video source'));
  assert.ok(!labels.some((l) => l.startsWith('Which file is the raw video')),
    'the superseded question is the acceptance criterion for this whole change');
});

test('it shows exactly one inspiration-source control', () => {
  const controls = renderedControls(SAVED_SCHEMA, CONTRACT);
  const inspiration = controls.filter((c) => /visual style|inspiration/i.test(c.label));
  assert.equal(inspiration.length, 1, `expected one, got: ${inspiration.map((c) => c.label).join(' | ')}`);
  assert.equal(inspiration[0].key, 'inspiration_video_source');
});

test('the fresh Markdown picker stays keyed to creative_brief_md', () => {
  const brief = orderedInputFields(CONTRACT).find((f) => f.kind === 'file');
  assert.ok(brief);
  assert.equal(brief.key, 'creative_brief_md');
  assert.deepEqual(brief.accept?.extensions, ['.markdown', '.md']);
  assert.deepEqual(brief.accept?.mediaTypes, ['text/markdown', 'text/plain']);
});

test('the reusable preferences are exactly density, aspect ratio and engine', () => {
  assert.deepEqual(
    reusablePreferences(SAVED_SCHEMA, CONTRACT).map((f) => f.key),
    ['broll_density', 'aspect_ratio', 'default_engine'],
  );
});

test('a retained standing style preference is a separate control from the per-run one', () => {
  const withStanding = [
    ...SAVED_SCHEMA,
    { key: 'standing_visual_style_preference', question: 'Any standing visual-style direction to apply every run?', kind: 'text' as const },
  ];
  const controls = renderedControls(withStanding, CONTRACT);
  const keys = controls.map((c) => c.key);
  assert.ok(keys.includes('standing_visual_style_preference'));
  assert.ok(keys.includes('inspiration_video_source'));
  assert.ok(!keys.includes('visual_style'), 'the ambiguous original is retired, not renamed in place');
});

// ── preferences never stand in for fresh inputs ──────────────────────────────

test('answered preferences do not satisfy a required fresh input', () => {
  // Every preference filled in; the required target still missing.
  const missing = missingRequiredInputs(CONTRACT, {
    broll_density: '3', aspect_ratio: '16:9 (YouTube/landscape)', default_engine: 'Runway Gen-4.5',
  } as Record<string, string>);
  assert.deepEqual(missing.map((f) => f.key), ['target_video_source']);
});

test('a saved legacy target cannot satisfy the canonical one', () => {
  const missing = missingRequiredInputs(CONTRACT, { source_video: '/Users/someone/Downloads/Raw Video.mp4' } as Record<string, string>);
  assert.deepEqual(missing.map((f) => f.key), ['target_video_source'],
    'the legacy key is not a value for the field that replaced it');
});

test('a fresh target satisfies it, and nothing else is demanded', () => {
  assert.deepEqual(
    missingRequiredInputs(CONTRACT, { target_video_source: 'https://example.test/fresh.mp4' }).map((f) => f.key),
    [],
  );
});

// ── the same identity cannot render twice, whatever the keys are ─────────────

test('a same-key overlap is also collapsed, not just a declared replacement', () => {
  const sameKey: WorkflowInputContract = {
    version: 1,
    fields: [{ ...CONTRACT.fields[0], key: 'source_video', replaces: undefined }],
  };
  const keys = renderedControls(SAVED_SCHEMA, sameKey).map((c) => c.key);
  assert.equal(keys.filter((k) => k === 'source_video').length, 1);
});

test('superseded keys cover both the declared replacements and the contract keys', () => {
  assert.deepEqual([...supersededSetupKeys(CONTRACT)].sort(), [
    'creative_brief_md', 'inspiration_video_source', 'source_video', 'target_video_source', 'visual_style',
  ]);
});

test('with no contract, nothing is filtered', () => {
  assert.deepEqual(reusablePreferences(SAVED_SCHEMA, null).map((f) => f.key), SAVED_SCHEMA.map((f) => f.key));
});

// ── the resolution is applied at every place the pop-up builds a list ────────
// The pop-up is not rendered here (this repo has no DOM renderer), so the wiring
// is pinned as source. A helper nothing calls is exactly how the key-only filter
// survived for so long.

test('every list the pre-run pop-up builds runs through the same resolution', () => {
  const src = readFileSync(new URL('../app/(dashboard)/_components/agent-actions.tsx', import.meta.url), 'utf8');
  assert.match(src, /const durableSetup = reusablePreferences\(schema, inputContract\);/,
    'the settings section must render preferences only');
  assert.match(src, /const pairs = reusablePreferences\(schema, inputContract\)/,
    'the watch-mode prompt is another envelope; a superseded answer there is the same stale value by another route');
  assert.ok(!/const typedKeys = new Set\(typedFields\.map/.test(src),
    'the key-only filter is what let two names for one identity both render');
  assert.match(src, /^\s*acceptsDirectorySnapshot, bindInputValue, missingRequiredInputs, orderedInputFields, reusablePreferences,$/m,
    'imported from the shared contract module, not re-implemented locally');
  assert.equal(src.split('reusablePreferences(').length - 1, 2,
    'exactly the two lists the pop-up builds — a third list added without it re-opens the defect');
  void ROOT;
});
