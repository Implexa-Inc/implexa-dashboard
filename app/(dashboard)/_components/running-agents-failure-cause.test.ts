// node --test "app/(dashboard)/_components/running-agents-failure-cause.test.ts"
//
// THE FAILURE CAUSE, ACTUALLY RENDERED.
//
// `revise-request-lifecycle.test.ts` asserts this surface with `assert.match(source,
// /…/)` — it reads running-agents.tsx as TEXT and never mounts it. That pins the
// expression but proves nothing about what a user sees: it would equally "fail" a
// semantically identical refactor, and it would equally "pass" a card that rendered
// the cause into a hidden node. When the condition widened from `c.status === 'failed'`
// to the three terminal request phases, the only thing standing behind the widening
// was a regex quoting the widening back to itself.
//
// So this mounts the real component against jsdom, feeds it the live-card payload the
// backend actually returns, and reads the resulting DOM. The three cases below are the
// property in full: a persisted cause is SHOWN for every terminal phase that can carry
// one, and a card without a cause INVENTS none.
//
// External boundaries only are stubbed — Supabase session, the backend transport,
// next/link. `statusFromLifecycle`, `parseLiveItems`, the filtering and the card body
// are all the real thing, because they are what the mutations attack.

import test, { before, beforeEach, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { JSDOM } from 'jsdom';

// Both roots and the stubs are passed EXPLICITLY. Under the mutation harness
// `IMPLEXA_MUTANT_ROOT` points at the throwaway tree (where the mutated component
// lives) and `IMPLEXA_SOURCE_ROOT` at the repository; here neither is set and the
// loader's own location is the repository. Nothing is inferred from cwd.
register(new URL('../../../scripts/dom-test-loader.mjs', import.meta.url), {
  data: {
    stubs: {
      'next/link': ['scripts', 'stubs', 'next-link.mjs'],
      '@/lib/supabase/client': ['scripts', 'stubs', 'supabase-client.mjs'],
      '@/lib/api': ['scripts', 'stubs', 'backend-api.mjs'],
    },
  },
});

type Card = Record<string, unknown>;

let React: typeof import('react');
let createRoot: typeof import('react-dom/client').createRoot;
let act: (cb: () => void | Promise<void>) => Promise<void>;
let RunningAgents: unknown;
let dom: JSDOM;
let container: HTMLElement;
let root: { render: (n: unknown) => void; unmount: () => void };
let mounted = false;

/** The exact strings under test — unique, so a match cannot be a coincidence. */
const START_FAILED_CAUSE = 'Executor refused to start: workspace 7f3a is locked by another run.';
const CLAIM_EXPIRED_CAUSE = 'Claim expired after 15m — the Mac never reported back.';

before(async () => {
  dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://dashboard.test/agents' });
  const put = (name: string, value: unknown) =>
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node',
    'MouseEvent', 'Event', 'getComputedStyle', 'localStorage', 'Notification']) {
    put(name, (dom.window as unknown as Record<string, unknown>)[name]);
  }
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  React = await import('react');
  ({ createRoot } = await import('react-dom/client'));
  ({ act } = await import('react') as unknown as { act: typeof act });
  RunningAgents = (await import('./running-agents.tsx')).default;
});

beforeEach(() => {
  container = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(container);
  mounted = false;
});

// UNMOUNT MUST NOT DEPEND ON THE TEST PASSING. <RunningAgents> polls on a
// setInterval that only its effect cleanup clears, so a failed assertion that skipped
// unmount left a live timer and the process never exited — under `--test-timeout=0`
// that is an infinite hang, and a mutation harness reads a hang as "still running",
// not as a kill. Teardown belongs here, where a thrown assertion cannot skip it.
afterEach(async () => {
  if (!mounted) return;
  try { await act(async () => { root.unmount(); }); } catch { /* already torn down */ }
  mounted = false;
});

