// node --test "app/(dashboard)/_components/training-review-render.test.ts"
//
// REAL DOM, not a regex over JSX. Every property below is a statement about what a
// Coach SEES, and the failures they prevent are all invisible to a source assertion:
//
//   · a privacy promise reworded during a refactor into something untrue;
//   · six lifecycle facts rendering as one undifferentiated list;
//   · an `insufficient_evidence` proposal hidden, or confirmed with one click;
//   · a confirmed teaching rendering as though it had taught the Agent something;
//   · an inert candidate that looks exactly like an active learning; and
//   · an unreadable record rendering as a calm, empty one.
//
// Every projection rendered below is a state the BACKEND producer emitted.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { render } from '../../../lib/test/render.ts';
import {
  ACTIVE_LEARNING_HEADING, EVIDENCE_PREVIEW_NOTICE, INERT_CANDIDATE_BODY,
  INERT_CANDIDATE_HEADING, INSUFFICIENT_EVIDENCE_HEADING,
  PRIVACY_SCOPE_NOTICE, PROJECTION_UNAVAILABLE,
} from '../../../lib/training-review-copy.ts';

/**
 * HARD-CODED, not imported.
 *
 * `text().includes(PRIVACY_PROMISE)` is a tautology — reword the constant and the
 * assertion rewords with it. The mutation harness proved that: the "§2.4 promise
 * reworded into an untrue, stronger claim" mutant SURVIVED against the imported
 * version. These two are transcribed from the spec and from
 * `lib/training-review-copy.ts`'s pinned wording, and `lib/training-review-copy.test.ts`
 * pins the constants themselves.
 */
const SPEC_2_4_PROMISE = 'The full recording stays on this Mac. Only the moments you select, '
  + 'their transcript, and the evidence needed to verify the teaching are saved to your '
  + 'private Agent history.';
const SPEC_2_4_QUALIFIER = 'Selected moments do leave this Mac. Implexa cannot tell you whether '
  + 'a recording contains a secret — you choose what is on screen and which moments you keep.';
const NO_UPLOAD = 'Implexa has not uploaded any recording.';
import { LIFECYCLE_FACT_KEYS, factLabel } from '../../../lib/training-review-lifecycle.ts';
import { parseTrainingReview } from '../../../lib/training-review-projection.ts';
import {
  TRAINING_PROJECTION_VERSION, TRAINING_REVIEW_CONTRACT_VERSION,
} from '../../../lib/training-review-actions.ts';

const fixture = JSON.parse(readFileSync(
  fileURLToPath(new URL('../../../test-fixtures/training-review-f0.v1.json', import.meta.url)), 'utf8',
));
const REVIEWS = fixture.backend.reviews;

const status = (review: unknown) => parseTrainingReview({ ok: true, review }, {
  projectionVersion: TRAINING_PROJECTION_VERSION,
  contractVersion: TRAINING_REVIEW_CONTRACT_VERSION,
});
const refusedStatus = (body: unknown) => parseTrainingReview(body, {
  projectionVersion: TRAINING_PROJECTION_VERSION,
  contractVersion: TRAINING_REVIEW_CONTRACT_VERSION,
});

/**
 * Assert on COUNTS, never on `assert.equal(element, null)`.
 *
 * A failed equality against a jsdom node makes node:assert inspect the whole DOM tree
 * to build its diff, which does not finish — the test file dies at 40s with no
 * message, and the "failure" looks like an infrastructure problem rather than the
 * assertion it is. Counting keeps the failure readable.
 */
const controlLabels = (rendered: { document: Document }) =>
  [...rendered.document.querySelectorAll('button, a, input[type="submit"]')]
    .map((el) => (el.textContent || '').trim());

const SUBJECT = fixture.backend.subjects.trainingSource;

const roomProps = (review: unknown = REVIEWS.decided, extra: Record<string, unknown> = {}) => ({
  subject: SUBJECT,
  agentName: 'Fixture CAM Agent',
  projection: status(review),
  // No network: every decision resolves locally.
  transport: async () => ({
    status: 200,
    body: { ok: true, status: 'confirmed', canonicalLinkState: 'mint_deferred', influenceState: 'inert' },
  }),
  ...extra,
});

