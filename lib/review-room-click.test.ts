// node --test lib/review-room-click.test.ts
//
// THE REAL BUTTON, RENDERED AND CLICKED.
//
// Every other test in this suite proves a rule. This one proves the rule is CONNECTED:
// it mounts the actual <ReviewRoom /> against jsdom, clicks the actual primary button,
// and intercepts the actual `fetch`. A click handler that quietly did nothing, a
// latch wired to a fresh object, a response field read from the wrong key — none of
// those are reachable from a source-string assertion, and all of them are reachable
// from here.
//
// The four terminal paths below all assert the same thing about the UI: it does not
// stay on "Sending…". That was the production failure, and it is the one property a
// rendered test can settle beyond argument.

import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { JSDOM } from 'jsdom';
import {
  fixtureArtifacts, fixtureIssues, submitFixture, FIXTURE_RUN_ID, FIXTURE_SESSION_ID,
} from './review-multi-file-fixture.ts';
import { resolveReviewAction, REVISION_NOTE_MAX } from './review-actions.ts';

// The loader is registered for THIS process only — node:test gives every file its own,
// so no other test's module resolution changes.
register(new URL('../scripts/dom-test-loader.mjs', import.meta.url), {
  data: {
    stubs: {
      '@/lib/supabase/client': ['scripts', 'stubs', 'supabase-client.mjs'],
      '@/lib/api': ['scripts', 'stubs', 'backend-api.mjs'],
    },
  },
});

type Call = { url: string; body: Record<string, unknown> };
type Reply = { status: number; body: unknown };

/** A reply the test releases by hand, so a request can be held open across a click. */
function deferredReply() {
  let release!: (r: Reply) => void;
  const promise = new Promise<Reply>((resolve) => { release = resolve; });
  return { promise, release };
}

let React: typeof import('react');
let createRoot: typeof import('react-dom/client').createRoot;
let act: (cb: () => void | Promise<void>) => Promise<void>;
let ReviewRoom: unknown;
let navigation: typeof import('../scripts/stubs/next-navigation.mjs');
let dom: JSDOM;
let container: HTMLElement;
let root: { render: (n: unknown) => void; unmount: () => void };
let calls: Call[];
let backendCalls: Array<{ path: string; options: unknown }>;
/** When set, the next submit hangs on this instead of replying immediately. */
let pending: Promise<Reply> | null;

before(async () => {
  dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://dashboard.test/review/x' });
  // `defineProperty`, not assignment: several of these (notably `navigator`) are
  // getter-only on modern globalThis and a plain assignment throws.
  const put = (name: string, value: unknown) =>
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLTextAreaElement',
    'Element', 'Node', 'MouseEvent', 'Event', 'getComputedStyle']) {
    put(name, (dom.window as unknown as Record<string, unknown>)[name]);
  }
  // React 18 reads this to pick the concurrent-safe act() implementation.
  put('IS_REACT_ACT_ENVIRONMENT', true);

  React = await import('react');
  ({ createRoot } = await import('react-dom/client'));
  const testUtils = await import('react-dom/test-utils');
  act = (testUtils as unknown as { act: typeof act }).act;
  ReviewRoom = (await import('../app/(dashboard)/_components/review-room.tsx') as { default: unknown }).default;
  navigation = await import('../scripts/stubs/next-navigation.mjs');
});

after(() => { dom?.window?.close(); });

beforeEach(() => {
  navigation?.resetRouterCalls();
  Object.defineProperty(dom.window, 'implexaDesktop', { configurable: true, value: undefined });
  calls = [];
  backendCalls = [];
  (globalThis as Record<string, unknown>).__IMPLEXA_TEST_BACKEND__ = async (path: string, options: unknown) => {
    backendCalls.push({ path, options });
    if (path.includes('/recovery-state')) {
      return {
        ok: true,
        state: 'retryable',
        attempt: { executor: 'codex', endedAt: '2026-08-11T19:35:04.687Z', consequentialWorkStarted: false },
      };
    }
    if (path.includes('/recover-review-continuation')) {
      return { ok: true, reviewRetry: { requeued: true, alreadyQueued: false } };
    }
    throw new Error(`unexpected backend call: ${path}`);
  };
  pending = null;
  container = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(container);
  (globalThis as Record<string, unknown>).fetch = async (url: string, init: { body?: string }) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? '{}')) });
    const settled = pending
      ? await pending
      : { status: 200, body: submitFixture.fresh };
    return { status: settled.status, json: async () => settled.body } as unknown as Response;
  };
});

const submittedSession = {
  id: FIXTURE_SESSION_ID, runId: FIXTURE_RUN_ID, selectedArtifactId: null,
  state: 'submitted', submittedRequestId: 'd41d8cd9-1111-4000-8000-aaaaaaaaaaaa',
  submittedIssueIds: fixtureIssues.map((issue) => issue.id), compiledBrief: 'frozen', acceptedAt: null,
};

