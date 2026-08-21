// node --test "app/(dashboard)/_components/running-agents-continuity.render.test.ts"
//
// The continuity rules, graded against a REAL DOM across REAL successive polls.
//
// lib/live-lifecycle-continuity.test.ts grades the rules. This grades the
// WIRING of those rules into <RunningAgents/> — which is where the production
// defect actually lived: the rule was never wrong, it simply was not there.
// `setCards(items)` replaced the whole collection on every readable response, so
// a successful response that omitted an in-flight request erased its card.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const REQ = '5b3c1755-c563-433d-90cb-f7024de2f05a';   // the production request id
const OTHER_REQ = '11111111-1111-1111-1111-111111111111';
const RUN = '22222222-2222-2222-2222-222222222222';
const POLL_MS = 10;

type Card = Record<string, unknown>;
type Step = { items?: Card[]; fail?: boolean };

function prep(over: Card = {}): Card {
  return {
    runId: null, requestId: REQ, scheduledSkillId: null, skillSlug: 'clean-cut',
    source: 'dashboard', status: 'preparing_inputs', lifecyclePhase: 'preparing_inputs',
    since: '2026-08-21T09:58:00.000Z', bytesRead: 970, totalBytes: 1000,
    cancelable: true, preparationCancelable: true, isTerminal: false, ...over,
  };
}

/**
 * A live-feed backend the TEST steps, not the clock.
 *
 * The component polls on a timer, so a fixed sleep lets responses outrun the
 * assertions — a test that sometimes grades the wrong step is worse than no
 * test. Instead the backend serves the step the test has RELEASED and keeps
 * re-serving it, however many polls arrive, until the test releases the next.
 */
function scriptedBackend(steps: Step[]) {
  let released = 0;
  let lastServed = -1;
  let polls = 0;
  return {
    lastServed: () => lastServed,
    polls: () => polls,
    release: (index: number) => { released = Math.min(index, steps.length - 1); },
    fn: (path: string) => {
      if (!path.startsWith('/api/v2/scheduled-skills/live')) return { ok: true };
      polls += 1;
      lastServed = released;
      const step = steps[released];
      if (step.fail) throw new Error('network');
      return { items: step.items ?? [], count: (step.items ?? []).length };
    },
  };
}

async function renderFeed(steps: Step[]) {
  const { render } = await import('../../../lib/test/render.ts');
  const backend = scriptedBackend(steps);
  const rendered = await render('running-agents.tsx', { pollMs: POLL_MS }, { backend: backend.fn });
  const flush = async (ms: number) => {
    await rendered.act(async () => { await new Promise((r) => setTimeout(r, ms)); });
  };
  /** Release step `index` and return once a poll has actually delivered it. */
  const at = async (index: number) => {
    const before = backend.polls();
    backend.release(index);
    // A WALL-CLOCK deadline in a suite that runs 144 files concurrently is a
    // flake waiting to happen: the component's interval is 10ms of its own time,
    // but a loaded event loop can take far longer to get there. Generous, and it
    // still fails loudly rather than silently grading the wrong step.
    const deadline = Date.now() + 30_000;
    while ((backend.lastServed() !== index || backend.polls() <= before) && Date.now() < deadline) {
      await flush(POLL_MS);
    }
    assert.equal(backend.lastServed(), index, `the backend never delivered step ${index}`);
    await flush(POLL_MS);   // let React commit the response just delivered
  };
  await at(0);
  return { rendered, backend, at };
}

/** How many agent cards are on screen — one row per live item. */
function cardCount(rendered: { document: Document }): number {
  return rendered.document.querySelectorAll('[class*="rounded-lg"][class*="border-ink-800"]').length;
}

function buttons(rendered: { document: Document }, label: RegExp): HTMLButtonElement[] {
  return [...rendered.document.querySelectorAll('button')]
    .filter((b) => label.test(b.textContent || '')) as HTMLButtonElement[];
}

/** The identity each rendered card is actually keyed by, in render order. */
function renderedKeys(rendered: { document: Document }): string[] {
  return [...rendered.document.querySelectorAll('[data-continuity-key]')]
    .map((el) => el.getAttribute('data-continuity-key') || '');
}

