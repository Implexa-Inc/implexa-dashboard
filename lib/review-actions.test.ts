// node --test lib/review-actions.test.ts
//
// The write-path allowlist. This is the security boundary of the Review write path,
// and it also encodes two lifecycle guarantees the UI must not re-implement:
// submission is per SESSION (so N issues produce one continuation), and idempotency
// belongs to the backend's unique origin key, not to a client-side guard.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveReviewAction, REVISION_NOTE_MAX } from './review-actions.ts';

const SESSION = 'aaaaaaaa-1111-1111-1111-111111111111';
const RUN = '11111111-1111-1111-1111-111111111111';
const ISSUE = 'eeee1111-1111-1111-1111-111111111111';
const ART = 'bbbbbbbb-1111-1111-1111-111111111111';

// ── one submission for many issues ──────────────────────────────────────────

test('REPRO: submit targets the SESSION — N issues resolve to exactly one continuation', () => {
  const t = resolveReviewAction('submit', { sessionId: SESSION });
  assert.notEqual(typeof t, 'string');
  const u = t as { path: string; method: string; body: unknown };
  assert.equal(u.path, `/api/v2/review/sessions/${SESSION}/submit`);
  assert.equal(u.method, 'POST');
  // No issue ids are sent. The snapshot is the SERVER's; a client that enumerated
  // issues here could submit a set the user never approved.
  assert.deepEqual(u.body, { revisionNote: null });
  assert.doesNotMatch(JSON.stringify(u), /issueId|issueIds/);
});

// ── the revision note, under the backend's own contract ─────────────────────
//
// Field name, trimming and bound all read from
// implexa-backend@8c0f71d6eb611faf9635f14c7bafc767d01bc706,
// src/lib/review-submission.js: `revisionNote`, `.trim()`, REVISION_NOTE_MAX = 2000.

test('the note travels under the backend key, trimmed exactly as the server trims it', () => {
  const u = resolveReviewAction('submit', {
    sessionId: SESSION, revisionNote: '  tighten the intro  ',
  }) as { body: Record<string, unknown> };
  // Trimmed here so the reviewer's copy and the stored copy cannot differ by
  // whitespace — the server applies the same `.trim()` before persisting.
  assert.deepEqual(u.body, { revisionNote: 'tighten the intro' });
});

test('a whitespace-only note is null, matching the server turning it into null', () => {
  const u = resolveReviewAction('submit', { sessionId: SESSION, revisionNote: '   \n\t ' }) as { body: Record<string, unknown> };
  assert.deepEqual(u.body, { revisionNote: null });
});

test('the bound is the backend bound, measured AFTER the trim', () => {
  assert.equal(REVISION_NOTE_MAX, 2000, 'this must equal REVISION_NOTE_MAX at the pinned backend commit');

  const atLimit = resolveReviewAction('submit', {
    sessionId: SESSION, revisionNote: `  ${'x'.repeat(REVISION_NOTE_MAX)}  `,
  });
  assert.notEqual(typeof atLimit, 'string', 'a note that fits after trimming was refused');

  const over = resolveReviewAction('submit', {
    sessionId: SESSION, revisionNote: 'x'.repeat(REVISION_NOTE_MAX + 1),
  });
  assert.equal(typeof over, 'string', 'an over-long note reached the network');
  assert.match(over as string, /2000 characters or fewer/);
});

test('a non-string note is refused rather than coerced', () => {
  assert.equal(typeof resolveReviewAction('submit', { sessionId: SESSION, revisionNote: 42 }), 'string');
  assert.equal(typeof resolveReviewAction('submit', { sessionId: SESSION, revisionNote: { a: 1 } }), 'string');
  // Absent and explicit null are both "no note", not a refusal.
  assert.notEqual(typeof resolveReviewAction('submit', { sessionId: SESSION, revisionNote: null }), 'string');
  assert.notEqual(typeof resolveReviewAction('submit', { sessionId: SESSION }), 'string');
});

test('the note never leaks into any other action', () => {
  for (const action of ['ensure_session', 'create_issue', 'update_issue', 'dismiss_issue', 'accept']) {
    const t = resolveReviewAction(action, {
      sessionId: SESSION, runId: SESSION, issueId: SESSION, revisionNote: 'not for this call',
    });
    if (typeof t === 'string') continue;
    assert.doesNotMatch(JSON.stringify(t), /not for this call/, `${action} forwarded the revision note`);
  }
});

test('duplicate submit resolves identically — the client has no dedupe of its own', () => {
  const a = resolveReviewAction('submit', { sessionId: SESSION });
  const b = resolveReviewAction('submit', { sessionId: SESSION });
  assert.deepEqual(a, b);
  // Idempotency is the backend's unique origin_review_session_id. A second, weaker
  // client-side implementation of it would drift from the real guarantee.
});

