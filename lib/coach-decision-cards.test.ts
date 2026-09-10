// node --test lib/coach-decision-cards.test.ts
//
// The Coach is the semantic authority (§1.2). These tests pin the rules a well-meaning
// refactor would remove:
//
//   · an `insufficient_evidence` card cannot be confirmed — otherwise a compiler's "we
//     could not tell" is laundered into a confirmed decision under the Coach's name;
//   · a confirmed card whose canonical mint is DEFERRED renders as "confirmed, not yet
//     a learning", never as anything that implies a future run will behave differently;
//   · nothing here activates anything — there is no action, and no wire value, that
//     could.
//
// The cards parsed below are the BACKEND's own proposals from its generated fixture.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  CONFIDENCE_LABELS, FIELD_LABELS, FIELD_ORDER, SCOPE_LABELS, STANDING_SENTENCES,
  canConfirm, changesFutureRuns, confirmBlockedReason, confirmationSummary,
  confirmedDecisions, discardBlockedReason, isInsufficientEvidence, learningStanding,
  parseDecisionCard, parseDecisionCards, standingSentence, wireDecision,
  type CoachDecisionCard,
} from './coach-decision-cards.ts';

const fixture = JSON.parse(readFileSync(
  fileURLToPath(new URL('../test-fixtures/training-review-f0.v1.json', import.meta.url)), 'utf8',
));

/** The DECIDED review publishes both kinds: one confirmed decision, one weak card. */
const RAW = fixture.backend.reviews.decided.proposals as any[];
const LINKED_RAW = fixture.backend.reviews.linkedCandidate.proposals as any[];
const [DECISION_RAW, WEAK_RAW] = RAW;

const cards = () => parseDecisionCards(RAW);
/** The same decision card as the Coach first sees it: proposed, undecided. */
const proposed = (): CoachDecisionCard =>
  parseDecisionCard({ ...DECISION_RAW, status: 'proposed', decided: false, decidedAt: null })!;

test('the backend\'s proposals parse into the complete §1.2 field set', () => {
  const [decision, weak] = cards();
  assert.equal(decision.kind, 'decision');
  assert.equal(decision.status, 'confirmed');
  assert.equal(decision.decided, true);
  assert.equal(decision.proposedScope, 'both');
  assert.equal(decision.confidence, 'high');
  assert.equal(decision.affectedStepIndex, 2);
  assert.equal(decision.affectedCapabilityIdentity, 'cad.toolpath');
  assert.equal(decision.sourceAnnotationIds.length, 1);
  assert.equal(decision.canonicalLinkState, 'mint_deferred');
  assert.equal(decision.influenceState, 'inert');
  assert.equal(isInsufficientEvidence(decision), false);
  assert.equal(isInsufficientEvidence(weak), true);
  assert.deepEqual([...FIELD_ORDER].sort(), Object.keys(decision.content).sort());
});

test('every §1.2 field, scope and confidence gets its own words on screen', () => {
  const labels = [
    ...FIELD_ORDER.map((field) => FIELD_LABELS[field]),
    ...Object.values(SCOPE_LABELS),
    ...Object.values(CONFIDENCE_LABELS),
  ];
  assert.equal(new Set(labels).size, labels.length, 'two things sharing a label is a collapse');
});

test('a card whose kind, status, link state or digest is unreadable is DROPPED, never defaulted', () => {
  assert.equal(parseDecisionCard({ ...DECISION_RAW, kind: 'guess' }), null);
  assert.equal(parseDecisionCard({ ...DECISION_RAW, status: 'accepted' }), null);
  assert.equal(parseDecisionCard({ ...DECISION_RAW, canonicalLinkState: 'minted' }), null);
  assert.equal(parseDecisionCard({ ...DECISION_RAW, proposalId: 'not-a-uuid' }), null);
  assert.equal(parseDecisionCard({ ...DECISION_RAW, ordinal: null }), null);
  // No digest means no decidable card: rendering Confirm on it would produce a refusal
  // the Coach would read as a bug.
  assert.equal(parseDecisionCard({ ...DECISION_RAW, proposalDigest: undefined }), null);
  assert.equal(parseDecisionCards('nope' as unknown).length, 0);
  assert.equal(parseDecisionCards([DECISION_RAW, null, 7]).length, 1);
});

test('a card claiming to be active is dropped — this contract cannot produce one', () => {
  assert.equal(parseDecisionCard({ ...DECISION_RAW, influenceState: 'active' }), null);
  assert.equal(parseDecisionCard({ ...DECISION_RAW, influenceState: null }), null);
  for (const card of cards()) assert.equal(changesFutureRuns(card), false);
});

test('an insufficient_evidence card is visible and refused for confirmation, with a reason', () => {
  const [, weak] = cards();
  assert.equal(canConfirm(weak), false);
  assert.match(confirmBlockedReason(weak)!, /does not justify this, so it cannot be confirmed/);
  // It is still readable, and it still carries the reason the compiler gave.
  assert.ok(weak.insufficientEvidenceReason);
  assert.match(weak.insufficientEvidenceReason!, /never shows the feed rate/);
  // Discarding it is always available.
  assert.equal(discardBlockedReason(weak), null);
});