test('the §2.4 privacy promise renders VERBATIM, together with its qualifier', async () => {
  const rendered = await render('training-review-room.tsx', roomProps());
  try {
    const text = rendered.text();
    assert.ok(text.includes(SPEC_2_4_PROMISE), `the §2.4 promise must appear word for word; got:\n${text}`);
    // The promise alone reads as "nothing is uploaded". §2.4 requires the product to
    // say what DOES travel, so the qualifier is not optional.
    assert.ok(text.includes(SPEC_2_4_QUALIFIER), 'the qualifier must be shown with the promise');
    assert.ok(text.includes(EVIDENCE_PREVIEW_NOTICE));
    assert.ok(text.includes(PRIVACY_SCOPE_NOTICE));
    // And it must never claim the stronger, false thing.
    assert.doesNotMatch(text, /nothing (is |gets |ever )?(uploaded|leaves)/i);
    assert.doesNotMatch(text, /no secrets/i);
  } finally { rendered.cleanup(); }
});

test('with no server custody note, the room still says plainly that nothing was uploaded', async () => {
  const noNote = { ...REVIEWS.decided, source: { ...REVIEWS.decided.source, custodyNote: null } };
  const rendered = await render('training-review-room.tsx', roomProps(noNote));
  try {
    assert.ok(rendered.text().includes(NO_UPLOAD));
  } finally { rendered.cleanup(); }
});