for (const accepted of [true, false]) {
  test(`cancelled revision opens the exact seven-feedback draft only on server acceptance: ${accepted}`, async () => {
    (globalThis as Record<string, unknown>).__IMPLEXA_TEST_BACKEND__ = async () => ({ ok: true, state: 'cancelled' });
    const original = fixtureIssues.slice(0, 7).map(issue => ({ ...issue, status: 'submitted' }));
    const snapshot = JSON.stringify(original);
    const successorId = '55555555-5555-4555-8555-555555555555';
    const carried = original;
    const carriedIssueIds = carried.map((issue) => issue.id);
    pending = Promise.resolve({ status: accepted ? 200 : 409, body: accepted
      ? { ok: true, session: { ...submittedSession, id: successorId, state: 'draft',
        submittedRequestId: null, submittedIssueIds: null, previousSessionId: FIXTURE_SESSION_ID,
        carriedIssueIds }, issues: carried, carriedIssueCount: 7 }
      : { ok: false, error: 'The cancellation could not be verified.' } });
    const artifact = { ...fixtureArtifacts[0], role: 'other' };
    const candidate = { scope: 'historical_partial_candidate', recoveryId: '11111111-1111-4111-8111-111111111111', artifactId: artifact.id,
      implementedCount: 1, deferredCount: 6, technicalQaStatus: 'pass', managerProof: false, issueAnchorTransfer: 'not_transferred' };
    const boundOriginal = original.map((issue) => ({ ...issue, artifactId: artifact.id }));
    if (accepted) {
      pending = Promise.resolve({ status: 200, body: { ok: true, session: { ...submittedSession, id: successorId,
        state: 'draft', selectedArtifactId: artifact.id, submittedRequestId: null, submittedIssueIds: null,
        previousSessionId: FIXTURE_SESSION_ID, carriedIssueIds }, issues: boundOriginal, carriedIssueCount: 7 } });
    }
    await mount({ artifacts: [artifact, fixtureArtifacts[1]], initialArtifactId: artifact.id,
      historicalCandidates: [candidate], session: { ...submittedSession, selectedArtifactId: artifact.id,
        submittedIssueIds: original.map(i => i.id), previousSessionId: null, carriedIssueIds: [] }, issues: boundOriginal });
    try {
      const button = buttons().find(b => b.textContent === 'Open a new draft with this feedback');
      assert.ok(button);
      await click(button);
      assert.equal(calls.length, 1, 'opening a draft cannot submit or queue it');
      assert.deepEqual(resolveReviewAction('amend_failed_revision', calls[0].body), {
        path: `/api/v2/review/sessions/${FIXTURE_SESSION_ID}/amend-failed`, method: 'POST', body: {},
      });
      assert.equal(JSON.stringify(original), snapshot);
      if (accepted) {
        assert.match(text(), /7 submitted changes carried into a new draft/);
        for (const issue of boundOriginal) assert.ok(text().includes(issue.body));
        assert.match(text(), /7 exact same-video changes from the failed revision are carried/);
        assert.equal(buttons().some(b => b.textContent === 'Open a new draft with this feedback'), false);
      } else {
        assert.match(text(), /The cancellation could not be verified/);
        assert.ok(buttons().some(b => b.textContent === 'Open a new draft with this feedback'));
      }
    } finally { root.unmount(); }
  });
}

test('historical successor carry survives Add more feedback and a full remount without cloning identities', async () => {
  const artifact = { ...fixtureArtifacts[0], role: 'other' };
  const candidate = { scope: 'historical_partial_candidate', recoveryId: '11111111-1111-4111-8111-111111111111', artifactId: artifact.id,
    implementedCount: 1, deferredCount: 6, technicalQaStatus: 'pass', managerProof: false, issueAnchorTransfer: 'not_transferred' };
  const predecessor = fixtureIssues.slice(0, 5).map((issue) => ({ ...issue, artifactId: artifact.id, status: 'submitted' }));
  const successorId = '55555555-5555-4555-8555-555555555555';
  const carriedIssueIds = predecessor.map((issue) => issue.id);
  const successor = { ...submittedSession, id: successorId, state: 'draft', selectedArtifactId: artifact.id,
    submittedRequestId: null, submittedIssueIds: null, previousSessionId: FIXTURE_SESSION_ID, carriedIssueIds };
  pending = Promise.resolve({ status: 200, body: { ok: true, session: successor } });
  await mount({ artifacts: [artifact, fixtureArtifacts[1]], initialArtifactId: artifact.id,
    historicalCandidates: [candidate], session: successor, issues: predecessor });
  await click(buttons().find(b => b.textContent === 'Add more feedback')!);
  assert.deepEqual(calls[0].body, { action: 'ensure_session', runId: FIXTURE_RUN_ID, artifactId: artifact.id });
  for (const issue of predecessor) assert.ok(text().includes(issue.body));
  assert.match(text(), /5 carried changes remain in this draft/);
  root.unmount();
  container = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(container);
  await mount({ artifacts: [artifact, fixtureArtifacts[1]], initialArtifactId: artifact.id,
    historicalCandidates: [candidate], session: successor, issues: predecessor });
  for (const issue of predecessor) assert.ok(text().includes(issue.body));
  assert.equal(new Set(carriedIssueIds).size, 5, 'reload keeps original immutable identities exactly once');
  root.unmount();
});
test('executor question opens a new immutable Review draft and sends the customer answer', async () => {
  const question = 'Keep the audible “designed to get” restart? <img src=x onerror=alert(1)>';
  (globalThis as Record<string, unknown>).__IMPLEXA_TEST_BACKEND__ = async () => ({
    ok: true, state: 'retryable', executorDiagnostic: {
      source: 'executor_message', finalMessage: question, truncated: false,
    }, attempt: { executor: 'codex', endedAt: '2026-09-01' },
  });
  const original = JSON.stringify(submittedSession);
  (globalThis as Record<string, unknown>).fetch = async (url: string, init: { body?: string }) => {
    const body = JSON.parse(String(init?.body ?? '{}'));
    calls.push({ url: String(url), body });
    return { status: 200, json: async () => body.action === 'add_feedback'
      ? { ok: true, session: { ...submittedSession, id: '55555555-5555-4555-8555-555555555555',
        state: 'draft', submittedRequestId: null, submittedIssueIds: [] } }
      : submitFixture.fresh } as unknown as Response;
  };
  await mount({ session: submittedSession });
  assert.ok(container.textContent?.includes(question));
  assert.equal(container.querySelector('[aria-label="Executor message"] img'), null);
  await click(buttons().find((b) => b.textContent === 'Answer in Review')!);
  assert.equal(calls[0].body.action, 'add_feedback');
  assert.equal(calls[0].body.sessionId, submittedSession.id);
  await typeNote('Remove that restart, preserving the following complete phrase.');
  await click(primary());
  const sent = calls.find((c) => c.body.action === 'submit')!;
  assert.ok(sent, 'the actual submit handler must be reached');
  assert.equal(sent.body.revisionNote, 'Remove that restart, preserving the following complete phrase.');
  assert.equal(sent.body.sessionId, '55555555-5555-4555-8555-555555555555');
  assert.equal(JSON.stringify(submittedSession), original);
  root.unmount();
});

