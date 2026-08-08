// node --test lib/review-room-layout.test.ts
//
// The bounded Review Room workspace (#130) and the single inline action (#129).
//
// These read the component source on purpose. The properties below are CSS structure
// and JSX wiring — they have no pure function to call, and the regression they prevent
// (a rail that grows with issue count until the submit button is three screens down)
// is invisible to every behavioural test in this suite. `scripts/mutation-test-
// review-room-orchestration.mjs` re-introduces each failure to prove these assertions
// are load-bearing rather than decorative.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = readFileSync(
  fileURLToPath(new URL('../app/(dashboard)/_components/review-room.tsx', import.meta.url)),
  'utf8',
);

/** The issue rail, from its opening tag to its close. */
const rail = (() => {
  const start = source.indexOf('<aside');
  const end = source.indexOf('</aside>');
  assert.ok(start > 0 && end > start, 'the issue rail could not be located');
  return source.slice(start, end);
})();

// ── the workspace is bounded ────────────────────────────────────────────────

test('REPRO: the workspace is bounded to the viewport, so issues cannot grow the page', () => {
  // Without a height bound the grid is content-sized: every added issue card made the
  // rail taller, which made the PAGE taller, which pushed the actions off screen.
  assert.match(source, /lg:h-\[calc\(100vh-[^\]]+\)\]/,
    'the review workspace has no viewport-relative height bound');
});

test('the bounded workspace keeps a floor for short laptops and high zoom', () => {
  // Below the floor the workspace stops shrinking and the page scrolls instead —
  // which is why the footer is also sticky. Without it, a 13" screen at 150% zoom
  // collapses the rail to a few pixels.
  assert.match(source, /lg:min-h-\[\d+rem\]/, 'the workspace can collapse to nothing');
});

test('the grid row may shrink below its content, or nothing scrolls internally', () => {
  // A grid/flex item's automatic minimum size is its content. `minmax(0,1fr)` is what
  // actually permits the children to be smaller and delegate overflow inward.
  assert.match(source, /lg:grid-rows-\[minmax\(0,1fr\)\]/);
  assert.match(source, /lg:grid-cols-\[minmax\(0,1fr\)_22rem\]/);
});

// ── the rail is a bounded flex column ───────────────────────────────────────

test('the issue rail is a flex column that may shrink below its content', () => {
  const open = rail.slice(0, rail.indexOf('>'));
  assert.match(open, /flex/, 'the rail is not a flex container');
  assert.match(open, /flex-col/, 'the rail is not a column');
  assert.match(open, /min-h-0/, 'without min-h-0 the rail refuses to shrink and the page scrolls');
});

test('narrow and stacked layouts still bound the rail', () => {
  const open = rail.slice(0, rail.indexOf('>'));
  assert.match(open, /max-h-\[\d+vh\]/, 'stacked layouts let the rail grow without limit');
});

test('ONLY the issue list scrolls inside the rail', () => {
  const scrollers = rail.match(/overflow-y-auto/g) ?? [];
  assert.equal(scrollers.length, 1,
    `expected exactly one scrolling region in the rail, found ${scrollers.length}`);
  // And it is the list: the scrolling element is the one that may shrink and absorb
  // the free space.
  assert.match(rail, /min-h-0 flex-1 overflow-y-auto/,
    'the scrolling region is not the flex-1/min-h-0 list');
});

test('the rail header does not scroll away with the list', () => {
  assert.match(rail, /shrink-0 border-b border-ink-800/,
    'the rail header is not held out of the scrolling region');
});

// ── the footer stays reachable ──────────────────────────────────────────────

test('REPRO: the submission footer is sticky and cannot be pushed off screen', () => {
  const footer = rail.slice(rail.indexOf('submission footer'));
  assert.ok(footer.length > 0, 'the submission footer could not be located');
  // Matched INSIDE a className, not anywhere in the slice: the comment above this
  // footer explains the classes by name, so a loose /sticky bottom-0/ matched the
  // prose and passed happily with the classes removed. Mutation caught that.
  assert.match(footer, /className="sticky bottom-0[^"]*shrink-0/,
    'the footer is not a sticky, non-shrinking element');
});

test('the sticky footer is opaque, since the issue list slides beneath it', () => {
  const footer = rail.slice(rail.indexOf('submission footer'));
  // A translucent footer lets issue cards read through the buttons.
  assert.match(footer, /bg-ink-900(?![/\d])/, 'the sticky footer has no opaque background');
});

// ── file-first chronology ───────────────────────────────────────────────────

