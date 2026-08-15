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
import { render } from '../../../lib/test/render.ts';

const REQUEST = '76669b5c-bb85-4785-820a-6103cbc90316';
const SUBMISSION = 'a406aa35-614c-44e9-a6c5-daddb960d52f';

const stateReply = (state: string, extra: Record<string, unknown> = {}) =>
  (path: string) => {
    if (path.includes('/recovery-state')) return { ok: true, state, ...extra };
    return { ok: true };
  };

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

test('REV-COR04: the retry posts NO note — the submitted instruction is reused exactly', async () => {
  // The panel's own copy promises the feedback is "reused exactly as you submitted
  // them". A live composer note riding the retry body would resurrect a stale
  // instruction into a round that claims to be an exact replay — so even a caller
  // that still tries to hand one over (the prop no longer exists) must produce a
  // bare body. This is asserted from the Review Room's shape (no note anywhere) AND
  // from a retry surface still holding live composer text.
  const seen: Array<{ path: string; init: unknown }> = [];
  const rendered = await render('review-continuation-recovery.tsx', {
    requestId: REQUEST,
    // A retry surface's live composer text, offered the old way. It must not travel.
    note: 'tighten the pause at five seconds',
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
    const body = (post!.init as { body?: Record<string, unknown> }).body ?? {};
    assert.equal('note' in body, false, 'the retry body must carry no note key at all');
    // Key-based, not deepEqual: the body object crosses the jsdom realm boundary,
    // and deepStrictEqual would compare prototypes across realms.
    assert.deepEqual(Object.keys(body), [], 'the retry body is empty — the submitted round is the whole payload');
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
