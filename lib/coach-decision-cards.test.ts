// node --test lib/coach-decision-cards.test.ts
//
// The Coach is the semantic authority (§1.2). These tests pin the three rules that a
// well-meaning refactor would remove:
//
//   · an `insufficient_evidence` card cannot be accepted until the Coach supplies the
//     missing words — otherwise a model's "we could not tell" is laundered into a
//     confirmed decision under the Coach's name;
//   · a merge keeps the merged card readable and unions its evidence; and
//   · nothing here activates anything — there is no action that could.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  DECISION_TEXT_MAX, FIELD_LABELS, FIELD_ORDER, REQUIRED_FIELDS,
  acceptBlockedReason, acceptedDecisions, applyDecisionAction, canAccept,
  confirmationSummary, parseDecisionCard, parseDecisionCards,
  type CoachDecisionCard,
} from './coach-decision-cards.ts';

const fixture = JSON.parse(readFileSync(
  fileURLToPath(new URL('../test-fixtures/training-review-f0.v1.json', import.meta.url)), 'utf8',
));

const RAW = fixture.projection.projection.decisions as unknown[];
const [GOOD_RAW, WEAK_RAW] = RAW;

const cards = () => parseDecisionCards(RAW);

test('the compiler output parses into the complete §1.2 field set', () => {
  const [good, weak] = cards();
  assert.equal(good.disposition, 'proposed');
  assert.equal(good.insufficientEvidence, false);
  assert.equal(good.content.scope, 'this_task');
  assert.equal(good.destination, 'both');
  assert.equal(good.affectedStep, 'toolpath_generation');
  assert.equal(good.evidence.annotationIds.length, 1);
  assert.equal(good.evidence.evidenceDigests.length, 1);
  assert.equal(weak.insufficientEvidence, true);
  // §1.2 names eight things; the seven content fields plus evidence are all present.
  assert.deepEqual([...FIELD_ORDER].sort(), Object.keys(good.content).sort());
});

test('every §1.2 field gets its own words on screen', () => {
  const labels = FIELD_ORDER.map((field) => FIELD_LABELS[field]);
  assert.equal(new Set(labels).size, labels.length, 'two fields sharing a label is a collapse');
});

test('a proposal missing its scope or destination is dropped, never defaulted', () => {
  assert.equal(parseDecisionCard({ ...(GOOD_RAW as object), scope: undefined }), null);
  assert.equal(parseDecisionCard({ ...(GOOD_RAW as object), destination: 'activate' }), null);
  assert.equal(parseDecisionCard({ ...(GOOD_RAW as object), id: 'not-a-uuid' }), null);
  assert.equal(parseDecisionCards('nope' as unknown).length, 0);
  assert.equal(parseDecisionCards([GOOD_RAW, null, 7]).length, 1);
});

test('an insufficient_evidence card is visible and refused for acceptance, with a reason', () => {
  const [, weak] = cards();
  assert.equal(canAccept(weak), false);
  assert.match(acceptBlockedReason(weak)!, /does not justify this yet/);
  const result = applyDecisionAction(cards(), { type: 'accept', id: weak.id });
  assert.equal(result.ok, false);
  assert.match((result as { refusal: string }).refusal, /does not justify this yet/);
});

test('editing clears insufficient_evidence ONLY when the Coach supplied the required words', () => {
  const [, weak] = cards();
  // A scope-only edit changes reach, not evidence. The flag must survive it.
  const scopeOnly = applyDecisionAction(cards(), { type: 'edit', id: weak.id, content: { scope: 'this_agent' } });
  assert.equal(scopeOnly.ok, true);
  const afterScope = (scopeOnly as { cards: readonly CoachDecisionCard[] }).cards.find((c) => c.id === weak.id)!;
  assert.equal(afterScope.insufficientEvidence, true);
  assert.equal(canAccept(afterScope), false);

  const supplied = applyDecisionAction((scopeOnly as { cards: readonly CoachDecisionCard[] }).cards, {
    type: 'edit', id: weak.id,
    content: { trigger: 'when the fixture shifts', selectedTreatment: 're-zero first', rationale: 'the datum moved' },
  });
  const afterWords = (supplied as { cards: readonly CoachDecisionCard[] }).cards.find((c) => c.id === weak.id)!;
  assert.equal(afterWords.insufficientEvidence, false);
  assert.equal(afterWords.editedByCoach, true);
  assert.equal(afterWords.disposition, 'edited');
  assert.equal(canAccept(afterWords), true);
});

test('a required field emptied by an edit blocks acceptance and names the field', () => {
  const [good] = cards();
  const emptied = applyDecisionAction(cards(), { type: 'edit', id: good.id, content: { rationale: '   ' } });
  const card = (emptied as { cards: readonly CoachDecisionCard[] }).cards.find((c) => c.id === good.id)!;
  assert.match(acceptBlockedReason(card)!, new RegExp(FIELD_LABELS.rationale.toLowerCase()));
  for (const field of REQUIRED_FIELDS) assert.ok(FIELD_LABELS[field]);
});