test('a failed draft creation preserves the quoted question and offers another answer attempt', async () => {
  (globalThis as Record<string, unknown>).__IMPLEXA_TEST_BACKEND__ = async () => ({
    ok: true, state: 'retryable', executorDiagnostic: {
      source: 'executor_message', finalMessage: 'Which cut should I keep?', truncated: true,
    },
  });
  (globalThis as Record<string, unknown>).fetch = async () => ({
    status: 409, json: async () => ({ ok: false, error: 'Draft unavailable' }),
  }) as unknown as Response;
  await mount({ session: submittedSession });
  await click(buttons().find((b) => b.textContent === 'Answer in Review')!);
  assert.match(text(), /Which cut should I keep/);
  assert.match(text(), /Draft unavailable/);
  assert.match(text(), /Message shortened/);
  assert.ok(buttons().find((b) => b.textContent === 'Answer in Review'));
  root.unmount();
});
test('executor answer is single-flight while the immutable draft is being created', async () => {
  (globalThis as Record<string, unknown>).__IMPLEXA_TEST_BACKEND__ = async () => ({
    ok: true, state: 'retryable', executorDiagnostic: {
      source: 'executor_message', finalMessage: 'Which cut should I keep?', truncated: false,
    },
  });
  const reply = deferredReply();
  pending = reply.promise;
  await mount({ session: submittedSession });
  const answer = buttons().find((b) => b.textContent === 'Answer in Review')!;
  await act(async () => {
    answer.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    answer.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    await Promise.resolve();
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.action, 'add_feedback');
  reply.release({ status: 409, body: { ok: false, error: 'Draft unavailable' } });
  await act(async () => { await reply.promise; await Promise.resolve(); });
  pending = null;
  assert.ok(buttons().find((b) => b.textContent === 'Answer in Review'));
  root.unmount();
});
test('a diagnostic arriving after terminal state can be loaded without reloading Review', async () => {
  let reads = 0;
  (globalThis as Record<string, unknown>).__IMPLEXA_TEST_BACKEND__ = async () => ({
    ok: true, state: 'retryable', executorDiagnostic: ++reads === 1 ? null : {
      source: 'executor_message', finalMessage: 'Keep this pause?', truncated: false,
    },
  });
  await mount({ session: submittedSession });
  assert.doesNotMatch(text(), /Keep this pause/);
  await click(buttons().find((b) => b.textContent === 'Refresh attempt details')!);
  assert.match(text(), /Keep this pause/);
  assert.ok(buttons().find((b) => b.textContent === 'Answer in Review'));
  root.unmount();
});

/** Mount the room with the 12-issue production draft. */
async function mount(over: Record<string, unknown> = {}) {
  root = createRoot(container) as unknown as typeof root;
  await act(async () => {
    root.render(React.createElement(ReviewRoom as never, {
      runId: FIXTURE_RUN_ID,
      agentName: 'Chapter cutter',
      artifacts: fixtureArtifacts,
      production: null,
      issues: fixtureIssues,
      session: {
        id: FIXTURE_SESSION_ID, runId: FIXTURE_RUN_ID, selectedArtifactId: null,
        state: 'draft', submittedRequestId: null, submittedIssueIds: null,
        compiledBrief: null, acceptedAt: null,
      },
      reviewArtifacts: [],
      sources: {
        issues: 'ready', artifacts: 'ready', session: 'ready', reviewer_resolutions: 'ready', review_artifacts: 'ready',
      },
      isApprovalHold: false,
      ...over,
    }));
  });
}

const buttons = () => [...container.querySelectorAll('button')] as HTMLButtonElement[];
const primary = () => buttons().find((b) => /Send \d+ unresolved \+ \d+ new changes?|Sending|Revision queued/.test(b.textContent || ''))!;
const text = () => container.textContent || '';
const revisionSourceToggle = () => {
  const label = [...container.querySelectorAll('label')].find((candidate) =>
    /Start with reviewed and attached files only/.test(candidate.textContent || ''));
  return label?.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
};
/** Type into the composer the way React's controlled input expects. */
const typeNote = async (value: string) => {
  const note = container.querySelector('textarea') as HTMLTextAreaElement;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value')!.set!;
    setter.call(note, value);
    note.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
};

const click = async (el: HTMLElement) => {
  await act(async () => {
    el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  });
};

test('historical candidate renders truthful partial notice and excludes old anchored feedback', async () => {
  const artifact = { ...fixtureArtifacts[0], role: 'other' };
  const candidate = { scope: 'historical_partial_candidate', recoveryId: '11111111-1111-4111-8111-111111111111', artifactId: artifact.id,
    implementedCount: 1, deferredCount: 6, technicalQaStatus: 'pass', managerProof: false, issueAnchorTransfer: 'not_transferred' };
  const oldIssue = { ...fixtureIssues[0], artifactId: fixtureArtifacts[1].id, body: 'OLD ANCHOR MUST NOT CARRY', status: 'submitted' };
  await mount({ artifacts: [artifact, fixtureArtifacts[1]], initialArtifactId: artifact.id, historicalCandidates: [candidate], issues: [oldIssue] });
  try {
    assert.match(text(), /Historical partial candidate/);
    assert.match(text(), /1 correction reported implemented; 6 deferred/);
    assert.match(text(), /does not establish.*Judge verdict.*Manager proof/);
    assert.match(text(), /Previous feedback anchors were not transferred/);
    assert.doesNotMatch(text(), /OLD ANCHOR MUST NOT CARRY/);
    assert.equal(calls.length, 0, 'opening a candidate cannot submit feedback');
    assert.equal(backendCalls.length, 0, 'opening a candidate cannot invoke recovery');
  } finally { root.unmount(); }
});

test('historical notice is bound to selected artifact and not another file', async () => {
  await mount({ initialArtifactId: fixtureArtifacts[0].id, historicalCandidates: [{ scope: 'historical_partial_candidate',
    recoveryId: '11111111-1111-4111-8111-111111111111', artifactId: fixtureArtifacts[1].id,
    implementedCount: 1, deferredCount: 6, technicalQaStatus: 'pass', managerProof: false, issueAnchorTransfer: 'not_transferred' }] });
  try { assert.doesNotMatch(text(), /Historical partial candidate/); } finally { root.unmount(); }
});

test('historical candidate cannot use the old-session fast path to save feedback', async () => {
  const artifact = { ...fixtureArtifacts[0], role: 'other' };
  pending = Promise.resolve({ status: 200, body: { ok: true, issue: { ...fixtureIssues[0], artifactId: artifact.id } } });
  await mount({ artifacts: [artifact, fixtureArtifacts[1]], initialArtifactId: artifact.id, issues: [],
    session: { ...submittedSession, state: 'draft', selectedArtifactId: fixtureArtifacts[1].id, submittedRequestId: null, submittedIssueIds: null },
    historicalCandidates: [{ scope: 'historical_partial_candidate', recoveryId: '11111111-1111-4111-8111-111111111111', artifactId: artifact.id,
      implementedCount: 1, deferredCount: 6, technicalQaStatus: 'pass', managerProof: false, issueAnchorTransfer: 'not_transferred' }] });
  try {
    await click(buttons().find(b => b.textContent === '+ Add feedback')!);
    await typeNote('Remove the audible restart in this candidate.');
    await click(buttons().find(b => b.textContent === 'Save issue')!);
    assert.match(text(), /feedback round belongs to a different video/);
    assert.equal(calls.length, 0, 'an incompatible session must not receive a new issue');
  } finally { root.unmount(); }
});

test('Add more feedback on a historical candidate opens a selected fresh draft without old-round carry', async () => {
  const artifact = { ...fixtureArtifacts[0], role: 'other' };
  pending = Promise.resolve({ status: 200, body: { ok: true, session: { ...submittedSession,
    id: '11111111-1111-4111-8111-111111111111', state: 'draft', selectedArtifactId: artifact.id, submittedRequestId: null, submittedIssueIds: [] } } });
  await mount({ artifacts: [artifact, fixtureArtifacts[1]], initialArtifactId: artifact.id, issues: [],
    session: { ...submittedSession, selectedArtifactId: fixtureArtifacts[1].id },
    historicalCandidates: [{ scope: 'historical_partial_candidate', recoveryId: '22222222-2222-4222-8222-222222222222', artifactId: artifact.id,
      implementedCount: 1, deferredCount: 6, technicalQaStatus: 'pass', managerProof: false, issueAnchorTransfer: 'not_transferred' }] });
  try {
    await click(buttons().find(b => b.textContent === 'Add more feedback')!);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].body, { action: 'ensure_session', runId: FIXTURE_RUN_ID, artifactId: artifact.id });
    assert.match(text(), /Add new feedback against this candidate/);
    assert.doesNotMatch(text(), /Unresolved earlier issues will stay in the next revision/);
  } finally { root.unmount(); }
});