after(() => { delete (globalThis as Record<string, unknown>).__IMPLEXA_TEST_BACKEND__; });

/** Mount the real component against a live payload of `cards`. */
async function mount(cards: Card[]) {
  (globalThis as Record<string, unknown>).__IMPLEXA_TEST_BACKEND__ = async () => ({ items: cards });
  await act(async () => {
    root = createRoot(container);
    root.render(React.createElement(RunningAgents as never, { alertsOnly: false } as never));
  });
  // load() is getSession -> callBackend -> setCards: several microtask ticks deep. A
  // macrotask boundary drains all of them INSIDE act, so the state update that paints
  // the cards is the one being asserted on rather than one that lands after the test.
  await act(async () => { await new Promise((r) => dom.window.setTimeout(r, 0)); });
  mounted = true;
}

const text = () => container.textContent || '';

/** A terminal request card as /scheduled-skills/live returns it. `lifecyclePhase` is
 *  what the backend actually sends; `statusFromLifecycle` is what projects it. */
function terminalCard(over: Card): Card {
  return {
    runId: null,
    requestId: `req-${String(over.lifecyclePhase)}`,
    scheduledSkillId: null,
    skillSlug: 'weekly-digest',
    source: 'test',
    status: 'queued',
    since: new Date(Date.now() - 60_000).toISOString(),
    finishedAt: null,
    headline: null,
    failureReason: null,
    ...over,
  };
}

test('a start_failed card renders its persisted failure cause', async () => {
  await mount([terminalCard({ lifecyclePhase: 'start_failed', failureReason: START_FAILED_CAUSE })]);
  assert.match(text(), /Start failed/, 'the card did not reach the start_failed state');
  assert.ok(
    text().includes(START_FAILED_CAUSE),
    `the persisted cause never reached the DOM. Rendered:\n${text()}`,
  );
});

test('a claim_expired card renders its own, different failure cause', async () => {
  await mount([terminalCard({ lifecyclePhase: 'claim_expired', failureReason: CLAIM_EXPIRED_CAUSE })]);
  assert.ok(
    text().includes(CLAIM_EXPIRED_CAUSE),
    `the persisted cause never reached the DOM. Rendered:\n${text()}`,
  );
});

test('both terminal phases show their OWN cause when rendered together', async () => {
  // Together, because a condition that collapses the two phases into one would still
  // satisfy either test alone.
  await mount([
    terminalCard({ lifecyclePhase: 'start_failed', failureReason: START_FAILED_CAUSE }),
    terminalCard({ lifecyclePhase: 'claim_expired', failureReason: CLAIM_EXPIRED_CAUSE }),
  ]);
  assert.ok(text().includes(START_FAILED_CAUSE), 'start_failed lost its cause alongside claim_expired');
  assert.ok(text().includes(CLAIM_EXPIRED_CAUSE), 'claim_expired lost its cause alongside start_failed');
});

test('a plainly failed card still renders its cause', async () => {
  const cause = 'Step 3 of 5 exited 1: ffmpeg not found on PATH.';
  await mount([terminalCard({ lifecyclePhase: 'failed', failureReason: cause })]);
  assert.ok(text().includes(cause), `the persisted cause never reached the DOM. Rendered:\n${text()}`);
});

test('a terminal card with NO persisted cause invents none', async () => {
  // The 2026-07-23 rule this surface was built under: an undiagnosed failure must read
  // as "we do not know yet", never as a guessed cause. The card still renders — it is
  // the CAUSE LINE that must be absent, not the card.
  await mount([terminalCard({ lifecyclePhase: 'start_failed', failureReason: null })]);
  assert.match(text(), /Start failed/, 'the card itself vanished');
  assert.doesNotMatch(text(), /Executor refused|Claim expired|exited 1/,
    'a cause was rendered for a run that never reported one');
  // Nothing from the neighbouring cases leaked in either.
  assert.equal(text().includes(START_FAILED_CAUSE), false);
});
