import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyGenerationEntryArtifacts,
  isValidatedVideoOutput,
} from './generation-entry-eligibility.ts';

test('generation entry requires the validated final video artifact', () => {
  assert.equal(isValidatedVideoOutput({ role: 'final_output', relativePath: 'renders/final.MP4' }), true);
  assert.equal(isValidatedVideoOutput({ role: 'final_output', relativePath: 'renders/final.webm' }), true);
  assert.equal(isValidatedVideoOutput({ role: 'source', relativePath: 'raw.mp4' }), false);
  assert.equal(isValidatedVideoOutput({ role: 'final_output', relativePath: 'QA_REPORT.md' }), false);
  assert.equal(isValidatedVideoOutput({ role: null, relativePath: 'claimed.mp4' }), false);
});

test('the direct entry route requires a validated final video artifact', () => {
  assert.equal(classifyGenerationEntryArtifacts([
    { status: 'validated', role: 'final_output', relative_path: 'renders/final.mp4' },
  ]), 'eligible');
  for (const row of [
    { status: 'declared', role: 'final_output', relative_path: 'renders/final.mp4' },
    { status: 'rejected', role: 'final_output', relative_path: 'renders/final.mp4' },
    { status: 'validated', role: 'source', relative_path: 'renders/final.mp4' },
    { status: 'validated', role: 'final_output', relative_path: 'QA_REPORT.md' },
  ]) assert.equal(classifyGenerationEntryArtifacts([row]), 'ineligible');
});

test('an artifact outage or malformed row is unavailable, never confidently ineligible', () => {
  assert.equal(classifyGenerationEntryArtifacts([], new Error('down')), 'unavailable');
  assert.equal(classifyGenerationEntryArtifacts(null), 'unavailable');
  assert.equal(classifyGenerationEntryArtifacts([{}]), 'unavailable');
});
