// node --test lib/review-submit-contract.test.ts
//
// THE PINNED SUBMIT CONTRACT.
//
// Every fixture below is the literal response shape emitted by
// implexa-backend@8c0f71d6eb611faf9635f14c7bafc767d01bc706 (migrations 0165 + 0166
// applied), read from that commit's `src/routes/review.js`. Nothing here is inferred
// from a description of the contract.
//
// Two layers:
//
//   1. Fixtures + parser behaviour, which run everywhere. These are the tests that
//      fail if we mis-read a response.
//   2. A cross-repo parity check that runs ONLY where a backend checkout containing
//      the pinned commit exists. It re-reads the field name and the bound out of the
//      backend source at that exact SHA, so a client constant cannot silently drift
//      away from the server's. Same idiom as run-recovery-parity.test.ts.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseSubmitResponse, submitRefusalCopy } from './review-submission-flow.ts';
import { REVISION_NOTE_MAX } from './review-actions.ts';
import { BACKEND_PIN, submitFixture } from './review-multi-file-fixture.ts';

// ── the pin itself ──────────────────────────────────────────────────────────

test('the fixtures name the exact backend commit they were read from', () => {
  assert.match(BACKEND_PIN, /^[0-9a-f]{40}$/, 'the backend pin must be a full commit sha');
  assert.equal(BACKEND_PIN, '8c0f71d6eb611faf9635f14c7bafc767d01bc706');
});

// ── success shapes ──────────────────────────────────────────────────────────

test('a FRESH submission yields the server count and both identities', () => {
  const out = parseSubmitResponse(submitFixture.fresh);
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.equal(out.requestId, 'd41d8cd9-1111-4000-8000-aaaaaaaaaaaa');
  assert.equal(out.issueCount, 12, 'the server count must be taken verbatim');
  assert.equal(out.submissionId, 'e5f60718-2222-4000-8000-bbbbbbbbbbbb');
  assert.match(out.submissionDigest!, /^[0-9a-f]{64}$/);
  assert.equal(out.idempotent, false);
  assert.equal(out.recovered, false);
});

test('a RECOVERED submission is a success, and says which one it adopted', () => {
  // `_adoptExistingContinuation` — a crashed earlier attempt whose continuation the
  // server found and finalized against. It is queued work, not a failure.
  const out = parseSubmitResponse(submitFixture.recovered);
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.equal(out.recovered, true);
  assert.equal(out.issueCount, 12);
  assert.equal(out.requestId, 'd41d8cd9-1111-4000-8000-aaaaaaaaaaaa');
});

test('REPRO: an IDEMPOTENT reply carries no issueCount — the count comes from the session', () => {
  // The `alreadySubmitted` branch returns { ok, idempotent, requestId, session } and
  // nothing else. `session` is the `_publicSession` projection, whose
  // `submittedIssueIds` IS the server's record of what it submitted. That is the only
  // permitted fallback; anything else would be inventing a number.
  assert.equal((submitFixture.idempotent as Record<string, unknown>).issueCount, undefined);
  const out = parseSubmitResponse(submitFixture.idempotent);
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.equal(out.idempotent, true);
  assert.equal(out.issueCount, 12, 'the count must come from session.submittedIssueIds');
  assert.equal(out.submissionId, null, 'this branch names no submission, and none may be invented');
});

// ── fail closed ─────────────────────────────────────────────────────────────

test('REPRO: ok:true without a continuation id is a FAILURE', () => {
  const out = parseSubmitResponse({ ok: true, issueCount: 12, session: { submittedIssueIds: ['a'] } });
  assert.equal(out.ok, false);
  if (out.ok) return;
  assert.equal(out.reason, 'malformed_success');
  assert.match(submitRefusalCopy(out), /without naming a revision/i);
});

test('REPRO: ok:true without any server count is a FAILURE, never filled in locally', () => {
  const out = parseSubmitResponse({ ok: true, requestId: 'req-1' });
  assert.equal(out.ok, false);
  if (out.ok) return;
  assert.equal(out.reason, 'malformed_success');
});

test('a session with an EMPTY submittedIssueIds is not a count', () => {
  const out = parseSubmitResponse({ ok: true, requestId: 'req-1', session: { submittedIssueIds: [] } });
  assert.equal(out.ok, false, 'zero submitted issues was read as a valid count');
});

test('a non-integer or negative issueCount is refused, not coerced', () => {
  for (const issueCount of [1.5, -1, '12', null, Number.NaN]) {
    const out = parseSubmitResponse({ ok: true, requestId: 'req-1', issueCount });
    assert.equal(out.ok, false, `issueCount ${String(issueCount)} was accepted`);
  }
});

