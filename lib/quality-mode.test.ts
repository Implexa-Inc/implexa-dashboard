// node --test lib/quality-mode.test.ts
//
// The quality-mode vocabulary: labels are display, values are identity, and
// Production stays disabled behind TWO independent gates — the test for each gate
// deliberately satisfies the OTHER one, so deleting either single guard fails a
// test here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  QUALITY_MODES, capabilityWords, isModeSelectable, isQualityMode, qualityModeSelectorState,
  modeDifferenceRows, unavailableModeCopy, qualityModeLabel, qualityModeOption,
} from './quality-mode.ts';

// ── labels are display, values are identity ─────────────────────────────────

test('UI labels map to backend values and never replace them', () => {
  assert.deepEqual(
    QUALITY_MODES.map((m) => [qualityModeOption(m).label, qualityModeOption(m).value]),
    [['Quick', 'fast'], ['Professional', 'professional'], ['Production', 'production']],
  );
  // The persistable value is never a display label.
  for (const m of QUALITY_MODES) assert.notEqual(qualityModeOption(m).value, qualityModeOption(m).label);
  assert.equal(isQualityMode('Quick'), false);
  assert.equal(isQualityMode('fast'), true);
});

test('the three modes have three distinct descriptions — no label sharing one behavior', () => {
  const descriptions = QUALITY_MODES.map((m) => qualityModeOption(m).description);
  assert.equal(new Set(descriptions).size, 3);
  assert.equal(qualityModeOption('fast').description, 'Faster, lower-density generation with essential validation.');
  assert.equal(qualityModeOption('professional').description, 'Higher-density planning, per-asset review, and repair-ready output.');
});

test('an unknown mode value is named honestly, never dressed as a known mode', () => {
  assert.match(qualityModeLabel('ultra'), /unrecognized/i);
  assert.match(qualityModeLabel('ultra'), /ultra/);
});

// ── the Production double gate ──────────────────────────────────────────────

test('gate 1 alone: even if a response claims production is available, the build flag refuses', () => {
  // This satisfies the availability gate — ONLY the static build gate stands
  // between this and a clickable Production. Deleting it fails here.
  assert.equal(isModeSelectable('production', { availability: true }), false);
});

test('gate 2 alone: the compiled availability refuses production regardless of build flags', () => {
  // The real compiler output for production: availability false. Even a build
  // that (wrongly) enabled Production statically is refused by this gate.
  assert.equal(isModeSelectable('production', { availability: false }), false);
});

test('no compilation means not selectable — for every mode', () => {
  for (const m of QUALITY_MODES) assert.equal(isModeSelectable(m, null), false, m);
});

test('fast and professional are selectable exactly when compiled available', () => {
  assert.equal(isModeSelectable('fast', { availability: true }), true);
  assert.equal(isModeSelectable('professional', { availability: true }), true);
  assert.equal(isModeSelectable('fast', { availability: false }), false);
});

test('the selector state routes all three rendered modes through the canonical gate', () => {
  const state = qualityModeSelectorState({
    fast: { availability: true },
    professional: { availability: false },
    production: { availability: true },
  });
  assert.deepEqual(state, {
    fast: { selectable: true },
    professional: { selectable: false },
    production: { selectable: false },
  });
});

// ── unavailable-reason translation ──────────────────────────────────────────

test('the production machine reason is translated into the missing capabilities', () => {
  const copy = unavailableModeCopy('production', 'missing_required_production_capabilities', [
    'video.judge.per_asset', 'video.orchestration.segmented_assembly',
  ]);
  assert.match(copy, /^Production mode/);
  assert.match(copy, /per-clip judging/);
  assert.match(copy, /segmented assembly/);
  assert.match(copy, /isn't available yet/i);
});

test("the professional machine reason says described-but-not-enforced, not 'not built'", () => {
  const copy = unavailableModeCopy('professional', 'missing_required_professional_execution_capabilities', [
    'video.judge.per_asset', 'video.orchestration.segmented_assembly',
  ]);
  assert.match(copy, /^Professional mode/);
  assert.match(copy, /not genuinely enforced/i);
  assert.match(copy, /can't be promised/i);
  assert.ok(!/not built yet\.$/.test(copy), 'described-but-unenforced is a different fact from not-built');
});

test('an unknown machine reason is surfaced verbatim, not hidden', () => {
  assert.match(unavailableModeCopy('production', 'some_new_reason', []), /some_new_reason/);
});

test('an unknown capability key is shown verbatim, not given an invented name', () => {
  assert.equal(capabilityWords('video.some.future_thing'), 'video.some.future_thing');
});

test('with no compiled reason, copy claims only what we know', () => {
  const copy = unavailableModeCopy('production', null, []);
  assert.match(copy, /isn't available in this build/i);
  assert.ok(!/needs/.test(copy), 'must not invent a cause');
});

// ── differences come from the backend, not client math ──────────────────────

test('difference rows are verbatim projections of compiled fields', () => {
  const rows = modeDifferenceRows({
    densityLabel: 'high', generationsPerMoment: 2,
    stageKinds: ['moment_analysis', 'paid_generation'],
    reviewRequirements: ['per_asset_judge'],
  });
  assert.deepEqual(rows.map((r) => r.term), ['Density', 'Pipeline', 'Review']);
  assert.match(rows[0].detail, /high — 2 generations per moment/);
  assert.match(rows[1].detail, /moment analysis → paid generation/);
});

test('no compiled proposal, no difference rows — nothing is described from thin air', () => {
  assert.deepEqual(modeDifferenceRows(null), []);
});
