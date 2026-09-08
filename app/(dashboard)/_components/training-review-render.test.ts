// node --test "app/(dashboard)/_components/training-review-render.test.ts"
//
// REAL DOM, not a regex over JSX. Every property below is a statement about what a
// Coach SEES, and the failures they prevent are all invisible to a source assertion:
//
//   · a privacy promise reworded during a refactor into something untrue;
//   · six lifecycle facts rendering as one undifferentiated list;
//   · an `insufficient_evidence` proposal hidden, or accepted with one click;
//   · an inert candidate that looks exactly like an active learning; and
//   · an unreadable record rendering as a calm, empty one.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { render } from '../../../lib/test/render.ts';
import {
  ACTIVE_LEARNING_HEADING, EVIDENCE_PREVIEW_NOTICE, INERT_CANDIDATE_BODY,
  INERT_CANDIDATE_HEADING, INSUFFICIENT_EVIDENCE_BODY, INSUFFICIENT_EVIDENCE_HEADING,
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
import { parseTrainingProjection } from '../../../lib/training-review-projection.ts';
import { TRAINING_CONTRACT_VERSION } from '../../../lib/training-review-actions.ts';

const fixture = JSON.parse(readFileSync(
  fileURLToPath(new URL('../../../test-fixtures/training-review-f0.v1.json', import.meta.url)), 'utf8',
));

const status = (raw: unknown) => parseTrainingProjection(raw, TRAINING_CONTRACT_VERSION);

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
const SUBJECT = fixture.subject;
const SUBMISSION = fixture.responses.submitAnnotations.submissionId as string;

const roomProps = (raw: unknown = fixture.projection, extra: Record<string, unknown> = {}) => ({
  subject: SUBJECT,
  agentName: 'Fixture CAM Agent',
  projection: status(raw),
  submissionId: SUBMISSION,
  // No network: every confirm resolves locally.
  transport: async () => ({ status: 200, body: { ok: true, candidateId: '77777777-7777-4777-8777-777777777777' } }),
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
    assert.ok(text.includes(NO_UPLOAD));
    // And it must never claim the stronger, false thing.
    assert.doesNotMatch(text, /nothing (is |gets |ever )?(uploaded|leaves)/i);
    assert.doesNotMatch(text, /no secrets/i);
  } finally { rendered.cleanup(); }
});

