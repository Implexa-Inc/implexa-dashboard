// node --test lib/training-review-lifecycle.test.ts
//
// §1.3: "The UI and database must never collapse requested, demonstrated, implemented,
// verified, accepted, and activated into one status."
//
// A six-key object satisfies that sentence and still ships the bug, so these tests
// assert the six read DIFFERENTLY — distinct labels, distinct sentences, distinct
// tones — and that the two derivations that matter (does anything change about future
// runs; is this inert or active) come from the ACTIVATED fact alone.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FACT_UNKNOWN_SENTENCE, LIFECYCLE_FACT_KEYS,
  activationStance, changesFutureRuns, factLabel, factSentence, factTone,
  parseAuthorityState, unknownAuthorityState,
} from './training-review-lifecycle.ts';

const all = (status: 'yes' | 'no' | 'unknown') => parseAuthorityState(
  Object.fromEntries(LIFECYCLE_FACT_KEYS.map((key) => [key, { status, at: null, detail: null }])),
);

test('there are exactly six facts, in the order §1.3 names them', () => {
  assert.deepEqual([...LIFECYCLE_FACT_KEYS],
    ['requested', 'demonstrated', 'implemented', 'verified', 'accepted', 'activated']);
});

test('every fact has its own label — no two share one', () => {
  const labels = LIFECYCLE_FACT_KEYS.map(factLabel);
  assert.equal(new Set(labels).size, 6, `two facts share a label: ${labels.join(' | ')}`);
});

test('every fact has its own YES and its own NO sentence — 12 distinct sentences', () => {
  const yes = all('yes'); const no = all('no');
  const sentences = [
    ...LIFECYCLE_FACT_KEYS.map((key) => factSentence(yes[key])),
    ...LIFECYCLE_FACT_KEYS.map((key) => factSentence(no[key])),
  ];
  assert.equal(new Set(sentences).size, 12, `a sentence is reused: ${sentences.join(' | ')}`);
});

test('an UNREAD fact says so, and never reads as a NO', () => {
  const unknown = all('unknown'); const no = all('no');
  for (const key of LIFECYCLE_FACT_KEYS) {
    assert.equal(factSentence(unknown[key]), FACT_UNKNOWN_SENTENCE);
    assert.notEqual(factSentence(unknown[key]), factSentence(no[key]));
    // And it is not merely worded differently — it is TONED differently, so the
    // collapse cannot re-enter through CSS.
    assert.equal(factTone(unknown[key]), 'unread');
    assert.equal(factTone(no[key]), 'not-yet');
    assert.equal(factTone(all('yes')[key]), 'affirmed');
  }
  assert.match(FACT_UNKNOWN_SENTENCE, /does not mean it did not happen/);
});

test('the activated NO says what it MEANS for the customer, not that a flag is false', () => {
  const no = all('no');
  assert.match(factSentence(no.activated), /Future runs behave exactly as they did before/);
});

test('a missing or malformed fact is UNKNOWN, never NO', () => {
  const partial = parseAuthorityState({ requested: { status: 'yes', at: null, detail: null } });
  assert.equal(partial.requested.status, 'yes');
  for (const key of LIFECYCLE_FACT_KEYS.filter((k) => k !== 'requested')) {
    assert.equal(partial[key].status, 'unknown', `${key} defaulted away from unknown`);
  }
  assert.equal(parseAuthorityState({ activated: 'yes' }).activated.status, 'unknown');
  assert.equal(parseAuthorityState({ activated: { status: 'sure' } }).activated.status, 'unknown');
  assert.equal(parseAuthorityState(null).verified.status, 'unknown');
  for (const key of LIFECYCLE_FACT_KEYS) assert.equal(unknownAuthorityState()[key].status, 'unknown');
});

test('a server detail is shown only for a fact that is actually YES', () => {
  const state = parseAuthorityState({
    verified: { status: 'yes', at: null, detail: 'Two deterministic checks agreed.' },
    accepted: { status: 'no', at: null, detail: 'Two deterministic checks agreed.' },
  });
  assert.equal(factSentence(state.verified), 'Two deterministic checks agreed.');
  assert.doesNotMatch(factSentence(state.accepted), /deterministic/);
});

test('inert versus active is derived from ACTIVATED alone — acceptance is not activation', () => {
  // The §1.3 trap: everything verified and accepted, nothing activated.
  const acceptedNotActivated = parseAuthorityState({
    requested: { status: 'yes' }, demonstrated: { status: 'yes' }, implemented: { status: 'yes' },
    verified: { status: 'yes' }, accepted: { status: 'yes' }, activated: { status: 'no' },
  });
  assert.equal(activationStance(acceptedNotActivated), 'inert_candidate');
  assert.equal(changesFutureRuns(acceptedNotActivated), false);

  const activated = parseAuthorityState({ ...{}, activated: { status: 'yes' } });
  assert.equal(activationStance(activated), 'active_learning');
  assert.equal(changesFutureRuns(activated), true);

  // Unreadable activation is its own answer. Guessing "inert" would be the safer lie,
  // and it is still a lie.
  assert.equal(activationStance(unknownAuthorityState()), 'unknown');
  assert.equal(changesFutureRuns(unknownAuthorityState()), false);
});

test('nothing but activated can flip the future-runs claim', () => {
  for (const key of LIFECYCLE_FACT_KEYS.filter((k) => k !== 'activated')) {
    const state = parseAuthorityState({ [key]: { status: 'yes' }, activated: { status: 'no' } });
    assert.equal(changesFutureRuns(state), false, `${key} must not imply activation`);
    assert.equal(activationStance(state), 'inert_candidate');
  }
});