test('a decision that names no moment from the recording cannot be confirmed', () => {
  const [good] = cards();
  const orphan: CoachDecisionCard = { ...good, evidence: { annotationIds: [], evidenceDigests: [] } };
  assert.match(acceptBlockedReason(orphan)!, /names no moment/);
});

test('an over-long answer is refused rather than truncated', () => {
  const [good] = cards();
  const result = applyDecisionAction(cards(), {
    type: 'edit', id: good.id, content: { rationale: 'x'.repeat(DECISION_TEXT_MAX + 1) },
  });
  assert.equal(result.ok, false);
  assert.match((result as { refusal: string }).refusal, new RegExp(String(DECISION_TEXT_MAX)));
});

test('accepting moves only that card, and accepting twice is refused', () => {
  const [good] = cards();
  const first = applyDecisionAction(cards(), { type: 'accept', id: good.id });
  assert.equal(first.ok, true);
  const next = (first as { cards: readonly CoachDecisionCard[] }).cards;
  assert.equal(acceptedDecisions(next).length, 1);
  assert.equal(next.find((c) => c.id !== good.id)!.disposition, 'proposed');
  const again = applyDecisionAction(next, { type: 'accept', id: good.id });
  assert.equal(again.ok, false);
  assert.match((again as { refusal: string }).refusal, /already accepted/);
});

test('a merge keeps the merged card readable, names its target, and unions the evidence', () => {
  const [good, weak] = cards();
  const result = applyDecisionAction(cards(), { type: 'merge', id: weak.id, intoId: good.id });
  assert.equal(result.ok, true);
  const next = (result as { cards: readonly CoachDecisionCard[] }).cards;
  const mergedCard = next.find((c) => c.id === weak.id)!;
  const target = next.find((c) => c.id === good.id)!;
  assert.equal(mergedCard.disposition, 'merged');
  assert.equal(mergedCard.mergedIntoId, good.id);
  // NOT deleted: §3.4 requires every proposal to keep its source annotation ids.
  assert.equal(mergedCard.evidence.annotationIds.length, 1);
  assert.deepEqual(
    [...target.evidence.annotationIds].sort(),
    [...new Set([...good.evidence.annotationIds, ...weak.evidence.annotationIds])].sort(),
  );
  // Merging IN an unjustified claim makes the TARGET unconfirmable until edited.
  assert.equal(target.insufficientEvidence, true);
  assert.equal(canAccept(target), false);
});

test('a merge into itself, into a terminal card, or from a terminal card is refused', () => {
  const [good, weak] = cards();
  assert.match((applyDecisionAction(cards(), { type: 'merge', id: good.id, intoId: good.id }) as { refusal: string }).refusal, /into itself/);
  const discarded = (applyDecisionAction(cards(), { type: 'discard', id: weak.id }) as { cards: readonly CoachDecisionCard[] }).cards;
  assert.equal(applyDecisionAction(discarded, { type: 'merge', id: good.id, intoId: weak.id }).ok, false);
  assert.equal(applyDecisionAction(discarded, { type: 'merge', id: weak.id, intoId: good.id }).ok, false);
  assert.equal(applyDecisionAction(discarded, { type: 'edit', id: weak.id, content: { rationale: 'x' } }).ok, false);
  assert.equal(applyDecisionAction(cards(), { type: 'merge', id: good.id, intoId: 'gone' }).ok, false);
});

test('discard is terminal and idempotent-refusing', () => {
  const [good] = cards();
  const once = applyDecisionAction(cards(), { type: 'discard', id: good.id });
  const next = (once as { cards: readonly CoachDecisionCard[] }).cards;
  assert.equal(next.find((c) => c.id === good.id)!.disposition, 'discarded');
  assert.match((applyDecisionAction(next, { type: 'discard', id: good.id }) as { refusal: string }).refusal, /already discarded/);
  assert.equal(acceptedDecisions(next).length, 0);
});

test('an unknown id is a readable refusal, never a thrown error', () => {
  const result = applyDecisionAction(cards(), { type: 'accept', id: '00000000-0000-4000-8000-000000000000' });
  assert.equal(result.ok, false);
  assert.match((result as { refusal: string }).refusal, /no longer on this submission/);
});

test('the summary counts unresolved work and names the blocked cards separately', () => {
  assert.match(confirmationSummary(cards()), /0 confirmed · 2 still to decide · 1 needs your words/);
  const [good] = cards();
  const accepted = (applyDecisionAction(cards(), { type: 'accept', id: good.id }) as { cards: readonly CoachDecisionCard[] }).cards;
  assert.match(confirmationSummary(accepted), /1 confirmed/);
});

test('the module offers no way to activate a learning', () => {
  const source = readFileSync(fileURLToPath(new URL('./coach-decision-cards.ts', import.meta.url)), 'utf8');
  // Absence is the guarantee (§5 F0 must-nots). A disabled Activate would still be a
  // promise about what this foundation does.
  assert.doesNotMatch(source, /type:\s*'activate'/);
  assert.doesNotMatch(source, /\bactivate\s*[:(]/i);
  assert.equal(WEAK_RAW && typeof WEAK_RAW === 'object', true);
});