// ── 1 · the incident ─────────────────────────────────────────────────────────
test('Preparing 97%, then a successful poll omits the id — the card stays, and says so', async () => {
  const { rendered, at } = await renderFeed([
    { items: [prep()] },
    { items: [] },            // a well-formed, successful, EMPTY response
  ]);
  try {
    assert.ok(rendered.queryByText(/97% verified/), 'the preparation renders its progress');
    assert.ok(rendered.queryByText(/Preparing file/), 'and its state chip');

    await at(1);
    assert.ok(rendered.queryByText(/Clean Cut/), 'the in-flight card must survive a successful omission');
    assert.ok(rendered.queryByText(/Updating status…/),
      'and must say it is being re-checked rather than presenting a stale state as current');
    assert.equal(cardCount(rendered), 1, 'held, not duplicated');
  } finally { rendered.cleanup(); }
});

// ── 2 · the whole ladder, one card ───────────────────────────────────────────
test('Preparing → Finalizing → Queued → Selecting → Starting → Running renders one card throughout', async () => {
  const { rendered, at } = await renderFeed([
    { items: [prep({ bytesRead: 970 })] },
    { items: [prep({ bytesRead: 1000 })] },
    { items: [prep({ bytesRead: 1000, cancelable: false, preparationCancelable: false })] },
    { items: [prep({ status: 'queued', lifecyclePhase: 'queued', bytesRead: null, totalBytes: null })] },
    { items: [prep({ status: 'selecting', lifecyclePhase: 'selecting_executor', bytesRead: null, totalBytes: null })] },
    { items: [prep({ status: 'starting', lifecyclePhase: 'starting', bytesRead: null, totalBytes: null })] },
    { items: [prep({ status: 'running', lifecyclePhase: 'running', runId: RUN, bytesRead: null, totalBytes: null })] },
  ]);
  try {
    const chips = ['Preparing file', 'Preparing file', 'Preparing file', 'Queued', 'Selecting', 'Starting', 'Running'];
    for (const [step, chip] of chips.entries()) {
      if (step > 0) await at(step);
      assert.ok(rendered.queryByText(new RegExp(chip)), `step ${step}: expected the ${chip} chip`);
      assert.equal(cardCount(rendered), 1, `step ${step}: exactly one card`);
      assert.equal(rendered.queryByText(/Updating status…/), null, `step ${step}: no gap was needed`);
    }
  } finally { rendered.cleanup(); }
});

test('at 100% verified the card persists and simply stops offering Cancel', async () => {
  const { rendered, at } = await renderFeed([
    { items: [prep({ bytesRead: 1000 })] },
    { items: [prep({ bytesRead: 1000, cancelable: false, preparationCancelable: false })] },
  ]);
  try {
    assert.ok(rendered.queryByText(/100% verified/));
    assert.equal(buttons(rendered, /Cancel request/).length, 1, 'still cancellable at 100%, before the fence');
    await at(1);
    assert.ok(rendered.queryByText(/100% verified/), 'finalizing must not make the card disappear');
    assert.equal(buttons(rendered, /Cancel request/).length, 0, 'the fence withdraws cancellation');
  } finally { rendered.cleanup(); }
});

// ── 3 · same-id succession ───────────────────────────────────────────────────
test('a same-id successor replaces its predecessor without duplicating the card', async () => {
  const { rendered, at } = await renderFeed([
    { items: [prep()] },
    { items: [prep({ status: 'running', lifecyclePhase: 'running', runId: RUN, bytesRead: null, totalBytes: null })] },
  ]);
  try {
    assert.equal(cardCount(rendered), 1);
    assert.deepEqual(renderedKeys(rendered), [REQ], 'the preparation renders under its reserved request id');
    await at(1);
    assert.equal(cardCount(rendered), 1, 'the run card IS the request card, not a second one');
    assert.deepEqual(renderedKeys(rendered), [REQ],
      'the identity survives the run handoff — the card does not change hands');
    assert.ok(rendered.queryByText(/Running/));
    assert.equal(rendered.queryByText(/Preparing file/), null);
  } finally { rendered.cleanup(); }
});

