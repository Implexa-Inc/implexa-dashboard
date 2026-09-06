// node --test "app/(dashboard)/_components/review-continuation-recovery-render.test.ts"
//
// THE RECOVERY SURFACE, ACTUALLY RENDERED.
//
// The 2026-08-11 defect the Dashboard owned was not a wrong string. It was that
// three genuinely different situations — "it is still running", "we cannot prove
// the last attempt ended", "you can retry now" — all reached the user as the
// same grey sentence beside a text box, with nothing to click. A source regex
// would happily pass a panel that computed the right state and rendered the
// wrong control, so these MOUNT the component and read the DOM.
//
// The two properties that cannot be checked any other way:
//   • a refused retry must never render as Queued;
//   • a refusal must never cost the user their note.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { render } from '../../../lib/test/render.ts';

const REQUEST = '76669b5c-bb85-4785-820a-6103cbc90316';
const SUBMISSION = 'a406aa35-614c-44e9-a6c5-daddb960d52f';

const stateReply = (state: string, extra: Record<string, unknown> = {}) =>
  (path: string) => {
    if (path.includes('/recovery-state')) return { ok: true, state, ...extra };
    return { ok: true };
  };

for (const extra of [{}, { runId: 'child' }, { runId: 'child', artifactId: 'output' }, { deliveryVerified: true, runId: 'child' }]) {
  test(`legacy or incomplete completed response cannot announce delivery: ${JSON.stringify(extra)}`, async () => {
    let completed = 0;
    const rendered = await render('review-continuation-recovery.tsx', { requestId: REQUEST, onCompleted: () => { completed++; } }, { backend: stateReply('completed', extra) });
    try {
      assert.match(rendered.text(), /not yet verified/i);
      assert.equal(completed, 0);
      assert.equal(rendered.queryByText(/^Retry revision$/), null);
      assert.equal(rendered.queryByText(/^Open the revised result$/), null);
      assert.ok(rendered.queryByText(/^Check again$/));
    } finally { rendered.cleanup(); }
  });
}

test('verified delivery opens the exact child and does not claim Manager proof', async () => {
  const completed: unknown[] = [];
  const rendered = await render('review-continuation-recovery.tsx', { requestId: REQUEST, onCompleted: (r: unknown) => completed.push(r) }, {
    backend: stateReply('completed', { deliveryVerified: true, runId: 'child', artifactId: 'output', completedAt: '2026-09-04T00:00:00Z' }),
  });
  try {
    assert.equal(completed.length, 1);
    assert.equal(rendered.getByText(/^Open the revised result$/).getAttribute('href'), '/review/child');
    assert.match(rendered.text(), /Manager proof are reported separately/);
    assert.doesNotMatch(rendered.text(), /Your feedback was applied/);
    assert.equal(rendered.queryByText(/^Retry revision$/), null);
  } finally { rendered.cleanup(); }
});

test('settling response allows a read refresh without offering another execution', async () => {
  const methods: string[] = [];
  const rendered = await render('review-continuation-recovery.tsx', { requestId: REQUEST }, {
    backend: (path: string, options: { method?: string }) => {
      methods.push(options?.method || 'GET');
      return { ok: true, state: 'settling' };
    },
  });
  try {
    await rendered.click(rendered.getByText(/^Check again$/));
    assert.ok(methods.length >= 2); assert.ok(methods.every(m => m === 'GET'));
    assert.equal(rendered.queryByText(/^Retry revision$/), null);
  } finally { rendered.cleanup(); }
});

test('a still-running revision says WAIT and offers no retry at all', async () => {
  const rendered = await render('review-continuation-recovery.tsx', { requestId: REQUEST }, {
    backend: stateReply('running'),
  });
  try {
    assert.match(rendered.text(), /still running/i);
    assert.equal(rendered.queryByText(/retry/i), null,
      'offering a retry while something is genuinely working is the one thing the guard exists to prevent');
    assert.match(rendered.text(), /Nothing new was queued/i);
  } finally { rendered.cleanup(); }
});

test('a no-ledger process-start lease says it is confirming and unlocks only after the deadline', async () => {
  let reads = 0;
  const rendered = await render('review-continuation-recovery.tsx', { requestId: REQUEST }, {
    backend: (path: string) => {
      assert.match(path, /recovery-state/, 'the waiting surface must never POST');
      reads += 1;
      return reads === 1
        ? { ok: true, state: 'running', reason: 'review_continuation_launch_window_open',
          attempt: { launchAttemptId: 'attempt', ackDeadline: new Date(Date.now() + 20).toISOString() } }
        : { ok: true, state: 'retryable', attempt: null };
    },
  });
  try {
    assert.match(rendered.text(), /confirming whether the previous revision started/i);
    assert.match(rendered.text(), /Confirming the previous revision/);
    assert.doesNotMatch(rendered.text(), /This revision is still running/);
    assert.equal(rendered.queryByText(/^Retry revision$/), null);
    await rendered.act(() => new Promise((resolve) => setTimeout(resolve, 400)));
    assert.ok(rendered.queryByText(/^Retry revision$/), 'the server is reread after the proof deadline');
    assert.equal(reads, 2);
  } finally { rendered.cleanup(); }
});