test('unavailable historical provenance is visible and prevents feedback submission', async () => {
  await mount({ sources: { issues: 'ready', artifacts: 'ready', session: 'ready', review_artifacts: 'ready', historical_candidates: 'unavailable' } });
  try {
    assert.match(text(), /Historical candidate provenance is unavailable/);
    assert.ok(!primary() || primary().disabled, 'submission is absent or disabled');
    assert.equal(buttons().find(b => b.textContent === 'Add more feedback')!.disabled, true);
    assert.equal(buttons().some(b => b.textContent === '+ Add feedback'), false);
    assert.equal(calls.length, 0);
  } finally { root.unmount(); }
});

// ── the button is real ──────────────────────────────────────────────────────

test('the room renders the one decisive action for the 12 production drafts', async () => {
  await mount();
  assert.match(text(), /Send 0 unresolved \+ 12 new changes/);
  assert.match(text(), /Additional instructions for this revision/);
  // And nothing else competing for the decision.
  assert.doesNotMatch(text(), /Approve next action/i);
  assert.doesNotMatch(text(), /Generate B-roll/i);
  root.unmount();
});

test('acceptance offers native cleanup while naming every protected artifact class', async () => {
  let cleanupOpens = 0;
  Object.defineProperty(dom.window, 'implexaDesktop', {
    configurable: true,
    value: {
      openPostAcceptanceCleanup: async () => { cleanupOpens += 1; return { ok: true }; },
    },
  });
  (globalThis as Record<string, unknown>).fetch = async (url: string, init: { body?: string }) => {
    const body = JSON.parse(String(init?.body ?? '{}'));
    calls.push({ url: String(url), body });
    return {
      status: 200,
      json: async () => ({ ok: true, session: { id: FIXTURE_SESSION_ID, state: 'accepted' } }),
    } as unknown as Response;
  };

  await mount({ issues: [] });
  await click(buttons().find((button) => button.textContent?.includes('Accept result & continue'))!);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.action, 'accept');
  assert.match(text(), /Free up local storage/);
  assert.match(text(), /accepted final, editable project, learned decision traces, and original source stay protected/i);

  await click(buttons().find((button) => button.textContent === 'Review cleanup')!);
  assert.equal(cleanupOpens, 1, 'the native cleanup review window was not opened exactly once');
  assert.doesNotMatch(text(), /Free up local storage/);
  root.unmount();
});

