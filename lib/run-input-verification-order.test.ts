import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advanceInputRevision, inputRevisionIsCurrent, readInputRevision } from './run-input-verification-order.ts';

test('a late saved-source result is stale after a successful manual replacement', () => {
  const revisions: Record<string, number> = {};
  const savedStartedAt = readInputRevision(revisions, 'project_bundle');

  advanceInputRevision(revisions, 'project_bundle');

  assert.equal(inputRevisionIsCurrent(revisions, 'project_bundle', savedStartedAt), false);
  assert.equal(inputRevisionIsCurrent(revisions, 'another_field', 0), true,
    'replacing one field must not cancel verification of another');
});

test('saved verification remains current when no manual replacement succeeded', () => {
  const revisions: Record<string, number> = {};
  const savedStartedAt = readInputRevision(revisions, 'project_bundle');
  assert.equal(inputRevisionIsCurrent(revisions, 'project_bundle', savedStartedAt), true);
});
