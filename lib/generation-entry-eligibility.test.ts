import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidatedVideoOutput } from './generation-entry-eligibility.ts';

test('generation entry requires the validated final video artifact', () => {
  assert.equal(isValidatedVideoOutput({ role: 'final_output', relativePath: 'renders/final.MP4' }), true);
  assert.equal(isValidatedVideoOutput({ role: 'final_output', relativePath: 'renders/final.webm' }), true);
  assert.equal(isValidatedVideoOutput({ role: 'source', relativePath: 'raw.mp4' }), false);
  assert.equal(isValidatedVideoOutput({ role: 'final_output', relativePath: 'QA_REPORT.md' }), false);
  assert.equal(isValidatedVideoOutput({ role: null, relativePath: 'claimed.mp4' }), false);
});
