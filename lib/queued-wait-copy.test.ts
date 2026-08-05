import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { queuedWaitNotice, QUEUED_WAIT_MS } from './queued-wait-copy.ts';

const NOW = Date.parse('2026-08-05T18:30:00.000Z');
const queuedAgo = (ms: number) => new Date(NOW - ms).toISOString();
const LONG = QUEUED_WAIT_MS + 60_000;

test('nothing is said before the wait window, or for a non-queued run', () => {
  assert.equal(queuedWaitNotice({ status: 'queued', since: queuedAgo(60_000), nowMs: NOW }), null);
  assert.equal(queuedWaitNotice({ status: 'running', since: queuedAgo(LONG), nowMs: NOW }), null);
  assert.equal(queuedWaitNotice({ status: 'queued', since: null, nowMs: NOW }), null);
  assert.equal(queuedWaitNotice({ status: 'queued', since: 'not-a-date', nowMs: NOW }), null);
});

test('an AUTO-ROUTED request is never described as waiting for Claude', () => {
  const n = queuedWaitNotice({ status: 'queued', since: queuedAgo(LONG), nowMs: NOW })!;
  assert.ok(n);
  const all = `${n.headline} ${n.detail}`;
  assert.doesNotMatch(all, /Claude session/i, 'the run is not waiting on a Claude session');
  assert.doesNotMatch(all, /waiting for (an available )?Claude/i);
  assert.doesNotMatch(all, /once Claude is free/i);
  assert.doesNotMatch(all, /5-hour|five-hour|usage limit\b(?!.*does not block)/i);
  assert.match(n.headline, /Implexa is picking an available engine/i);
});

test('an auto-routed request never claims any engine is unavailable', () => {
  const n = queuedWaitNotice({ status: 'queued', since: queuedAgo(LONG), nowMs: NOW })!;
  const all = `${n.headline} ${n.detail}`;
  for (const engine of ['Claude', 'Codex']) {
    assert.doesNotMatch(all, new RegExp(`${engine}[^.]*\\b(unavailable|is capped|is down|cannot run|can't run)`, 'i'));
  }
  // And it says the opposite of "Claude is capped, so you're stuck".
  assert.match(n.detail, /one being busy or at its usage limit does not block the others/i);
});

test('an engine is named ONLY when the agent is genuinely pinned to it', () => {
  const auto = queuedWaitNotice({ status: 'queued', since: queuedAgo(LONG), nowMs: NOW })!;
  assert.doesNotMatch(auto.headline, /Claude|Codex/);

  for (const [pin, label, other] of [['claude', 'Claude', 'Codex'], ['codex', 'Codex', 'Claude']] as const) {
    const n = queuedWaitNotice({ status: 'queued', since: queuedAgo(LONG), nowMs: NOW, enginePreference: pin })!;
    assert.match(n.headline, new RegExp(`pinned to ${label}`));
    assert.doesNotMatch(n.headline, new RegExp(other));
  }

  // An unknown/garbage pin is NOT a pin — it falls back to the engine-neutral copy
  // rather than guessing one.
  const bogus = queuedWaitNotice({
    status: 'queued', since: queuedAgo(LONG), nowMs: NOW,
    enginePreference: 'gpt' as unknown as 'claude',
  })!;
  assert.deepEqual(bogus, auto);
});

test('a specific block is surfaced ONLY when the backend actually declared one', () => {
  const undiagnosed = queuedWaitNotice({ status: 'queued', since: queuedAgo(LONG), nowMs: NOW })!;
  assert.equal(undiagnosed.block, null, 'no declaration → no block, not a guess');

  for (const blank of [null, undefined, '', '   ']) {
    const n = queuedWaitNotice({ status: 'queued', since: queuedAgo(LONG), nowMs: NOW, declaredBlock: blank })!;
    assert.equal(n.block, null);
  }

  const declared = queuedWaitNotice({
    status: 'queued', since: queuedAgo(LONG), nowMs: NOW,
    declaredBlock: 'No machine has a key for runwayml, so this run cannot start.',
  })!;
  assert.equal(declared.block, 'No machine has a key for runwayml, so this run cannot start.');
  // The declaration is shown verbatim; the reassurance never contradicts it by
  // asserting a different cause.
  assert.doesNotMatch(declared.detail, /because|most often that means/i);
});

test('the reassurance never asserts a cause', () => {
  for (const pin of [null, 'claude', 'codex'] as const) {
    const n = queuedWaitNotice({ status: 'queued', since: queuedAgo(LONG), nowMs: NOW, enginePreference: pin })!;
    assert.doesNotMatch(n.detail, /most often|usually means|probably|likely means/i);
  }
});

// ── the component must actually use this ────────────────────────────────────
// A pure helper nothing renders is not a fix. This pins the call site AND that the
// retired sentence has not been left behind anywhere in the dashboard.

test('running-agents renders the notice and no longer hard-codes the Claude-only copy', () => {
  const src = readFileSync(new URL('../app/(dashboard)/_components/running-agents.tsx', import.meta.url), 'utf8');
  assert.match(src, /import \{ queuedWaitNotice \} from '@\/lib\/queued-wait-copy'/);
  assert.match(src, /queuedWaitNotice\(\{/, 'the component must call the helper');
  assert.doesNotMatch(src, /available Claude session/i, 'the retired sentence must be gone');
  assert.doesNotMatch(src, /once Claude is free again/i);
  // The block is rendered only when present.
  assert.match(src, /queuedWait\.block &&/);
});