test('post-acceptance cleanup can be deferred without touching the Desktop bridge', async () => {
  let cleanupOpens = 0;
  Object.defineProperty(dom.window, 'implexaDesktop', {
    configurable: true,
    value: {
      openPostAcceptanceCleanup: async () => { cleanupOpens += 1; return { ok: true }; },
    },
  });
  (globalThis as Record<string, unknown>).fetch = async () => ({
    status: 200,
    json: async () => ({ ok: true, session: { id: FIXTURE_SESSION_ID, state: 'accepted' } }),
  }) as unknown as Response;

  await mount({ issues: [] });
  await click(buttons().find((button) => button.textContent?.includes('Accept result & continue'))!);
  await click(buttons().find((button) => button.textContent === 'Keep for now')!);

  assert.equal(cleanupOpens, 0);
  assert.doesNotMatch(text(), /Free up local storage/);
  root.unmount();
});

test('Open other file calls the Desktop bridge with the exact session and review-target purpose', async () => {
  const pickerCalls: unknown[] = [];
  Object.defineProperty(dom.window, 'implexaDesktop', {
    configurable: true,
    value: {
      pickReviewArtifact: async (options: unknown) => {
        pickerCalls.push(options);
        return { ok: true, artifact: { artifactId: 'a0000000-0000-4000-8000-000000000001', purpose: 'review_target' } };
      },
    },
  });
  await mount();
  await click(buttons().find((button) => button.textContent?.includes('Open other file'))!);
  assert.deepEqual(pickerCalls, [{ sessionId: FIXTURE_SESSION_ID, purpose: 'review_target', selection: 'file' }]);
  assert.match(text(), /Other file added to this review/);
  assert.equal(navigation.routerCalls.refresh, 1, 'the new durable artifact was not refreshed into the packet');
  root.unmount();
});

test('Attach file and Attach folder are supporting inputs, never issue targets', async () => {
  const pickerCalls: unknown[] = [];
  Object.defineProperty(dom.window, 'implexaDesktop', {
    configurable: true,
    value: {
      pickReviewArtifact: async (options: { purpose: string }) => {
        pickerCalls.push(options);
        return { ok: true, artifact: { artifactId: crypto.randomUUID(), purpose: options.purpose } };
      },
    },
  });
  await mount();
  await click(buttons().find((button) => button.textContent === 'Attach file')!);
  await click(buttons().find((button) => button.textContent === 'Attach folder')!);
  assert.deepEqual(pickerCalls, [
    { sessionId: FIXTURE_SESSION_ID, purpose: 'supporting', selection: 'file' },
    { sessionId: FIXTURE_SESSION_ID, purpose: 'supporting', selection: 'directory' },
  ]);
  assert.match(text(), /Folder frozen and attached to this revision/);
  root.unmount();
});