test('REPRO: the rail renders artifact GROUPS, not one globally sorted list', () => {
  assert.match(rail, /groups\.map\(/, 'the rail is not rendering grouped issues');
  assert.doesNotMatch(rail, /\{visible\.map\(/,
    'the rail still renders one flat, globally sorted issue list');
});

test('grouping is keyed by artifact id, so duplicate filenames stay separate', () => {
  assert.match(rail, /key=\{group\.artifactId \?\? 'whole-run'\}/,
    'the group key is not the artifact id');
});

test('each file group prints a sticky header with its own issue count', () => {
  assert.match(rail, /sticky top-0/, 'file headers do not stick while the list scrolls');
  assert.match(rail, /groupCountLabel\(group\.count\)/, 'file headers do not print an issue count');
  assert.match(rail, /\{group\.displayName\}/, 'file headers do not print the filename');
});

test('the grouped issues come from the chronology module, not a local re-sort', () => {
  assert.match(source, /groupIssuesByArtifact\(visible, artifacts\)/,
    'the rail is not grouped by the audited chronology rules');
});

test('clicking an issue still switches to its artifact and seeks locally', () => {
  assert.match(rail, /onClick=\{\(\) => goToIssue\(i\)\}/);
});

// ── the single inline action ────────────────────────────────────────────────

test('REPRO: the revision note sits inline, immediately above the action', () => {
  const footer = rail.slice(rail.indexOf('submission footer'));
  const note = footer.indexOf('Additional instructions for this revision');
  const primary = footer.indexOf('{submitView.primaryLabel}');
  assert.ok(note > 0, 'the inline revision note composer is missing');
  assert.ok(primary > 0, 'the primary action is missing');
  assert.ok(note < primary, 'the note must appear above the action it belongs to');
});

test('the note is presented as supplementing the issues, never replacing them', () => {
  assert.match(rail, /doesn't replace them/,
    'the composer does not say the note supplements the structured issues');
});

test('the primary and secondary copy come from the audited state machine', () => {
  assert.match(rail, /\{submitView\.primaryLabel\}/);
  assert.match(rail, /\{submitView\.secondaryLabel\}/);
});

test('REPRO: no unrelated next action appears in the decision path', () => {
  // The production failure showed "Approve Next Action" — and, in the acceptance run,
  // an unrelated Generate B-roll recommendation — beside written feedback.
  assert.doesNotMatch(rail, /Generate B-roll/i);
  assert.doesNotMatch(rail, /Continue work/i);
});

test('the approval gate is reachable ONLY through the zero-draft branch', () => {
  const gates = rail.match(/Approve next action/gi) ?? [];
  assert.equal(gates.length, 1, 'the second approval page is offered from more than one branch');
  // And that branch is guarded by the actions module, which refuses it wherever a
  // draft exists — proven exhaustively in review-room-state.test.ts.
  assert.match(rail, /acts\.showApproveNextAction \?/);
});

test('the queued state links to the continuation and closes resubmission', () => {
  const footer = rail.slice(rail.indexOf('submission footer'));
  assert.match(footer, /submitView\.mode === 'queued'/);
  assert.match(footer, /submitView\.continuationId &&/,
    'the queued state offers a link without checking a continuation exists');
});

test('REPRO: only a durable response may leave the submitting state', () => {
  // Without the failure transition the room sits on "Sending…" forever after a
  // refusal — the drafts survive, but the reviewer has no way back to the action.
  assert.match(source, /const durable = await onSubmit\(\);/,
    'the room does not check whether the response was durable');
  assert.match(source, /if \(!durable\) setLocalSubmission\(failSubmission\(sending, ''\)\);/,
    'a refused submission leaves the room stuck in submitting');
});

test('durable session state, not local memory, decides what the room shows', () => {
  assert.match(source, /phaseForSession\(\{/);
  assert.match(source, /sessionState: session\?\.state/);
  assert.match(source, /submittedIssueIds: session\?\.submittedIssueIds/,
    'a reloaded queued session cannot state its count without the durable ids');
});

// ── the note is not collected until the contract exists ─────────────────────

test('the note composer is disabled while the submission cannot carry it', () => {
  assert.match(source, /const NOTE_ENABLED = false/,
    'the note is being collected before Backend #160 defines how to send it');
  assert.match(rail, /disabled=\{!submitView\.noteEnabled\}/);
});

test('the submission call is unchanged — no invented note field on the wire', () => {
  const actions = readFileSync(fileURLToPath(new URL('./review-actions.ts', import.meta.url)), 'utf8');
  const submit = actions.slice(actions.indexOf("case 'submit'"), actions.indexOf("case 'accept'"));
  assert.match(submit, /body: \{\}/, 'the submit action invented a request body');
  assert.doesNotMatch(submit, /note/i, 'a revision-note field was added before its contract exists');
});
