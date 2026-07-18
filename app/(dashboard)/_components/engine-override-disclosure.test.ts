// node --test "app/(dashboard)/_components/engine-override-banner.test.ts"
// (Node 22.6+ strips the types natively)
//
// Deterministic disclosure (2026-07-18 review, Stage C #3): computeOverrideDisclosure
// is the pure decision half of <EngineOverrideBanner /> — testable without a JSX
// render pipeline. All 5 scenarios manually verified against the real component's
// JSX by inspection (auth middleware blocks an isolated browser preview of this
// route without a real login, which is out of scope here).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeOverrideDisclosure } from './engine-override-disclosure.ts';

test('a real pin override (codex pinned, ran on claude) discloses', () => {
  const d = computeOverrideDisclosure('codex', 'claude', 'Claude is the only compatible ready engine');
  assert.ok(d);
  assert.equal(d!.pinLabel, 'Codex');
  assert.equal(d!.ranLabel, 'Claude');
  assert.equal(d!.selectionReason, 'Claude is the only compatible ready engine');
});

test('the reverse override (claude pinned, ran on codex) discloses', () => {
  const d = computeOverrideDisclosure('claude', 'codex', null);
  assert.ok(d);
  assert.equal(d!.pinLabel, 'Claude');
  assert.equal(d!.ranLabel, 'Codex');
  assert.equal(d!.selectionReason, null);
});

test('pin matches actual executor — NOT an override, renders nothing', () => {
  assert.equal(computeOverrideDisclosure('claude', 'claude', 'ok'), null);
  assert.equal(computeOverrideDisclosure('codex', 'codex', 'ok'), null);
});

test('agent was never pinned (auto) — the router\'s own free choice, not disclosed', () => {
  assert.equal(computeOverrideDisclosure('auto', 'codex', 'x'), null);
  assert.equal(computeOverrideDisclosure(null, 'claude', 'x'), null);
  assert.equal(computeOverrideDisclosure(undefined, 'claude', 'x'), null);
});

test('missing selectedExecutor (unmigrated / no run_requests row) — renders nothing, never guesses', () => {
  assert.equal(computeOverrideDisclosure('codex', null, 'x'), null);
  assert.equal(computeOverrideDisclosure('codex', undefined, 'x'), null);
});

test('an unrecognized engine id still discloses with the raw id as its own label (forward-compatible)', () => {
  const d = computeOverrideDisclosure('codex', 'some-future-engine', 'reason');
  assert.ok(d);
  assert.equal(d!.ranLabel, 'some-future-engine');
});