test('the room declares the training authority and never names a run', async () => {
  const rendered = await render('training-review-room.tsx', roomProps());
  try {
    const root = rendered.document.querySelector('[data-review-authority]')!;
    assert.equal(root.getAttribute('data-review-authority'), 'training_review');
    assert.equal(root.getAttribute('data-review-subject-kind'), 'training_source');

    // THE SUBJECT IS A DEMONSTRATION, AND THE ROOM SAYS SO. The blanket "the word run
    // never appears" this replaced was wrong: the server's honest inert note is "It
    // does not affect any run", and banning the word would have banned the sentence
    // that makes the guarantee. What must not happen is the room presenting or linking
    // to a RUN as the thing being reviewed.
    assert.match(rendered.text(), /Reviewing work you demonstrated/);
    assert.doesNotMatch(rendered.text(), /Reviewing a result this agent produced/);
    const html = rendered.document.documentElement.innerHTML;
    assert.doesNotMatch(html, /\/runs\//, 'the training room must not link to a run');
    for (const id of Object.values(fixture.backend.subjects.runArtifact as Record<string, string>)) {
      assert.equal(html.includes(id), false, `a run identity (${id}) reached the training room`);
    }
    // F0 MUST-NOTS, AS CONTROLS. The word "activated" appears — the projection has to
    // say "Not activated" — so the guarantee is about what the Coach can DO, and it is
    // asserted over the control labels rather than over prose.
    const labels = controlLabels(rendered);
    for (const forbidden of [/record/i, /activate/i, /microphone/i, /screen/i, /run now/i, /schedule/i]) {
      assert.equal(labels.filter((label) => forbidden.test(label)).length, 0,
        `a control matching ${forbidden} exists: ${labels.join(' | ')}`);
    }
    assert.equal(rendered.document.querySelectorAll('input[type="file"], video, audio').length, 0);
  } finally { rendered.cleanup(); }
});

test('the six lifecycle facts render as six distinct rows with six distinct labels', async () => {
  const rendered = await render('training-authority-projection.tsx', { status: status(REVIEWS.decided) });
  try {
    const rows = [...rendered.document.querySelectorAll('[data-fact]')];
    assert.equal(rows.length, 6);
    assert.deepEqual(rows.map((row) => row.getAttribute('data-fact')), [...LIFECYCLE_FACT_KEYS]);
    const texts = rows.map((row) => row.textContent!.trim());
    assert.equal(new Set(texts).size, 6, 'two facts rendered the same sentence — that is the §1.3 collapse');
    for (const key of LIFECYCLE_FACT_KEYS) {
      assert.ok(rendered.text().includes(factLabel(key)), `${key} has no label on screen`);
    }
    // Statuses are carried per-row, so a collapse to one badge is detectable. F0 states
    // exactly two of the six: a demonstration exists, and nothing was activated.
    assert.deepEqual(
      rows.map((row) => row.getAttribute('data-fact-status')),
      ['unknown', 'yes', 'unknown', 'unknown', 'unknown', 'no'],
    );
  } finally { rendered.cleanup(); }
});

test('an unread fact is styled differently from a NO fact, and worded differently too', async () => {
  const rendered = await render('training-authority-projection.tsx', { status: status(REVIEWS.decided) });
  try {
    const byKey = Object.fromEntries(
      [...rendered.document.querySelectorAll('[data-fact]')].map((row) => [row.getAttribute('data-fact'), row]),
    );
    const unread = byKey.implemented!; const no = byKey.activated!;
    assert.equal(unread.getAttribute('data-fact-status'), 'unknown');
    assert.equal(no.getAttribute('data-fact-status'), 'no');
    const cls = (el: Element) => el.querySelector('span')!.className;
    assert.notEqual(cls(unread), cls(no), 'unread rendered in the same tone as "did not happen"');
    assert.match(unread.textContent!, /No revision has been made from this teaching yet/);
    assert.match(no.textContent!, /Future runs behave exactly as they did before/);
  } finally { rendered.cleanup(); }
});

test('an activation state we could not read is neither inert nor active', async () => {
  const { learning, ...unread } = REVIEWS.decided;
  const rendered = await render('training-authority-projection.tsx', { status: status(unread) });
  try {
    assert.equal(rendered.document.querySelector('[data-stance]')!.getAttribute('data-stance'), 'unknown');
    assert.equal(rendered.text().includes(INERT_CANDIDATE_HEADING), false);
    assert.equal(rendered.text().includes(ACTIVE_LEARNING_HEADING), false);
  } finally { rendered.cleanup(); }
});

test('an inert candidate and an active learning are structurally different on screen', async () => {
  const inert = await render('training-authority-projection.tsx', { status: status(REVIEWS.decided) });
  try {
    const panel = inert.document.querySelector('[data-stance]')!;
    assert.equal(panel.getAttribute('data-stance'), 'inert_candidate');
    assert.ok(inert.text().includes(INERT_CANDIDATE_HEADING));
    assert.ok(inert.text().includes(INERT_CANDIDATE_BODY));
    assert.match(inert.text(), /Future runs behave exactly as they did before/);
    // The server's own count sentence, verbatim.
    assert.match(inert.text(), /Nothing here has changed the Agent/);
    assert.equal(inert.text().includes(ACTIVE_LEARNING_HEADING), false);
  } finally { inert.cleanup(); }

  // Not reachable in F0 — the backend reports zero — but it MUST render differently on
  // the day it is, or the panel is decorative.
  const activatedReview = {
    ...REVIEWS.decided,
    learning: { activatedCount: 1, versionsCreated: 1, note: 'One teaching is active.' },
  };
  const active = await render('training-authority-projection.tsx', { status: status(activatedReview) });
  try {
    const panel = active.document.querySelector('[data-stance]')!;
    assert.equal(panel.getAttribute('data-stance'), 'active_learning');
    assert.ok(active.text().includes(ACTIVE_LEARNING_HEADING));
    assert.equal(active.text().includes(INERT_CANDIDATE_HEADING), false);
  } finally { active.cleanup(); }
});

test('a stale recording is announced, not buried', async () => {
  const rendered = await render('training-authority-projection.tsx', { status: status(REVIEWS.staleRecording) });
  try {
    const alert = rendered.document.querySelector('[data-source-integrity="stale"]')!;
    assert.ok(alert, 'a stale recording must be called out');
    assert.match(alert.textContent!, /changed after the review began/);
    assert.equal(alert.getAttribute('role'), 'alert');
  } finally { rendered.cleanup(); }
});

test('an unreadable record says it could not be read, and does not render as empty', async () => {
  const rendered = await render('training-authority-projection.tsx', {
    status: refusedStatus({ ok: false, reason: 'agent_not_owned', error: 'That training session is not yours.' }),
  });
  try {
    assert.ok(rendered.text().includes(PROJECTION_UNAVAILABLE));
    assert.match(rendered.text(), /agent_not_owned/);
    assert.equal(rendered.document.querySelectorAll('[data-fact]').length, 0);
    assert.equal(rendered.document.querySelector('[data-projection-live]')!.getAttribute('data-projection-live'), 'false');
    assert.doesNotMatch(rendered.text(), /nothing here yet/i);
  } finally { rendered.cleanup(); }
});

test('no filesystem path reaches the rendered record', async () => {
  const leaky = {
    ...REVIEWS.decided,
    source: { ...REVIEWS.decided.source, custodyNote: '/Users/coach/Movies/demo.mov' },
  };
  const rendered = await render('training-authority-projection.tsx', { status: status(leaky) });
  try {
    assert.doesNotMatch(rendered.document.documentElement.innerHTML, /\/Users\//);
  } finally { rendered.cleanup(); }
});

// ── Decision cards ────────────────────────────────────────────────────────────────

const decidedStatus = status(REVIEWS.decided);
const decidedCards = decidedStatus.live ? decidedStatus.review.decisions : [];
/** The same two cards, as the Coach first meets them: undecided. */
const openCards = decidedCards.map((card) => ({ ...card, status: 'proposed' as const, decided: false }));

test('every §1.2 field is on the card, and insufficient_evidence is SHOWN not hidden', async () => {
  const rendered = await render('coach-decision-cards.tsx', { cards: openCards });
  try {
    const cards = [...rendered.document.querySelectorAll('[data-decision-id]')];
    assert.equal(cards.length, 2, 'a weak proposal must not be filtered out of the list');
    const weak = cards.find((card) => card.getAttribute('data-insufficient-evidence') === 'true')!;
    assert.ok(weak, 'the insufficient-evidence card must be rendered');
    assert.ok(rendered.text().includes(INSUFFICIENT_EVIDENCE_HEADING));
    // The compiler's own reason, not a generic sentence.
    assert.match(weak.textContent!, /never shows the feed rate being chosen/);
    const good = cards.find((card) => card.getAttribute('data-insufficient-evidence') === 'false')!;
    for (const field of ['triggerText', 'rejectedTreatment', 'selectedTreatment', 'rationale',
      'invariantText', 'exceptionText']) {
      assert.ok(good.querySelector(`[data-field="${field}"]`), `${field} missing from the card`);
    }
    assert.match(good.textContent!, /chamfer the edge to 0.5mm/i);
  } finally { rendered.cleanup(); }
});

test('confirming an insufficient_evidence card is refused, and the reason is on screen', async () => {
  const rendered = await render('coach-decision-cards.tsx', { cards: openCards });
  try {
    const weak = rendered.document.querySelector('[data-insufficient-evidence="true"]')!;
    const confirm = [...weak.querySelectorAll('button')].find((b) => b.textContent === 'Confirm') as HTMLButtonElement;
    assert.equal(confirm.disabled, true);
    // A disabled button with no explanation is how a user concludes the product is
    // broken rather than that the recording did not justify the claim.
    assert.match(weak.textContent!, /does not justify this, so it cannot be confirmed/);
    await rendered.click(confirm);
    assert.equal(weak.getAttribute('data-decision-status'), 'proposed');
  } finally { rendered.cleanup(); }
});

test('a CONFIRMED card says "not yet a learning" and never implies an activation', async () => {
  const rendered = await render('coach-decision-cards.tsx', { cards: decidedCards });
  try {
    const confirmed = rendered.document.querySelector('[data-decision-status="confirmed"]')!;
    assert.equal(confirmed.getAttribute('data-canonical-link-state'), 'mint_deferred');
    assert.equal(confirmed.getAttribute('data-influence-state'), 'inert');
    assert.equal(confirmed.getAttribute('data-learning-standing'), 'confirmed_not_a_learning');
    assert.match(confirmed.textContent!, /not a learning yet/i);
    // No control offers to change that, and no sentence promises it will.
    const text = rendered.text();
    assert.doesNotMatch(text, /\bactivated\b/i);
    assert.doesNotMatch(text, /pending activation|queued|waiting to be activated/i);
    assert.equal(controlLabels(rendered).filter((label) => /activate|promote|publish/i.test(label)).length, 0);
    // A decided card offers no decision controls at all.
    assert.equal(confirmed.querySelectorAll('button').length, 0);
  } finally { rendered.cleanup(); }
});

test('a card linked to an existing candidate reads differently from a deferred one', async () => {
  const linkedStatus = status(REVIEWS.linkedCandidate);
  const linked = linkedStatus.live ? linkedStatus.review.decisions : [];
  const rendered = await render('coach-decision-cards.tsx', { cards: linked });
  try {
    const card = rendered.document.querySelector('[data-decision-id]')!;
    assert.equal(card.getAttribute('data-canonical-link-state'), 'linked_existing');
    assert.equal(card.getAttribute('data-learning-standing'), 'confirmed_linked_inert');
    assert.match(card.textContent!, /inert/i);
    assert.doesNotMatch(rendered.text(), /\bactivated\b/i);
  } finally { rendered.cleanup(); }
});

test('confirm and discard each act on exactly the card they name', async () => {
  const decisions: Array<{ id: string; decision: string }> = [];
  const rendered = await render('coach-decision-cards.tsx', {
    cards: openCards,
    onDecide: async (card: { proposalId: string }, action: { type: string }) => {
      decisions.push({ id: card.proposalId, decision: action.type });
      return null;
    },
  });
  try {
    const good = rendered.document.querySelector('[data-insufficient-evidence="false"]')!;
    const weak = rendered.document.querySelector('[data-insufficient-evidence="true"]')!;
    await rendered.click([...good.querySelectorAll('button')].find((b) => b.textContent === 'Confirm')!);
    await rendered.click([...weak.querySelectorAll('button')].find((b) => b.textContent === 'Discard')!);
    assert.deepEqual(decisions, [
      { id: good.getAttribute('data-decision-id')!, decision: 'confirm' },
      { id: weak.getAttribute('data-decision-id')!, decision: 'discard' },
    ]);
  } finally { rendered.cleanup(); }
});

test('a persistence refusal is shown, and the card does not pretend it moved', async () => {
  const rendered = await render('coach-decision-cards.tsx', {
    cards: openCards,
    onDecide: async () => 'That submission is frozen.',
  });
  try {
    const good = rendered.document.querySelector('[data-insufficient-evidence="false"]')!;
    await rendered.click([...good.querySelectorAll('button')].find((b) => b.textContent === 'Confirm')!);
    assert.match(rendered.text(), /That submission is frozen/);
    assert.ok(rendered.document.querySelector('[role="alert"]'));
    // NOT optimistically confirmed: the server refused, so the card is still open.
    assert.equal(good.getAttribute('data-decision-status'), 'proposed');
  } finally { rendered.cleanup(); }
});

test('the card surface offers exactly two actions, and neither is an activation', async () => {
  const rendered = await render('coach-decision-cards.tsx', { cards: openCards });
  try {
    const labels = [...rendered.document.querySelectorAll('button')].map((b) => b.textContent!.trim());
    // Exactly two actions exist — the two the wire has. Activate is not among them, and
    // not as a disabled control either (§5 F0 must-nots).
    assert.deepEqual([...new Set(labels)].sort(), ['Confirm', 'Discard']);
    assert.equal(rendered.document.querySelectorAll('select').length, 0, 'there is no merge on the wire');
    assert.equal(rendered.document.querySelectorAll('textarea').length, 0, 'there is no edit on the wire');
    for (const forbidden of [/activate/i, /publish/i, /run now/i, /promote/i, /merge/i, /edit/i]) {
      assert.equal(controlLabels(rendered).filter((label) => forbidden.test(label)).length, 0);
    }
  } finally { rendered.cleanup(); }
});

test('an empty decision list says so, rather than rendering nothing at all', async () => {
  const rendered = await render('coach-decision-cards.tsx', { cards: [] });
  try {
    assert.match(rendered.text(), /No decisions have been proposed from this recording yet/);
  } finally { rendered.cleanup(); }
});