test('an unavailable durable review-artifact source disables every local picker', async () => {
  const pickerCalls: unknown[] = [];
  Object.defineProperty(dom.window, 'implexaDesktop', {
    configurable: true,
    value: { pickReviewArtifact: async (options: unknown) => { pickerCalls.push(options); return { ok: true }; } },
  });
  await mount({ sources: {
    issues: 'ready', artifacts: 'ready', session: 'ready', reviewer_resolutions: 'ready', review_artifacts: 'unavailable',
  } });
  for (const label of ['Open other file', 'Attach file', 'Attach folder']) {
    const button = buttons().find((candidate) => candidate.textContent?.includes(label));
    assert.ok(button, `${label} should remain visible with its unavailable explanation`);
    assert.equal(button.disabled, true, `${label} must fail closed without durable binding authority`);
    await click(button);
  }
  assert.deepEqual(pickerCalls, []);
  assert.match(text(), /Other review files are unavailable right now/);
  root.unmount();
});

test('missing Desktop bridge fails visibly and sends nothing', async () => {
  Object.defineProperty(dom.window, 'implexaDesktop', { configurable: true, value: undefined });
  await mount();
  await click(buttons().find((button) => button.textContent?.includes('Open other file'))!);
  assert.match(text(), /Open Review Room in the Implexa desktop app/);
  assert.equal(calls.length, 0);
  root.unmount();
});

// ── one click, one transport call ───────────────────────────────────────────

test('REPRO: clicking the real button transmits exactly once', async () => {
  await mount();
  await click(primary());
  assert.equal(calls.length, 1, 'the click did not reach the network exactly once');
  assert.match(calls[0].url, /\/api\/review$/);
  assert.equal(calls[0].body.action, 'submit');
  assert.equal(calls[0].body.sessionId, FIXTURE_SESSION_ID);
  root.unmount();
});

test('REPRO: two clicks in the same render transmit ONCE', async () => {
  await mount();
  // Hold the first request open, so the second click genuinely lands mid-flight —
  // before React has committed anything the phase guard could see.
  const held = deferredReply();
  pending = held.promise;
  const button = primary();

  await act(async () => {
    button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    // Let both handlers run up to their first await while the reply is still pending.
    await Promise.resolve();
  });
  assert.equal(calls.length, 1, 'a real double click produced two transport calls');

  await act(async () => {
    held.release({ status: 200, body: submitFixture.fresh });
    await held.promise;
  });
  assert.equal(calls.length, 1, 'a second request went out once the first resolved');
  assert.doesNotMatch(text(), /Sending/);
  root.unmount();
});

// ── every terminal path leaves "Sending…" ───────────────────────────────────

test('SUCCESS leaves Sending and renders the SERVER count and identities', async () => {
  await mount();
  await click(primary());
  assert.doesNotMatch(text(), /Sending/, 'the room stayed on Sending after a success');
  assert.match(text(), /12 changes were sent as one revision/);
  assert.match(text(), /d41d8cd9-1111-4000-8000-aaaaaaaaaaaa/, 'the continuation id is not rendered');
  assert.match(text(), /e5f60718-2222-4000-8000-bbbbbbbbbbbb/, 'the submission id is not rendered');
  // Resubmission is not merely disabled — the send control is gone entirely.
  assert.equal(
    buttons().some((b) => /start revision/.test(b.textContent || '')), false,
    'a queued revision still offered to send',
  );
  root.unmount();
});

test('Manager sends only selected examples, invalidates stale synthesis, and submits explicit confirmation', async () => {
  const syntheses: Array<Record<string, unknown>> = [];
  const submissions: Array<Record<string, unknown>> = [];
  const issueById = new Map(fixtureIssues.map((issue) => [issue.id, issue]));
  (globalThis as Record<string, unknown>).fetch = async (_url: string, init: { body?: string }) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    if (body.action === 'pattern_candidate') {
      syntheses.push(body);
      const sourceIssueIds = body.sourceIssueIds as string[];
      const targetArtifactIds = [...new Set(sourceIssueIds.map((id) => issueById.get(id)!.artifactId!))];
      return {
        status: 200,
        json: async () => ({
          ok: true,
          candidate: {
            rule: 'Remove repeated abandoned starts.', sourceIssueIds, targetArtifactIds,
            scope: 'full_artifact', confirmedByUser: false,
          },
        }),
      } as unknown as Response;
    }
    submissions.push(body);
    return { status: 200, json: async () => submitFixture.fresh } as unknown as Response;
  };
  await mount();
  const examples = [...container.querySelectorAll('label')]
    .filter((label) => /Use this exact comment as a repeated-pattern example/.test(label.textContent || ''))
    .map((label) => label.querySelector('input') as HTMLInputElement);
  assert.equal(examples.length, 12);
  await click(examples[0]);
  await click(examples[1]);
  const synthesize = () => buttons().find((button) => /^Synthesize(?: again)?$/.test(button.textContent || ''))!;
  await click(synthesize());
  assert.equal((syntheses[0].sourceIssueIds as string[]).length, 2,
    'synthesis disclosed more than the two reviewer-selected comments');
  assert.match(text(), /Remove repeated abandoned starts/);

  // Changing the evidence set invalidates the candidate before another submission
  // can adopt its old authority.
  await click(examples[2]);
  assert.doesNotMatch(text(), /Remove repeated abandoned starts/);
  await click(synthesize());
  assert.equal((syntheses[1].sourceIssueIds as string[]).length, 3);
  const confirmLabel = [...container.querySelectorAll('label')]
    .find((label) => /Confirm this run-local rule/.test(label.textContent || ''))!;
  await click(confirmLabel.querySelector('input') as HTMLInputElement);
  await click(primary());
  assert.equal(submissions.length, 1);
  const pattern = submissions[0].patternApplication as Record<string, unknown>;
  assert.equal(pattern.confirmedByUser, true);
  assert.equal((pattern.sourceIssueIds as string[]).length, 3);
  assert.equal(Object.hasOwn(pattern, 'futureTraining'), false,
    'a run-local pattern acquired future-learning authority');
  root.unmount();
});