// ── 4 · a different request is a different card ──────────────────────────────
test('a different-id item neither replaces the target nor inherits its Cancel', async () => {
  const queued = (over: Card = {}) =>
    prep({ status: 'queued', lifecyclePhase: 'queued', bytesRead: null, totalBytes: null, ...over });
  const { rendered, at } = await renderFeed([
    { items: [queued()] },
    { items: [queued(), queued({ requestId: OTHER_REQ })] },   // same agent, same slug
  ]);
  try {
    await at(1);
    assert.equal(cardCount(rendered), 2, 'a shared slug is not a shared identity');
    assert.deepEqual(renderedKeys(rendered).sort(), [OTHER_REQ, REQ].sort(),
      'each card is keyed by its own request, never by the slug they share');
    const cancels = buttons(rendered, /Cancel request/);
    assert.equal(cancels.length, 2, 'each request owns its own Cancel');

    // Cancel the SECOND card and assert the call names the second request.
    await rendered.click(cancels[1]);
    const confirm = buttons(rendered, /^\s*Cancel run\s*$/)[0];
    assert.ok(confirm, 'the confirm dialog opened');
    await rendered.click(confirm);
    const cancelCalls = rendered.calls.backend.filter((c) => c.path.includes('/run-requests/'));
    assert.equal(cancelCalls.length, 1, 'exactly one cancel was issued');
    assert.ok(cancelCalls[0].path.includes(OTHER_REQ),
      `cancel must name the exact request it was rendered for, got ${cancelCalls[0].path}`);
    assert.ok(!cancelCalls[0].path.includes(REQ), 'the neighbour must not be cancelled');
  } finally { rendered.cleanup(); }
});

// ── 5 · terminal retires retention ───────────────────────────────────────────
test('a terminal state retires retention immediately — no ghost card', async () => {
  const { rendered, at } = await renderFeed([
    { items: [prep({ status: 'running', lifecyclePhase: 'running', runId: RUN, bytesRead: null, totalBytes: null })] },
    {
      items: [prep({
        status: 'failed', lifecyclePhase: 'failed', runId: RUN, isTerminal: true,
        failureReason: 'run_enqueue_interrupted', bytesRead: null, totalBytes: null,
      })],
    },
    { items: [] },
  ]);
  try {
    await at(1);
    assert.ok(rendered.queryByText(/Failed/), 'the terminal state renders');
    await at(2);
    assert.equal(cardCount(rendered), 0, 'a terminal item is not held open across the gap');
    assert.equal(rendered.queryByText(/Updating status…/), null);
  } finally { rendered.cleanup(); }
});

// ── 7 · a failed read discloses rather than deletes ──────────────────────────
test('a fetch failure preserves the last known card and discloses that it is stale', async () => {
  const { rendered, at } = await renderFeed([
    { items: [prep({ status: 'running', lifecyclePhase: 'running', runId: RUN, bytesRead: null, totalBytes: null })] },
    { fail: true },
  ]);
  try {
    assert.ok(rendered.queryByText(/Running/));
    await at(1);
    assert.equal(cardCount(rendered), 1, 'an unreadable answer must not delete what we last knew');
    assert.ok(rendered.queryByText(/Last known status/), 'and must say it could not reach the backend');
    assert.equal(buttons(rendered, /Stop run/).length, 0,
      'a state we are not currently confirming must not offer a destructive action');
  } finally { rendered.cleanup(); }
});

// ── 8 · a successful empty response is not an erasure ────────────────────────
test('a successful EMPTY response does not instantly erase recent work', async () => {
  const { rendered, at } = await renderFeed([
    { items: [prep({ status: 'queued', lifecyclePhase: 'queued', bytesRead: null, totalBytes: null })] },
    { items: [] },
  ]);
  try {
    await at(1);
    assert.equal(cardCount(rendered), 1);
    assert.ok(rendered.queryByText(/Updating status…/));
  } finally { rendered.cleanup(); }
});

// ── 9 · reload converges on backend authority ────────────────────────────────
test('a reload converges on the backend — held state does not survive it', async () => {
  const held = await renderFeed([
    { items: [prep({ status: 'running', lifecyclePhase: 'running', runId: RUN, bytesRead: null, totalBytes: null })] },
    { items: [] },
  ]);
  try {
    await held.at(1);
    assert.equal(cardCount(held.rendered), 1, 'held before the reload');
    assert.ok(held.rendered.queryByText(/Updating status…/));
  } finally { held.rendered.cleanup(); }

  // A fresh mount is a reload: no cache, so an empty backend renders empty.
  const reloaded = await renderFeed([{ items: [] }]);
  try {
    assert.equal(cardCount(reloaded.rendered), 0, 'the cache must be in memory only');
  } finally { reloaded.rendered.cleanup(); }
});

