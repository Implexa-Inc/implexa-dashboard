// node --test lib/jsx-source.test.ts
//
// The scanner two guard files now depend on (run-input-surface-parity.test.ts and
// setup-tiers.test.ts) had no test of its own, which is the worst place for a gap:
// every regression in it fails those guards OPEN. A present-prop assertion starts
// failing on correct code; an absent-prop assertion starts PASSING on code that has
// it. So the failure modes are pinned directly, starting with the one that put this
// file here — a '>' inside a prop value, which /<Tag[^>]*>/ cannot survive.

import test from 'node:test';
import assert from 'node:assert/strict';
import { openingElements, propValue } from './jsx-source.ts';

// ── the hazard that motivated the file ──────────────────────────────────────

test('REPRO: a prop value containing ">" does not truncate the element', () => {
  // Exactly what a naive /<Card[^>]*>/ gets wrong: it stops inside the arrow
  // function and never sees `surface`, so "Setup mounts with surface=setup"
  // fails on code that is perfectly correct.
  const src = '<Card onSaved={() => refresh()} surface="setup" runInputs={resolved} />';
  const [el] = openingElements(src, 'Card');
  assert.equal(propValue(el, 'surface'), '"setup"');
  assert.equal(propValue(el, 'runInputs'), 'resolved');
});

test('a bare comparison inside braces is not the end of the element', () => {
  const [el] = openingElements('<Card wide={a > b} surface="setup" />', 'Card');
  assert.equal(propValue(el, 'wide'), 'a > b');
  assert.equal(propValue(el, 'surface'), '"setup"');
});

test('nested JSX in a prop is spanned, not truncated', () => {
  const [el] = openingElements('<Card icon={<Badge tone="warn" />} surface="setup" />', 'Card');
  assert.equal(propValue(el, 'icon'), '<Badge tone="warn" />');
  assert.equal(propValue(el, 'surface'), '"setup"');
});

// ── element identification ──────────────────────────────────────────────────

test('a longer component whose name starts with the tag is not mistaken for it', () => {
  // <AgentActionsFooter> must not be read as an <AgentActions> render site, or a
  // parity guard audits the wrong element and reports the wrong file.
  assert.deepEqual(openingElements('<AgentActionsFooter slug={s} />', 'AgentActions'), []);
  assert.equal(openingElements('<AgentActions slug={s} />', 'AgentActions').length, 1);
});

test('every render site is returned, in source order', () => {
  const src = '<Card a={1} />\n<Other />\n<Card b={2}>\n</Card>';
  assert.deepEqual(openingElements(src, 'Card'), ['<Card a={1} />', '<Card b={2}>']);
});

test('a tag that never appears yields nothing rather than throwing', () => {
  assert.deepEqual(openingElements('<Other />', 'Card'), []);
});

// ── prop reading ────────────────────────────────────────────────────────────

test('a missing prop reads as null, distinctly from a prop whose value IS null', () => {
  // The distinction the parity guard is built on: "you forgot it" and "you passed
  // a literal null" are different findings with different fixes.
  const [el] = openingElements('<Card runInputs={null} />', 'Card');
  assert.equal(propValue(el, 'runInputs'), 'null');
  assert.equal(propValue(el, 'proficiency'), null);
});

test('a quoted value keeps its quotes, so foo="null" is never read as foo={null}', () => {
  const [el] = openingElements('<Card surface="null" other={null} />', 'Card');
  assert.equal(propValue(el, 'surface'), '"null"');
  assert.equal(propValue(el, 'other'), 'null');
});

test('REPRO: a prop name that PREFIXES another is not read off that other prop', () => {
  // inputContract / inputContractDigest are both required by the envelope guard.
  // A prefix match would read the digest's value as the contract's and pass a
  // surface that is missing one of them.
  const [el] = openingElements('<A inputContractDigest={digest} />', 'A');
  assert.equal(propValue(el, 'inputContract'), null, 'inputContract is absent here');
  assert.equal(propValue(el, 'inputContractDigest'), 'digest');

  const [both] = openingElements('<A inputContract={c} inputContractDigest={d} />', 'A');
  assert.equal(propValue(both, 'inputContract'), 'c');
  assert.equal(propValue(both, 'inputContractDigest'), 'd');
});

test('a prop name that SUFFIXES another is not matched mid-name either', () => {
  const [el] = openingElements('<A myRunInputs={x} />', 'A');
  assert.equal(propValue(el, 'RunInputs'), null);
  assert.equal(propValue(el, 'runInputs'), null);
});

test('nested braces in a value are balanced, not stopped at the first close', () => {
  const [el] = openingElements('<Card style={{ a: { b: 1 } }} surface="setup" />', 'Card');
  assert.equal(propValue(el, 'style'), '{ a: { b: 1 } }');
  assert.equal(propValue(el, 'surface'), '"setup"');
});

test('a multi-line element reads the same as a one-line one', () => {
  const [el] = openingElements(
    '<Card\n  checklist={checklist}\n  surface="setup"\n  runInputs={workflowRunInputs(workflow)}\n/>',
    'Card',
  );
  assert.equal(propValue(el, 'checklist'), 'checklist');
  assert.equal(propValue(el, 'runInputs'), 'workflowRunInputs(workflow)');
});

test('a boolean shorthand prop has no value expression to report', () => {
  // `isActive` (as the activation card passes it) is present but valueless — the
  // guards must not read the NEXT prop's value as if it belonged to it.
  const [el] = openingElements('<A isActive slug={s} />', 'A');
  assert.equal(propValue(el, 'isActive'), null);
  assert.equal(propValue(el, 'slug'), 's');
});