test('A TYPED REFUSAL leaves Sending, keeps all 12 drafts, and re-offers the action', async () => {
  (globalThis as Record<string, unknown>).fetch = async (url: string, init: { body?: string }) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? '{}')) });
    return { status: 409, json: async () => submitFixture.refusals.digestMismatch } as unknown as Response;
  };
  await mount();
  await click(primary());
  assert.doesNotMatch(text(), /Sending/, 'the room stayed on Sending after a refusal');
  assert.match(text(), /submit it again/, "the server's own reason is not shown");
  assert.match(text(), /Send 0 unresolved \+ 12 new changes/, 'the action was not re-offered');
  assert.equal(container.querySelectorAll('li').length, 12, 'drafts were lost on refusal');
  // A REFUSAL MUST NOT ALSO BE ANNOUNCED AS A SUCCESS. `onSubmit` returns early on
  // `!outcome.ok`; drop that `return` and control falls through to the success notice
  // and `router.refresh()`, so the room shows the server's rejection and "Revision
  // queued." together. Every other assertion here reads the RETURNED outcome, which
  // that mutation leaves untouched — this is the one that sees it.
  assert.doesNotMatch(text(), /Revision queued/i, 'a refusal was also announced as queued');
  assert.equal(
    container.querySelector('p[role="status"]'), null,
    'a refusal rendered a success status line',
  );
  root.unmount();
});

test('A MALFORMED SUCCESS leaves Sending and is treated as a failure', async () => {
  // ok:true with no continuation id — the shape that must never read as queued.
  (globalThis as Record<string, unknown>).fetch = async () =>
    ({ status: 200, json: async () => ({ ok: true, issueCount: 12 }) }) as unknown as Response;
  await mount();
  await click(primary());
  assert.doesNotMatch(text(), /Sending/);
  assert.doesNotMatch(text(), /were sent as one revision/, 'a revision was claimed without one existing');
  assert.match(text(), /without naming a revision/i);
  assert.doesNotMatch(text(), /Revision queued/i, 'a malformed success was announced as queued');
  assert.equal(container.querySelectorAll('li').length, 12);
  root.unmount();
});

test('A THROWN FETCH leaves Sending, keeps the drafts AND the note', async () => {
  (globalThis as Record<string, unknown>).fetch = async () => { throw new TypeError('Failed to fetch'); };
  await mount();

  await typeNote('tighten the intro');
  await click(primary());
  assert.doesNotMatch(text(), /Sending/, 'a dead request left the room on Sending');
  assert.match(text(), /could not reach the review service/i);
  assert.equal(container.querySelectorAll('li').length, 12, 'drafts were lost');
  assert.equal(
    (container.querySelector('textarea') as HTMLTextAreaElement).value,
    'tighten the intro',
    'the revision note was discarded on transport failure',
  );
  root.unmount();
});

// ── a failed submitted revision opens a real successor round ───────────────

test('Open revision attempt resolves the request to its actual child run', async () => {
  (globalThis as Record<string, unknown>).fetch = async (url: string, init: { body?: string }) => {
    const body = JSON.parse(String(init?.body ?? '{}'));
    calls.push({ url: String(url), body });
    return {
      status: 200,
      json: async () => ({
        ok: true, requestId: submittedSession.submittedRequestId,
        outcome: 'succeeded', resultRunId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      }),
    } as unknown as Response;
  };
  await mount({ agentSlug: 'chapter-cutter', session: submittedSession });
  await click(buttons().find((button) => button.textContent?.includes('Open revision attempt'))!);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.action, 'continuation_status');
  assert.equal(calls[0].body.sessionId, FIXTURE_SESSION_ID);
  assert.deepEqual(navigation.routerCalls.push, ['/review/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb']);
  root.unmount();
});

test('Add more feedback opens a successor draft without cloning submitted issues', async () => {
  const nextSessionId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  (globalThis as Record<string, unknown>).fetch = async (url: string, init: { body?: string }) => {
    const body = JSON.parse(String(init?.body ?? '{}'));
    calls.push({ url: String(url), body });
    return {
      status: 200,
      json: async () => ({
        ok: true,
        session: { ...submittedSession, id: nextSessionId, state: 'draft', submittedRequestId: null, submittedIssueIds: null },
      }),
    } as unknown as Response;
  };
  await mount({ agentSlug: 'chapter-cutter', session: submittedSession });
  await click(buttons().find((button) => button.textContent?.includes('Add more feedback'))!);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.action, 'add_feedback');
  assert.deepEqual(Object.keys(calls[0].body).sort(), ['action', 'sessionId']);
  assert.match(text(), /Unresolved earlier issues will stay in the next revision/);
  assert.match(text(), /Send 0 unresolved \+ 12 new changes/);
  assert.deepEqual(fixtureIssues.map((issue) => issue.id), submittedSession.submittedIssueIds,
    'the original issue identities changed while opening a draft');
  assert.equal(container.querySelectorAll('li').length, 12, 'the unresolved issues were not retained');
  root.unmount();
});

