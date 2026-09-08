// node --test lib/training-review-copy.test.ts
//
// The §2.4 privacy promise, pinned against a HARD-CODED literal.
//
// WHY THE LITERAL IS DUPLICATED HERE ON PURPOSE. The first version of the render test
// asserted `rendered.text().includes(PRIVACY_PROMISE)` — importing the constant it was
// checking. That assertion is a tautology: reword the constant and the test reworded
// with it. The mutation harness caught it (`[privacy-copy] the §2.4 promise is
// reworded into an untrue, stronger claim` SURVIVED), which is exactly what a mutation
// harness is for.
//
// So the sentence below is typed out from the spec. If the product's behaviour ever
// changes, this test must be edited deliberately — which is the point.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ACTIVE_LEARNING_HEADING, COACH_STEPS, INERT_CANDIDATE_BODY, INERT_CANDIDATE_HEADING,
  INSUFFICIENT_EVIDENCE_BODY, INSUFFICIENT_EVIDENCE_HEADING,
  NO_RECORDING_UPLOAD_NOTICE, PRIVACY_PROMISE, PRIVACY_QUALIFIER, PRIVACY_SCOPE_NOTICE,
  PROJECTION_UNAVAILABLE,
} from './training-review-copy.ts';

/** UNIVERSAL_AGENT_COACH_RECORD_REVIEW_SPEC_2026-09-07 §2.4, transcribed by hand. */
const SPEC_2_4 = 'The full recording stays on this Mac. Only the moments you select, '
  + 'their transcript, and the evidence needed to verify the teaching are saved to your '
  + 'private Agent history.';

test('the privacy promise is the §2.4 sentence, word for word', () => {
  assert.equal(PRIVACY_PROMISE, SPEC_2_4);
});

test('the promise never claims the stronger, false thing', () => {
  const everything = [
    PRIVACY_PROMISE, PRIVACY_QUALIFIER, PRIVACY_SCOPE_NOTICE, NO_RECORDING_UPLOAD_NOTICE,
  ].join(' ');
  // "Nothing leaves this Mac" is the lie this feature must not tell: selected moments
  // DO leave (§2.4), and the customer has to be told which.
  assert.doesNotMatch(everything, /nothing (you record )?(is |gets |ever )?(uploaded|leaves)/i);
  assert.doesNotMatch(everything, /never leaves/i);
  // §2.4: Implexa does not claim a recording contains no secrets.
  assert.doesNotMatch(everything, /no secrets|secret-free|safe to record/i);
  assert.match(PRIVACY_QUALIFIER, /do leave this Mac/);
  assert.match(PRIVACY_QUALIFIER, /cannot tell you whether a recording contains a secret/);
});

test('the honest-unavailable register matches verified-artifacts.tsx', () => {
  // The two anchors that set this register, quoted from the surfaces they live on.
  const verified = readFileSync(
    fileURLToPath(new URL('../app/(dashboard)/_components/verified-artifacts.tsx', import.meta.url)), 'utf8',
  );
  const room = readFileSync(
    fileURLToPath(new URL('../app/(dashboard)/_components/review-room.tsx', import.meta.url)), 'utf8',
  );
  assert.match(verified, /Checked on this Mac by Implexa/,
    'the register anchor moved — re-derive this copy against the new one');
  assert.match(room, /That does not mean the file is gone/,
    'the register anchor moved — re-derive this copy against the new one');
  assert.match(PROJECTION_UNAVAILABLE, /^Implexa could not read this training record just now\./);
  assert.match(PROJECTION_UNAVAILABLE, /That does not mean it is gone\.$/);
});

test('inert and active are described as different things, not degrees', () => {
  assert.notEqual(INERT_CANDIDATE_HEADING, ACTIVE_LEARNING_HEADING);
  assert.match(INERT_CANDIDATE_HEADING, /not active/i);
  assert.match(INERT_CANDIDATE_BODY, /changes nothing about future runs/);
  // F0 activates nothing, and the copy says the step is not available rather than
  // implying it is one click away.
  assert.match(INERT_CANDIDATE_BODY, /not available yet/);
});

test('insufficient evidence is explained and handed back to the Coach', () => {
  assert.match(INSUFFICIENT_EVIDENCE_HEADING, /Not enough evidence/);
  assert.match(INSUFFICIENT_EVIDENCE_BODY, /Implexa will not guess/);
});

test('the customer-facing steps are §2.3, with no internal machinery', () => {
  assert.deepEqual([...COACH_STEPS],
    ['Teach this Agent', 'Record', 'Review moments', 'Apply revision', 'Save improvement to Agent']);
  const joined = COACH_STEPS.join(' ');
  for (const forbidden of [/locator/i, /epoch/i, /fenc/i, /packet/i, /journal/i, /candidate/i, /digest/i]) {
    assert.doesNotMatch(joined, forbidden);
  }
});