test('a failed deadline refresh retries without exposing Retry', async () => {
  let reads = 0;
  const rendered = await render('review-continuation-recovery.tsx', { requestId: REQUEST }, {
    backend: () => {
      reads += 1;
      if (reads === 1) return { ok: true, state: 'running', reason: 'review_continuation_launch_window_open',
        attempt: { launchAttemptId: 'attempt', ackDeadline: new Date(Date.now() + 20).toISOString() } };
      if (reads === 2) throw new Error('temporary read failure');
      return { ok: true, state: 'retryable', attempt: null };
    },
  });
  try {
    await rendered.act(() => new Promise((resolve) => setTimeout(resolve, 400)));
    assert.equal(rendered.queryByText(/^Retry revision$/), null);
    await rendered.act(() => new Promise((resolve) => setTimeout(resolve, 1_100)));
    assert.ok(rendered.queryByText(/^Retry revision$/));
    assert.equal(reads, 3);
  } finally { rendered.cleanup(); }
});

test('launch-window automatic reads are finitely budgeted and never start before the deadline', () => {
  const source = readFileSync(new URL('./review-continuation-recovery.tsx', import.meta.url), 'utf8');
  assert.match(source, /LAUNCH_WINDOW_REFRESH_RETRIES_MS\s*=\s*\[1_000, 3_000, 10_000\]/);
  assert.match(source, /deadlineMs\s*-\s*Date\.now\(\)\s*\+\s*250/);
  assert.doesNotMatch(source, /Math\.min\(5\s*\*\s*60_000,\s*deadlineMs/);
});

test('an unverifiable attempt names the restart AND the retry — the state_unknown case', async () => {
  const rendered = await render('review-continuation-recovery.tsx', { requestId: REQUEST }, {
    backend: stateReply('unverifiable', {
      legacy: true, attempt: { executor: 'codex', consequentialWorkStarted: false },
    }),
  });
  try {
    const text = rendered.text();
    assert.match(text, /Couldn’t verify the previous revision/i);
    assert.match(text, /If the revisions were not applied in the previous run, you can retry this revision\./i);
    assert.match(text, /quit .*ChatGPT \/ Codex.* and open it again/i,
      'the action the user had already taken must be the action the product names');
    assert.match(text, /don’t re-enter anything/i, 'and their review is reused, not retyped');
    assert.ok(rendered.queryByText(/^Retry revision$/),
      'the recovery action must be a control, not a sentence');
    assert.doesNotMatch(text, /^Queued$/im, 'and nothing may claim the revision is queued');
  } finally { rendered.cleanup(); }
});

test('a proven-ended attempt offers a plain retry and says no edits were made', async () => {
  const rendered = await render('review-continuation-recovery.tsx', { requestId: REQUEST }, {
    backend: stateReply('retryable', {
      attempt: { executor: 'codex', endedAt: '2026-08-11T04:00:00Z', consequentialWorkStarted: false },
    }),
  });
  try {
    assert.match(rendered.text(), /Ready to retry/i);
    assert.match(rendered.text(), /made no edits/i);
    assert.ok(rendered.queryByText(/^Retry revision$/));
  } finally { rendered.cleanup(); }
});

test('a cancelled revision offers new work, never a retry', async () => {
  const rendered = await render('review-continuation-recovery.tsx', { requestId: REQUEST }, {
    backend: stateReply('cancelled'),
  });
  try {
    assert.match(rendered.text(), /cancelled/i);
    assert.equal(rendered.queryByText(/^Retry revision$/), null);
    assert.equal(rendered.queryByText(/I restarted/), null);
  } finally { rendered.cleanup(); }
});

test('only a cancelled server state offers the feedback draft action', async () => {
  for (const state of ['running', 'settling', 'unverifiable', 'retryable', 'queued', 'completed', 'cancelled']) {
    let amendments = 0;
    const rendered = await render('review-continuation-recovery.tsx', {
      requestId: REQUEST, onAmendCancelled: async () => { amendments++; },
    }, { backend: stateReply(state) });
    try {
      const action = rendered.queryByText(/^Open a new draft with this feedback$/);
      assert.equal(Boolean(action), state === 'cancelled');
      if (action) {
        await rendered.click(action);
        assert.equal(amendments, 1);
        assert.equal(rendered.calls.backend.some(c => c.path.includes('/recover-review-continuation')), false);
        assert.equal(rendered.document.querySelector('[data-recovery-state="queued"]'), null);
      }
    } finally { rendered.cleanup(); }
  }
});

test('a refused draft action retains cancellation and permits another deliberate attempt', async () => {
  let attempts = 0;
  const rendered = await render('review-continuation-recovery.tsx', {
    requestId: REQUEST, onAmendCancelled: async () => { attempts++; throw new Error('refused'); },
  }, { backend: stateReply('cancelled') });
  try {
    await rendered.click(rendered.getByText(/^Open a new draft with this feedback$/));
    assert.match(rendered.text(), /Your submitted feedback is unchanged/);
    assert.ok(rendered.document.querySelector('[data-recovery-state="cancelled"]'));
    await rendered.click(rendered.getByText(/^Open a new draft with this feedback$/));
    assert.equal(attempts, 2);
  } finally { rendered.cleanup(); }
});

test('NO FALSE QUEUED: a refused retry leaves the panel on its refusal, not on Queued', async () => {
  // The exact regression this whole lane exists to prevent, at the UI layer: a
  // click that the backend refused must not paint success.
  let calls = 0;
  const rendered = await render('review-continuation-recovery.tsx', { requestId: REQUEST }, {
    backend: (path: string) => {
      if (path.includes('/recovery-state')) return { ok: true, state: 'unverifiable', legacy: true };
      calls += 1;
      const error = new Error('review_continuation_still_running') as Error & { status: number; body: unknown };
      error.status = 409;
      error.body = { ok: false, reason: 'review_continuation_still_running', requestId: REQUEST };
      throw error;
    },
  });
  try {
    await rendered.click(rendered.getByText(/^Retry revision$/));
    assert.equal(calls, 1, 'the retry was attempted');
    const text = rendered.text();
    assert.doesNotMatch(text, /lands in your inbox/i, 'a refused retry must not render the queued confirmation');
    assert.match(text, /still running/i, 'it must render the refusal it actually received');
    assert.equal(rendered.document.querySelector('[data-recovery-state="queued"]'), null);
  } finally { rendered.cleanup(); }
});

test('a SUCCESSFUL retry renders Queued — and only then', async () => {
  const rendered = await render('review-continuation-recovery.tsx', { requestId: REQUEST }, {
    backend: (path: string) => {
      if (path.includes('/recovery-state')) return { ok: true, state: 'unverifiable', legacy: true };
      return { ok: true, reviewRetry: { requeued: true, alreadyQueued: false, submissionId: SUBMISSION } };
    },
  });
  try {
    assert.equal(rendered.document.querySelector('[data-recovery-state="queued"]'), null);
    await rendered.click(rendered.getByText(/^Retry revision$/));
    assert.ok(rendered.document.querySelector('[data-recovery-state="queued"]'));
    assert.match(rendered.text(), /Queued with your original review submission/i);
  } finally { rendered.cleanup(); }
});

test('the retry carries the user’s note, so the review is never re-entered', async () => {
  const seen: Array<{ path: string; init: unknown }> = [];
  const rendered = await render('review-continuation-recovery.tsx', {
    requestId: REQUEST, note: 'tighten the pause at five seconds',
  }, {
    backend: (path: string, init: unknown) => {
      seen.push({ path, init });
      if (path.includes('/recovery-state')) return { ok: true, state: 'retryable', attempt: { executor: 'codex' } };
      return { ok: true, reviewRetry: { requeued: true, alreadyQueued: false } };
    },
  });
  try {
    await rendered.click(rendered.getByText(/^Retry revision$/));
    const post = seen.find((c) => c.path.includes('/recover-review-continuation'));
    assert.ok(post, 'the recovery endpoint must be the one addressed');
    assert.match(post!.path, new RegExp(REQUEST), 'and it must name the exact request that was refused');
    assert.equal((post!.init as { body?: { note?: string } }).body?.note, 'tighten the pause at five seconds');
  } finally { rendered.cleanup(); }
});

test('an unreadable recovery state renders nothing rather than inventing one', async () => {
  const rendered = await render('review-continuation-recovery.tsx', { requestId: REQUEST }, {
    backend: () => { throw new Error('network down'); },
  });
  try {
    assert.equal(rendered.text().trim(), '',
      'a failed read is not a state; guessing one here would be the same class of bug as guessing a process ended');
  } finally { rendered.cleanup(); }
});