test('every typed refusal at the pin is read as a refusal, with its own words', () => {
  for (const [name, body] of Object.entries(submitFixture.refusals)) {
    const out = parseSubmitResponse(body as Record<string, unknown>);
    assert.equal(out.ok, false, `${name} was read as a success`);
    if (out.ok) continue;
    assert.equal(out.message, (body as { error: string }).error,
      `${name} lost the server's own explanation`);
  }
});

test('a 503 is unavailable — retryable, and worded as such', () => {
  const out = parseSubmitResponse(submitFixture.refusals.unavailable);
  assert.equal(out.ok, false);
  if (out.ok) return;
  assert.equal(out.reason, 'unavailable');
});

test('an unreachable upstream is unavailable even when the body says nothing', () => {
  const out = parseSubmitResponse({ ok: false }, { unavailable: true });
  assert.equal(out.ok, false);
  if (out.ok) return;
  assert.equal(out.reason, 'unavailable');
  assert.match(submitRefusalCopy(out), /nothing was sent/i);
});

test('a conflict keeps its status as a refusal the reviewer can act on', () => {
  const out = parseSubmitResponse(submitFixture.refusals.digestMismatch);
  assert.equal(out.ok, false);
  if (out.ok) return;
  assert.equal(out.reason, 'refused');
  assert.match(out.message!, /submit it again/);
});

// ── cross-repo parity, at the pinned SHA ────────────────────────────────────

/** A sibling backend checkout that actually contains the pinned commit. */
const backendRepo = (() => {
  // SEVERAL ANCESTORS, NOT ONE (2026-08-08). This looked only in the dashboard's
  // immediate parent. The backend checkouts actually sit a level above that, and from
  // a git worktree (.claude/worktrees/<name>) they are further up still — so the five
  // parity tests below reported SKIP everywhere, including the canonical layout. A
  // cross-repo check that can never locate the other repo is not a check.
  for (const up of [['..', '..'], ['..', '..', '..'], ['..', '..', '..', '..'],
    ['..', '..', '..', '..', '..'], ['..', '..', '..', '..', '..', '..']]) {
    const workspace = join(import.meta.dirname, ...up);
    if (!existsSync(workspace)) continue;
    for (const name of readdirSync(workspace)) {
      if (!/backend/i.test(name)) continue;
      const dir = join(workspace, name);
      if (!existsSync(join(dir, '.git'))) continue;
      try {
        execFileSync('git', ['cat-file', '-e', `${BACKEND_PIN}^{commit}`], { cwd: dir, stdio: 'ignore' });
        return dir;
      } catch { /* not this one */ }
    }
  }
  return null;
})();

const atPin = (path: string) =>
  execFileSync('git', ['show', `${BACKEND_PIN}:${path}`], { cwd: backendRepo!, encoding: 'utf8' });

test('the client bound equals REVISION_NOTE_MAX at the pinned commit', { skip: !backendRepo }, () => {
  const source = atPin('src/lib/review-submission.js');
  const declared = /const REVISION_NOTE_MAX = (\d+);/.exec(source);
  assert.ok(declared, 'REVISION_NOTE_MAX is not declared at the pin');
  assert.equal(REVISION_NOTE_MAX, Number(declared![1]),
    'the dashboard bound has drifted from the backend bound');
});

test('the backend trims the note, which is why the client trims before sending', { skip: !backendRepo }, () => {
  const source = atPin('src/lib/review-submission.js');
  assert.match(source, /cleanNote = revisionNote\.trim\(\) \|\| null;/,
    'the server no longer trims — the client mirror must be re-derived');
});

test('the request field really is `revisionNote` at the pinned commit', { skip: !backendRepo }, () => {
  const route = atPin('src/routes/review.js');
  assert.match(route, /req\.body\.revisionNote/,
    'the submit route does not read revisionNote from the body');
});

test('the success responses really carry the keys the parser reads', { skip: !backendRepo }, () => {
  const route = atPin('src/routes/review.js');
  const submit = route.slice(route.indexOf("router.post('/sessions/:sessionId/submit'"));
  for (const key of ['requestId', 'issueCount', 'submissionId', 'submissionDigest', 'idempotent']) {
    assert.match(submit, new RegExp(`\\b${key}\\b`), `the submit route no longer emits ${key}`);
  }
  // `recovered` is emitted by `_adoptExistingContinuation`, which the route delegates
  // to and which is defined ABOVE it — so it is checked against the whole file rather
  // than the route slice.
  assert.match(route, /recovered: true,/, 'the adopt path no longer flags itself as recovered');
});

test('the idempotent branch still omits issueCount, so the fallback stays load-bearing', { skip: !backendRepo }, () => {
  const route = atPin('src/routes/review.js');
  const branch = /if \(prepared\.alreadySubmitted\) \{[\s\S]*?\n {4}\}/.exec(route);
  assert.ok(branch, 'the alreadySubmitted branch could not be located');
  assert.doesNotMatch(branch![0], /issueCount/,
    'the idempotent branch now returns a count — prefer it over the session fallback');
});