// ── 10 · Cancel renders only for a cancellable, currently-confirmed request ──
test('Cancel renders only in cancellable phases and never on a held card', async () => {
  const { rendered, at } = await renderFeed([
    { items: [prep()] },
    { items: [] },                 // omitted → held
  ]);
  try {
    assert.equal(buttons(rendered, /Cancel request/).length, 1, 'a live preparation is cancellable');
    await at(1);
    assert.ok(rendered.queryByText(/Updating status…/), 'now held');
    assert.equal(buttons(rendered, /Cancel request/).length, 0,
      'we must not offer to cancel work whose current state we are not confirming');
  } finally { rendered.cleanup(); }
});

test('a running card offers Stop, a finished one offers neither Stop nor Cancel', async () => {
  const { rendered, at } = await renderFeed([
    { items: [prep({ status: 'running', lifecyclePhase: 'running', runId: RUN, bytesRead: null, totalBytes: null })] },
    {
      items: [prep({
        status: 'finished', lifecyclePhase: null, runId: RUN, isTerminal: true,
        finishedAt: '2026-08-21T10:05:00.000Z', bytesRead: null, totalBytes: null,
      })],
    },
  ]);
  try {
    assert.equal(buttons(rendered, /Stop run/).length, 1, 'a live run can be stopped');
    assert.equal(buttons(rendered, /Cancel request/).length, 0, 'a running run is past request cancellation');
    await at(1);
    assert.ok(rendered.queryByText(/Finished/));
    assert.equal(buttons(rendered, /Stop run/).length, 0, 'a finished run has nothing to stop');
    assert.equal(buttons(rendered, /Cancel request/).length, 0);
  } finally { rendered.cleanup(); }
});

// ── the dialog acts on NOW, not on a snapshot ────────────────────────────────
test('confirming a cancel after the state moved on does not fire at the old state', async () => {
  const { rendered, at } = await renderFeed([
    { items: [prep()] },
    // While the dialog is open the preparation crosses its finalization fence:
    // the backend has withdrawn cancellation, and confirming must respect that.
    { items: [prep({ bytesRead: 1000, cancelable: false, preparationCancelable: false })] },
  ]);
  try {
    await rendered.click(buttons(rendered, /Cancel request/)[0]);
    assert.ok(rendered.queryByText(/This will cancel/), 'the confirm dialog opened');

    await at(1);   // the fence closes while the user is reading

    const confirm = buttons(rendered, /^\s*Cancel run\s*$/)[0];
    if (confirm) await rendered.click(confirm);
    const cancelCalls = rendered.calls.backend.filter(
      (c) => c.path.includes('/run-input-preparations/') || c.path.includes('/run-requests/'),
    );
    assert.equal(cancelCalls.length, 0,
      'a confirm resolved against a snapshot would have cancelled a request past its fence');
    assert.ok(rendered.queryByText(/100% verified/), 'and the card itself is untouched');
  } finally { rendered.cleanup(); }
});

// ── a cancel that lost the race must not hide the run ───────────────────────
test('a locally cancelled request that ran anyway stays visible, with Stop', async () => {
  const { rendered, at } = await renderFeed([
    { items: [prep({ status: 'queued', lifecyclePhase: 'queued', bytesRead: null, totalBytes: null })] },
    // The cancel lost the race: the executor picked it up and the run is live.
    { items: [prep({ status: 'running', lifecyclePhase: 'running', runId: RUN, bytesRead: null, totalBytes: null })] },
  ]);
  try {
    await rendered.click(buttons(rendered, /Cancel request/)[0]);
    await rendered.click(buttons(rendered, /^\s*Cancel run\s*$/)[0]);
    assert.equal(cardCount(rendered), 0, 'the queued card is hidden optimistically');

    await at(1);
    assert.equal(cardCount(rendered), 1,
      'a run that started anyway must not be hidden by a cancel that did not take');
    assert.ok(rendered.queryByText(/Running/));
    assert.equal(buttons(rendered, /Stop run/).length, 1,
      'and the user must still be able to stop it');
  } finally { rendered.cleanup(); }
});