test('the room declares the training authority and never names a run', async () => {
  const rendered = await render('training-review-room.tsx', roomProps());
  try {
    const root = rendered.document.querySelector('[data-review-authority]')!;
    assert.equal(root.getAttribute('data-review-authority'), 'training_review');
    assert.equal(root.getAttribute('data-review-subject-kind'), 'training_source');
    assert.doesNotMatch(rendered.text(), /\brun\b/i);
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
  const rendered = await render('training-authority-projection.tsx', { status: status(fixture.projection) });
  try {
    const rows = [...rendered.document.querySelectorAll('[data-fact]')];
    assert.equal(rows.length, 6);
    assert.deepEqual(rows.map((row) => row.getAttribute('data-fact')), [...LIFECYCLE_FACT_KEYS]);
    const texts = rows.map((row) => row.textContent!.trim());
    assert.equal(new Set(texts).size, 6, 'two facts rendered the same sentence — that is the §1.3 collapse');
    for (const key of LIFECYCLE_FACT_KEYS) {
      assert.ok(rendered.text().includes(factLabel(key)), `${key} has no label on screen`);
    }
    // Statuses are carried per-row, so a collapse to one badge is detectable.
    assert.deepEqual(
      rows.map((row) => row.getAttribute('data-fact-status')),
      ['yes', 'yes', 'no', 'no', 'no', 'no'],
    );
  } finally { rendered.cleanup(); }
});

test('an unread fact is styled differently from a NO fact', async () => {
  const rendered = await render('training-authority-projection.tsx', { status: status(fixture.projectionUnreadableState) });
  try {
    const byKey = Object.fromEntries(
      [...rendered.document.querySelectorAll('[data-fact]')].map((row) => [row.getAttribute('data-fact'), row]),
    );
    const unread = byKey.implemented!; const no = byKey.accepted!;
    assert.equal(unread.getAttribute('data-fact-status'), 'unknown');
    assert.equal(no.getAttribute('data-fact-status'), 'no');
    const cls = (el: Element) => el.querySelector('span')!.className;
    assert.notEqual(cls(unread), cls(no), 'unread rendered in the same tone as "did not happen"');
    assert.match(unread.textContent!, /does not mean it did not happen/);
  } finally { rendered.cleanup(); }
});

test('an inert candidate and an active learning are structurally different on screen', async () => {
  const inert = await render('training-authority-projection.tsx', { status: status(fixture.projection) });
  try {
    const panel = inert.document.querySelector('[data-stance]')!;
    assert.equal(panel.getAttribute('data-stance'), 'inert_candidate');
    assert.ok(inert.text().includes(INERT_CANDIDATE_HEADING));
    assert.ok(inert.text().includes(INERT_CANDIDATE_BODY));
    assert.match(inert.text(), /Future runs behave exactly as they did before/);
    assert.equal(inert.text().includes(ACTIVE_LEARNING_HEADING), false);
  } finally { inert.cleanup(); }

  const active = await render('training-authority-projection.tsx', { status: status(fixture.projectionActivated) });
  try {
    const panel = active.document.querySelector('[data-stance]')!;
    assert.equal(panel.getAttribute('data-stance'), 'active_learning');
    assert.ok(active.text().includes(ACTIVE_LEARNING_HEADING));
    assert.equal(active.text().includes(INERT_CANDIDATE_HEADING), false);
  } finally { active.cleanup(); }
});

test('an unreadable record says it could not be read, and does not render as empty', async () => {
  const rendered = await render('training-authority-projection.tsx', { status: status(fixture.projectionRefused) });
  try {
    assert.ok(rendered.text().includes(PROJECTION_UNAVAILABLE));
    assert.match(rendered.text(), /That training session is not yours/);
    assert.equal(rendered.document.querySelectorAll('[data-fact]').length, 0);
    assert.doesNotMatch(rendered.text(), /nothing here yet/i);
  } finally { rendered.cleanup(); }
});

test('an unread activation state is neither inert nor active — it says it is unread', async () => {
  const rendered = await render('training-authority-projection.tsx', { status: status(fixture.projectionAllUnknown) });
  try {
    assert.equal(rendered.document.querySelector('[data-stance]')!.getAttribute('data-stance'), 'unknown');
    assert.equal(rendered.text().includes(INERT_CANDIDATE_HEADING), false);
    assert.equal(rendered.text().includes(ACTIVE_LEARNING_HEADING), false);
  } finally { rendered.cleanup(); }
});

test('no filesystem path reaches the rendered record', async () => {
  const rendered = await render('training-authority-projection.tsx', { status: status(fixture.projectionPathLeak) });
  try {
    assert.doesNotMatch(rendered.document.documentElement.innerHTML, /\/Users\//);
  } finally { rendered.cleanup(); }
});

// ── Decision cards ────────────────────────────────────────────────────────────────

const cardProps = (extra: Record<string, unknown> = {}) => ({
  cards: status(fixture.projection).live
    ? (status(fixture.projection) as { projection: { decisions: unknown[] } }).projection.decisions
    : [],
  ...extra,
});

test('every §1.2 field is on the card, and insufficient_evidence is SHOWN not hidden', async () => {
  const rendered = await render('coach-decision-cards.tsx', cardProps());
  try {
    const cards = [...rendered.document.querySelectorAll('[data-decision-id]')];
    assert.equal(cards.length, 2, 'a weak proposal must not be filtered out of the list');
    const weak = cards.find((card) => card.getAttribute('data-insufficient-evidence') === 'true')!;
    assert.ok(weak, 'the insufficient-evidence card must be rendered');
    assert.ok(rendered.text().includes(INSUFFICIENT_EVIDENCE_HEADING));
    assert.ok(rendered.text().includes(INSUFFICIENT_EVIDENCE_BODY));
    const good = cards.find((card) => card.getAttribute('data-insufficient-evidence') === 'false')!;
    for (const field of ['trigger', 'rejectedTreatment', 'selectedTreatment', 'rationale', 'invariant', 'exception', 'scope']) {
      assert.ok(good.querySelector(`[data-field="${field}"]`), `${field} missing from the card`);
    }
    assert.match(good.textContent!, /Rough the pocket/);
  } finally { rendered.cleanup(); }
});

test('accepting an insufficient_evidence card is refused, and the reason is on screen', async () => {
  const rendered = await render('coach-decision-cards.tsx', cardProps());
  try {
    const weak = rendered.document.querySelector('[data-insufficient-evidence="true"]')!;
    const accept = [...weak.querySelectorAll('button')].find((b) => b.textContent === 'Accept') as HTMLButtonElement;
    assert.equal(accept.disabled, true);
    // A disabled button with no explanation is how a user concludes the product is
    // broken rather than that they have something left to write.
    assert.match(weak.textContent!, /does not justify this yet/);
    await rendered.click(accept);
    assert.equal(weak.getAttribute('data-disposition'), 'proposed');
  } finally { rendered.cleanup(); }
});

test('accept, discard and merge each move exactly the card they name', async () => {
  const rendered = await render('coach-decision-cards.tsx', cardProps());
  try {
    const good = rendered.document.querySelector('[data-insufficient-evidence="false"]')!;
    const weak = rendered.document.querySelector('[data-insufficient-evidence="true"]')!;
    const accept = [...good.querySelectorAll('button')].find((b) => b.textContent === 'Accept')!;
    assert.equal((accept as HTMLButtonElement).disabled, false);
    await rendered.click(accept);
    assert.equal(good.getAttribute('data-disposition'), 'accepted');
    assert.equal(weak.getAttribute('data-disposition'), 'proposed');
    assert.match(rendered.text(), /1 confirmed/);

    const discard = [...weak.querySelectorAll('button')].find((b) => b.textContent === 'Discard')!;
    await rendered.click(discard);
    assert.equal(weak.getAttribute('data-disposition'), 'discarded');
    assert.equal(good.getAttribute('data-disposition'), 'accepted');
  } finally { rendered.cleanup(); }
});

test('a persistence refusal is shown, and the Coach edit is not silently reverted', async () => {
  const rendered = await render('coach-decision-cards.tsx', cardProps({
    onConfirm: async () => 'That submission is frozen.',
  }));
  try {
    const good = rendered.document.querySelector('[data-insufficient-evidence="false"]')!;
    await rendered.click([...good.querySelectorAll('button')].find((b) => b.textContent === 'Accept')!);
    assert.match(rendered.text(), /That submission is frozen/);
    assert.ok(rendered.document.querySelector('[role="alert"]'));
  } finally { rendered.cleanup(); }
});

test('the card surface offers no way to activate a learning', async () => {
  const rendered = await render('coach-decision-cards.tsx', cardProps());
  try {
    const labels = [...rendered.document.querySelectorAll('button')].map((b) => b.textContent!.trim());
    // Exactly four actions exist, and Activate is not one of them — not disabled,
    // absent (§5 F0 must-nots). Merge is a <select>, so it is checked separately.
    assert.deepEqual([...new Set(labels)].sort(), ['Accept', 'Discard', 'Edit']);
    assert.equal(rendered.document.querySelectorAll('select[aria-label^="Merge"]').length, 2);
    for (const forbidden of [/activate/i, /publish/i, /run now/i, /promote/i]) {
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