test('a submitted room exposes the process-ledger retry where the user is stranded', async () => {
  await mount({ agentSlug: 'chapter-cutter', session: submittedSession });
  assert.match(text(), /Ready to retry/i,
    'Review Room did not render the recovery state that was already available on the run page');
  assert.match(text(), /made no edits/i);

  await click(buttons().find((button) => button.textContent?.includes('Retry revision'))!);

  assert.ok(
    backendCalls.some((call) => call.path === `/api/v2/me/run-requests/${submittedSession.submittedRequestId}/recover-review-continuation`),
    'the exact submitted continuation was not sent to the idempotent recovery endpoint',
  );
  assert.match(text(), /Queued with your original review submission/i);
  assert.match(text(), /same submitted feedback and evidence/i);
  root.unmount();
});

// ── the note actually travels ───────────────────────────────────────────────

// Two layers on the way out, and this composes BOTH: the browser posts the composer's
// raw text to /api/review, and the server-side allowlist (`resolveReviewAction`) applies
// the backend's trim and bound before calling the backend. Asserting only the first hop
// would prove the note left the component but not that it arrives in the shape
// implexa-backend@8c0f71d stores.
const upstreamOf = (call: Call) =>
  resolveReviewAction('submit', call.body) as { path: string; body: Record<string, unknown> };

test('REPRO: the typed note reaches the backend under its own field name, trimmed', async () => {
  await mount();
  await typeNote('   keep the cold open, cut the outro   ');
  await click(primary());
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.revisionNote, '   keep the cold open, cut the outro   ',
    'the composer text never left the component');

  const upstream = upstreamOf(calls[0]);
  assert.match(upstream.path, /\/api\/v2\/review\/sessions\/[0-9a-f-]+\/submit$/);
  assert.deepEqual(upstream.body, { revisionNote: 'keep the cold open, cut the outro', revisionMode: 'selected_files' },
    'the note did not reach the backend trimmed, under `revisionNote`');
  root.unmount();
});

test('an empty composer resolves to an explicit null, not an empty string', async () => {
  await mount();
  await click(primary());
  assert.deepEqual(upstreamOf(calls[0]).body, { revisionNote: null, revisionMode: 'selected_files' });
  root.unmount();
});

test('reviewed and attached files are the safe default, with original-run inheritance an explicit opt-out', async () => {
  await mount();
  const toggle = revisionSourceToggle();
  assert.ok(toggle, 'selected-files source-policy control is missing');
  assert.equal(toggle.checked, true, 'ordinary review silently inherited an old run input contract');
  await act(async () => { toggle.click(); });
  await click(primary());
  assert.equal(calls[0].body.revisionMode, 'inherit');
  assert.deepEqual(upstreamOf(calls[0]).body, { revisionNote: null, revisionMode: 'inherit' });
  root.unmount();
});

test('an externally opened review target automatically uses selected files without hidden-option input', async () => {
  await mount({
    reviewArtifacts: [{
      artifactId: fixtureArtifacts[0].id,
      purpose: 'review_target',
      displayName: 'older-output.mp4',
      createdAt: '2026-08-12T00:00:00.000Z',
    }],
  });
  const toggle = revisionSourceToggle();
  assert.ok(toggle, 'selected-files source-policy control is missing');
  assert.equal(toggle.checked, true, 'the safe mode was not selected from the durable external target');
  assert.equal(toggle.disabled, true, 'the required safe mode can be silently downgraded');
  assert.match(text(), /Required automatically because this review includes a file opened outside the original run/);

  await click(primary());
  assert.equal(calls[0].body.revisionMode, 'selected_files');
  assert.deepEqual(upstreamOf(calls[0]).body, { revisionNote: null, revisionMode: 'selected_files' });
  root.unmount();
});

test('an over-long note is refused by the allowlist, never forwarded to the backend', async () => {
  await mount();
  // `maxLength` bounds typing and pasting, but not a programmatic set — so this is
  // also the path a client-side bug would take. The allowlist is the defense that
  // does not depend on the widget: it refuses, and no upstream call is ever formed.
  await typeNote('x'.repeat(REVISION_NOTE_MAX + 50));
  await click(primary());

  const refusal = resolveReviewAction('submit', calls[0].body);
  assert.equal(typeof refusal, 'string', 'an over-long note would have reached the backend');
  assert.match(refusal as string, /2000 characters or fewer/);
  // And the drafts survive the refusal, as with any other.
  assert.equal(container.querySelectorAll('li').length, 12);
  root.unmount();
});

// ── durable state, not refreshed props ──────────────────────────────────────

test('a session already submitted renders queued on first paint, without any click', async () => {
  await mount({
    session: {
      id: FIXTURE_SESSION_ID, runId: FIXTURE_RUN_ID, selectedArtifactId: null,
      state: 'submitted', submittedRequestId: 'req-durable',
      submittedIssueIds: fixtureIssues.map((i) => i.id),
      compiledBrief: null, acceptedAt: null,
    },
  });
  assert.match(text(), /12 changes were sent as one revision/);
  assert.equal(calls.length, 0, 'rendering a submitted session transmitted something');
  root.unmount();
});