// ── a control that renders must do something ────────────────────────────────
//
// An in-flight continue has no bound run: the projection yields
// {requestId, runId: null, status: 'running'}. The Stop button gate accepts it
// (status running + a requestId), but if the shared cancellation rule returns no
// target, doCancel takes no branch at all — the dialog closes and the request
// keeps running, silently. The base behaviour PATCHed the request.
test('Stop on a running request with no bound run actually cancels the request', async () => {
  const CONTINUE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const { rendered } = await renderFeed([{
    items: [prep({
      requestId: CONTINUE, runId: null, status: 'running', lifecyclePhase: 'running',
      headline: 'tighten the opening', bytesRead: null, totalBytes: null,
      cancelable: true, preparationCancelable: undefined,
    })],
  }]);
  try {
    const stop = buttons(rendered, /Stop run/);
    assert.equal(stop.length, 1, 'the control renders');
    await rendered.click(stop[0]);
    const confirm = buttons(rendered, /^\s*Stop run\s*$/).filter((b) => b !== stop[0]);
    assert.ok(confirm.length >= 1, 'the confirm dialog opened');
    await rendered.click(confirm[confirm.length - 1]);

    const calls = rendered.calls.backend.filter((c) => c.path.includes('/run-requests/'));
    assert.equal(calls.length, 1, 'a rendered Stop must issue a call, not close the dialog in silence');
    assert.ok(calls[0].path.includes(CONTINUE), `and must name the exact request, got ${calls[0].path}`);
    assert.equal((calls[0].init as { method?: string })?.method, 'PATCH');
  } finally { rendered.cleanup(); }
});

// ── the executor fallback, end to end in the DOM ────────────────────────────
test('a fenced executor fallback reaches the screen instead of freezing on Running', async () => {
  const fallback = prep({
    status: 'switching', lifecyclePhase: 'switching_executor', runId: null,
    fallbackReason: 'the executor was fenced mid-step', cancelable: true,
    bytesRead: null, totalBytes: null,
  });
  const { rendered, at } = await renderFeed([
    { items: [prep({ status: 'running', lifecyclePhase: 'running', runId: RUN, bytesRead: null, totalBytes: null })] },
    { items: [fallback] },
    { items: [fallback] },
    { items: [fallback] },
    { items: [fallback] },
  ]);
  try {
    assert.ok(rendered.queryByText(/Running/));
    for (const step of [1, 2, 3, 4]) await at(step);
    assert.ok(rendered.queryByText(/Switching/),
      'a real step back must reach the screen within a bounded number of polls');
    assert.ok(rendered.queryByText(/the executor was fenced mid-step/),
      'and bring the reason the user needs with it');
    assert.equal(cardCount(rendered), 1);
  } finally { rendered.cleanup(); }
});

// ── the run-plane kill obeys the same freshness rule ────────────────────────
test('confirming a Stop after the card went stale does not fire the kill', async () => {
  const { rendered, at } = await renderFeed([
    { items: [prep({ status: 'running', lifecyclePhase: 'running', runId: RUN, bytesRead: null, totalBytes: null })] },
    { items: [] },   // omitted → the card is held, not confirmed
  ]);
  try {
    await rendered.click(buttons(rendered, /Stop run/)[0]);
    assert.ok(rendered.queryByText(/This will stop/), 'the confirm dialog opened');

    await at(1);   // a poll lands while the user reads

    // The dialog is still open and its confirm button is still there — it has
    // simply stopped calling itself "Stop run", because the card is no longer a
    // state we confirm. CLICK IT ANYWAY: the point is that confirming does
    // nothing, not that the button vanished. (Matching only /Stop run/ here
    // would skip the click entirely on green and assert nothing.)
    const confirm = [...rendered.document.querySelectorAll('button')]
      .filter((b) => /^\s*(Stop run|Cancel run)\s*$/.test(b.textContent || ''));
    assert.ok(confirm.length >= 1, 'the dialog is still open and still confirmable');
    await rendered.click(confirm[confirm.length - 1]);
    const kills = rendered.calls.backend.filter((c) => c.path.includes('/cancel')
      || c.path.includes('/run-requests/'));
    assert.equal(kills.length, 0,
      'a kill must not fire at a state we are no longer confirming');
    assert.ok(rendered.queryByText(/Updating status…/), 'and the card is honest about why');
  } finally { rendered.cleanup(); }
});