test('a decision that names no moment from the recording cannot be confirmed', () => {
  const orphan: CoachDecisionCard = { ...proposed(), sourceAnnotationIds: [] };
  assert.match(confirmBlockedReason(orphan)!, /names no moment/);
});

test('an already decided card cannot be decided again, and says which way it went', () => {
  const [decision] = cards();
  assert.match(confirmBlockedReason(decision)!, /already confirmed/);
  assert.match(discardBlockedReason(decision)!, /already confirmed/);
  const discarded: CoachDecisionCard = { ...proposed(), status: 'discarded' };
  assert.match(confirmBlockedReason(discarded)!, /was discarded/);
  assert.match(discardBlockedReason(discarded)!, /already discarded/);
  // A freshly proposed, well-evidenced card is confirmable.
  assert.equal(canConfirm(proposed()), true);
});

test('the wire has exactly two decisions, and neither of them is an activation', () => {
  assert.equal(wireDecision({ type: 'confirm', proposalId: 'x' }), 'confirmed');
  assert.equal(wireDecision({ type: 'discard', proposalId: 'x' }), 'discarded');
  assert.deepEqual(new Set(['confirmed', 'discarded']), new Set([
    wireDecision({ type: 'confirm', proposalId: 'x' }),
    wireDecision({ type: 'discard', proposalId: 'x' }),
  ]));
});

// ── MINT DEFERRED ─────────────────────────────────────────────────────────────────

test('a confirmed card whose mint is DEFERRED is "confirmed, not yet a learning"', () => {
  const [decision] = cards();
  assert.equal(decision.canonicalLinkState, 'mint_deferred');
  assert.equal(decision.canonicalCandidateId, null, 'a deferred mint has no candidate');
  assert.equal(learningStanding(decision), 'confirmed_not_a_learning');
  // The server's own sentence wins, and it says the same thing.
  assert.match(standingSentence(decision), /not a learning yet/i);
  assert.match(STANDING_SENTENCES.confirmed_not_a_learning, /Confirmed, not yet a learning/);
});

test('no standing sentence implies an activation, a queue, or a changed future run', () => {
  const sentences = [
    ...Object.values(STANDING_SENTENCES),
    ...cards().map(standingSentence),
    ...parseDecisionCards(LINKED_RAW).map(standingSentence),
  ];
  for (const sentence of sentences) {
    assert.doesNotMatch(sentence, /\bactivated\b/i, sentence);
    assert.doesNotMatch(sentence, /\bwill (be )?(apply|used|active)/i, sentence);
    assert.doesNotMatch(sentence, /future runs will/i, sentence);
    assert.doesNotMatch(sentence, /pending activation|waiting to be activated|queued/i, sentence);
  }
});

test('a card LINKED to an existing candidate is still inert, and reads differently', () => {
  const [linked] = parseDecisionCards(LINKED_RAW);
  assert.equal(linked.canonicalLinkState, 'linked_existing');
  assert.ok(linked.canonicalCandidateId, 'a linked card names the candidate it resolved to');
  assert.equal(learningStanding(linked), 'confirmed_linked_inert');
  assert.equal(changesFutureRuns(linked), false);
  assert.match(standingSentence(linked), /inert/i);
  const [deferred] = cards();
  assert.notEqual(learningStanding(linked), learningStanding(deferred));
  assert.notEqual(standingSentence(linked), standingSentence(deferred));
});

test('an undecided and a discarded card each get their own standing', () => {
  assert.equal(learningStanding(proposed()), 'undecided');
  assert.equal(learningStanding({ ...proposed(), status: 'discarded' }), 'discarded');
  const distinct = new Set(Object.values(STANDING_SENTENCES));
  assert.equal(distinct.size, Object.keys(STANDING_SENTENCES).length, 'two standings sharing a sentence is a collapse');
});

test('when the server sends no inert note, the fallback still stops short of activation', () => {
  const noNote: CoachDecisionCard = { ...cards()[0], inertNote: null };
  assert.equal(standingSentence(noNote), STANDING_SENTENCES.confirmed_not_a_learning);
  assert.doesNotMatch(standingSentence(noNote), /activated/i);
});

test('the summary counts unresolved work and names the unjustifiable cards separately', () => {
  assert.match(confirmationSummary(cards()), /1 confirmed · 1 still to decide · 1 the recording cannot justify/);
  assert.equal(confirmedDecisions(cards()).length, 1);
  assert.match(confirmationSummary([proposed()]), /0 confirmed · 1 still to decide/);
});

test('the module offers no way to activate a learning, and no edit or merge with no wire', () => {
  const source = readFileSync(fileURLToPath(new URL('./coach-decision-cards.ts', import.meta.url)), 'utf8');
  // Absence is the guarantee (§5 F0 must-nots). A disabled Activate would still be a
  // promise about what this foundation does.
  assert.doesNotMatch(source, /type:\s*'activate'/);
  assert.doesNotMatch(source, /type:\s*'edit'/);
  assert.doesNotMatch(source, /type:\s*'merge'/);
  assert.doesNotMatch(source, /\bactivate\s*[:(]/i);
  assert.equal(WEAK_RAW && typeof WEAK_RAW === 'object', true);
});