// ── issue lifecycle ─────────────────────────────────────────────────────────

test('create / update / dismiss each map to exactly one upstream call', () => {
  const anchor = { version: 1, type: 'media_time', artifactSha256: 'a'.repeat(64), timeStartMs: 56230, timeEndMs: null };

  const c = resolveReviewAction('create_issue', { sessionId: SESSION, artifactId: ART, kind: 'timing', anchor, body: 'fix' }) as any;
  assert.equal(c.path, `/api/v2/review/sessions/${SESSION}/issues`);
  assert.equal(c.method, 'POST');
  // forwarded VERBATIM to the backend's typed validator — no client-side "any JSON is fine"
  assert.deepEqual(c.body.anchor, anchor);
  assert.equal(c.body.artifactId, ART);

  const u = resolveReviewAction('update_issue', { issueId: ISSUE, body: 'edited' }) as any;
  assert.equal(u.path, `/api/v2/review/issues/${ISSUE}`);
  assert.equal(u.method, 'PATCH');
  assert.deepEqual(u.body, { body: 'edited' }, 'only supplied fields are patched');

  const d = resolveReviewAction('dismiss_issue', { issueId: ISSUE }) as any;
  assert.equal(d.method, 'DELETE');
  assert.equal(d.body, undefined);
});

test('an edit sends only the fields that changed', () => {
  const kindOnly = resolveReviewAction('update_issue', { issueId: ISSUE, kind: 'visual' }) as any;
  assert.deepEqual(kindOnly.body, { kind: 'visual' });
  const all = resolveReviewAction('update_issue', { issueId: ISSUE, kind: 'visual', body: 'b', anchor: { x: 1 } }) as any;
  assert.deepEqual(Object.keys(all.body).sort(), ['anchor', 'body', 'kind']);
});

test('ensure_session omits an absent artifact rather than sending null', () => {
  const bare = resolveReviewAction('ensure_session', { runId: RUN }) as any;
  assert.equal(bare.path, `/api/v2/review/runs/${RUN}/session`);
  assert.deepEqual(bare.body, {});
  const withArt = resolveReviewAction('ensure_session', { runId: RUN, artifactId: ART }) as any;
  assert.deepEqual(withArt.body, { artifactId: ART });
});

// ── the allowlist itself ────────────────────────────────────────────────────

test('a malformed or injected id is refused, never forwarded', () => {
  for (const bad of ['not-a-uuid', '../../v2/admin', '', null, undefined, 42, {}]) {
    assert.equal(typeof resolveReviewAction('submit', { sessionId: bad }), 'string', `submit accepted ${JSON.stringify(bad)}`);
    assert.equal(typeof resolveReviewAction('create_issue', { sessionId: bad }), 'string');
    assert.equal(typeof resolveReviewAction('dismiss_issue', { issueId: bad }), 'string');
    assert.equal(typeof resolveReviewAction('ensure_session', { runId: bad }), 'string');
  }
});

test('an unknown action resolves to nothing at all', () => {
  for (const a of ['delete_everything', 'GET', '', '../run']) {
    assert.equal(typeof resolveReviewAction(a, { sessionId: SESSION }), 'string');
  }
});

test('every allowed action stays inside /api/v2/review', () => {
  const calls = [
    resolveReviewAction('ensure_session', { runId: RUN }),
    resolveReviewAction('create_issue', { sessionId: SESSION, anchor: {}, body: 'x', kind: 'other' }),
    resolveReviewAction('update_issue', { issueId: ISSUE, body: 'x' }),
    resolveReviewAction('dismiss_issue', { issueId: ISSUE }),
    resolveReviewAction('submit', { sessionId: SESSION }),
    resolveReviewAction('accept', { sessionId: SESSION }),
  ];
  for (const c of calls) {
    assert.notEqual(typeof c, 'string');
    assert.match((c as any).path, /^\/api\/v2\/review\//, 'the allowlist must never reach another API surface');
  }
});

// ── accept ──────────────────────────────────────────────────────────────────

test('accept forwards ONLY a real boolean true as the discard confirmation', () => {
  for (const [input, expected] of [[undefined, false], ['true', false], ['yes', false], [1, false], [{}, false], [true, true]] as const) {
    const a = resolveReviewAction('accept', { sessionId: SESSION, discardOpenIssues: input }) as any;
    assert.equal(a.body.discardOpenIssues, expected,
      `discardOpenIssues=${JSON.stringify(input)} must forward ${expected} — a truthy value must never silently discard written feedback`);
  }
});