// ── the monotonic hold withholds certainty, not just the repaint ────────────
//
// The HELD state itself is graded deterministically in
// lib/live-lifecycle-continuity.test.ts ("a regression-held card offers no
// destructive control while it is held"). A rendered test cannot pin it: the
// hold is counted in polls, the component owns its own timer, and under the
// 144-file concurrent suite the backend has usually already won by the time any
// assertion runs — an earlier draft of this test asserted the held state and was
// silently vacuous in CI for exactly that reason. What a rendered test CAN grade
// is the end state, which is what it grades.
test('a fenced executor fallback reaches the screen with its reason and its control', async () => {
  const fenced = prep({
    status: 'switching', lifecyclePhase: 'switching_executor', runId: null,
    fallbackReason: 'the executor was fenced mid-step', cancelable: true,
    bytesRead: null, totalBytes: null,
  });
  const { rendered, at } = await renderFeed([
    { items: [prep({ status: 'running', lifecyclePhase: 'running', runId: RUN, bytesRead: null, totalBytes: null })] },
    { items: [fenced] }, { items: [fenced] }, { items: [fenced] }, { items: [fenced] },
  ]);
  try {
    assert.equal(buttons(rendered, /Stop run/).length, 1, 'a live run can be stopped');
    for (const step of [1, 2, 3, 4]) await at(step);

    assert.ok(rendered.queryByText(/Switching/),
      'a real step back must reach the screen within a bounded number of polls');
    assert.ok(rendered.queryByText(/the executor was fenced mid-step/),
      'bringing the reason the user needs with it');
    assert.equal(cardCount(rendered), 1);
    // The control the frozen card had been hiding, bound to the request rather
    // than to the run it abandoned.
    assert.equal(buttons(rendered, /Cancel request/).length, 1,
      'a switching request IS cancellable');
    assert.equal(buttons(rendered, /Stop run/).length, 0,
      'and there is no run left to stop');
  } finally { rendered.cleanup(); }
});

// ── a destructive dialog must not reopen by itself ──────────────────────────
//
// The RELEASE path — key outlives its card, card returns, dialog springs back —
// needs the grace window to expire, i.e. 45s of wall time, which a rendered test
// at a 10ms cadence cannot reach. It is graded deterministically in
// lib/live-lifecycle-continuity.test.ts against `resolveConfirmTarget`, and the
// component clears the key whenever that returns null. What a rendered test CAN
// show is that a dialog stays bound to its own card across a gap rather than
// re-targeting something else.
test('a dialog stays bound to its own card across a gap', async () => {
  const running = prep({
    status: 'running', lifecyclePhase: 'running', runId: RUN,
    bytesRead: null, totalBytes: null,
  });
  const { rendered, at } = await renderFeed([
    { items: [running] },
    { items: [prep({ requestId: OTHER_REQ, runId: null, status: 'queued', lifecyclePhase: 'queued', bytesRead: null, totalBytes: null })] },
  ]);
  try {
    await rendered.click(buttons(rendered, /Stop run/)[0]);
    assert.ok(rendered.queryByText(/This will stop/), 'the dialog opened because the user asked');

    // A different request arrives; the held card is still ours.
    await at(1);
    const confirm = [...rendered.document.querySelectorAll('button')]
      .filter((b) => /^\s*(Stop run|Cancel run)\s*$/.test(b.textContent || ''));
    if (confirm.length) await rendered.click(confirm[confirm.length - 1]);

    const calls = rendered.calls.backend.filter((c) => c.path.includes('/cancel')
      || c.path.includes('/run-requests/'));
    for (const call of calls) {
      assert.ok(!call.path.includes(OTHER_REQ),
        `a dialog must never re-target another request, got ${call.path}`);
    }
  } finally { rendered.cleanup(); }
});

test('a dialog does not spring back open when its card returns', async () => {
  // A TERMINAL state retires from the cache immediately — no grace window — so
  // this reaches the release path deterministically at a 10ms cadence, which the
  // 45s omission grace cannot.
  const running = prep({
    status: 'running', lifecyclePhase: 'running', runId: RUN,
    bytesRead: null, totalBytes: null,
  });
  const { rendered, at } = await renderFeed([
    { items: [running] },
    { items: [prep({ status: 'finished', lifecyclePhase: null, runId: RUN, isTerminal: true, finishedAt: '2026-08-21T10:05:00.000Z', bytesRead: null, totalBytes: null })] },
    { items: [] },          // terminal → retired at once, the card is gone
    { items: [running] },   // …and the same request comes back
  ]);
  try {
    await rendered.click(buttons(rendered, /Stop run/)[0]);
    assert.ok(rendered.queryByText(/This will stop/), 'the dialog opened because the user asked');

    await at(1);
    await at(2);
    assert.equal(cardCount(rendered), 0, 'the card is gone, and the dialog with it');

    await at(3);
    assert.equal(cardCount(rendered), 1, 'the request is back');
    assert.equal(rendered.queryByText(/This will stop/), null,
      'a destructive dialog the user did not reopen must not reopen');
    assert.equal(rendered.queryByText(/This will cancel/), null);
  } finally { rendered.cleanup(); }
});
