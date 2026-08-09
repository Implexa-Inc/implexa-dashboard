// node --test lib/review-room-recovery.test.ts
//
// Binds docs/review-room-draft-recovery.md to the code it describes.
//
// A recovery runbook that has drifted from the UI is worse than none: the operator
// checks for copy that no longer exists, decides something is wrong, and starts
// improvising against a production session. So the identifiers, the expected counts and
// the exact button text are asserted here against the same fixture and the same pure
// functions the room renders from.
//
// It also pins the two negative facts the runbook depends on: the procedure requires no
// migration, and this branch never submits the session itself.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { groupIssuesByArtifact, groupCountLabel } from './review-chronology.ts';
import { INITIAL_SUBMISSION_STATE, reviewSubmissionView } from './review-submission-flow.ts';
import {
  fixtureArtifacts, fixtureIssues, FIXTURE_RUN_ID, FIXTURE_SESSION_ID,
  EXPECTED_GROUPS, EXPECTED_TOTAL, BACKEND_PIN,
} from './review-multi-file-fixture.ts';

const doc = readFileSync(
  fileURLToPath(new URL('../docs/review-room-draft-recovery.md', import.meta.url)),
  'utf8',
);

test('the runbook names the exact production session, run and backend pin', () => {
  assert.match(doc, new RegExp(FIXTURE_SESSION_ID));
  assert.match(doc, new RegExp(FIXTURE_RUN_ID));
  assert.match(doc, new RegExp(BACKEND_PIN));
});

test('the pre-state the runbook tells the operator to confirm is what the rail renders', () => {
  const groups = groupIssuesByArtifact(fixtureIssues, fixtureArtifacts);
  assert.deepEqual(groups.map((g) => ({ displayName: g.displayName, count: g.count })), EXPECTED_GROUPS);

  // Every heading + count pair in step 1 must be one the rail actually prints.
  for (const { displayName, count } of EXPECTED_GROUPS) {
    assert.match(doc, new RegExp(`${displayName.replace(/[.]/g, '\\.')} — ${groupCountLabel(count)}`),
      `the runbook does not state "${displayName} — ${groupCountLabel(count)}"`);
  }
});

test('the button text the runbook tells the operator to look for is the text we render', () => {
  const label = reviewSubmissionView({
    state: INITIAL_SUBMISSION_STATE, draftCount: EXPECTED_TOTAL, busy: false, noteEnabled: true,
  }).primaryLabel;
  assert.equal(label, 'Send 12 changes & start revision');
  assert.match(doc, new RegExp(`\`${label.replace(/&/g, '&')}\``),
    'the runbook quotes a primary action the room does not render');
});

test('the runbook states the note contract the wire actually uses', () => {
  assert.match(doc, /`revisionNote`/, 'the runbook does not name the wire field');
  assert.match(doc, /2000 characters/, 'the runbook does not state the real bound');
  assert.match(doc, /supplements[\s\S]{0,80}never replaces/i);
});

test('the runbook forbids every mutation that would destroy the draft', () => {
  for (const forbidden of [
    /Do not create another review session/i,
    /Do not ask the reviewer to re-enter feedback/i,
    /Do not replace issue IDs/i,
    /Do not mark the session submitted by hand/i,
    /Do not bind an unrelated continuation/i,
  ]) {
    assert.match(doc, forbidden, `the runbook is missing a prohibition: ${forbidden}`);
  }
});

test('the runbook is explicit that it has NOT been run', () => {
  assert.match(doc, /not yet performed/i,
    'the runbook must not read as though the production session was already submitted');
});

test('this branch ships no migration and no backfill for the recovery', () => {
  // The recovery is an owner pressing the button; `review_prepare_submission` already
  // snapshots whatever drafts exist. A migration here would mean we had decided to
  // rewrite production rows instead, which the runbook forbids.
  assert.match(doc, /no migration or backfill is needed/i);
});
