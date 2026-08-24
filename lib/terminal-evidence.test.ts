import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  resolvePresentedState, mayPresentQueued, childRunEvidence,
  type TerminalEvidence,
} from './terminal-evidence.ts';

// THE INCIDENT (2026-08-23), as data. Request c1386b5c closed `done`; child run
// 389eef3a reached `completed` / `verified_complete` with nine artifacts and the
// final MP4 validated; launch attempt 374b609d recorded `succeeded`. The request's
// lifecycle_state never left `running`, and three surfaces rendered Queued with
// "No deliverable recorded".
const PARENT = '836edd36-90a9-4893-a9e5-617fb1616d1b';
const CHILD = '389eef3a-16ae-4852-844c-b1d2e857b38e';

const INCIDENT: TerminalEvidence = {
  requestStatus: 'done',
  requestFailedAt: null,
  requestLaunchFailedAt: null,
  childRunState: 'completed',
  attemptTerminalOutcome: 'succeeded',
  validatedArtifacts: 10,
};

test('the incident can never present as Queued again', () => {
  assert.equal(mayPresentQueued(INCIDENT), false);
  const verdict = resolvePresentedState('queued', INCIDENT);
  assert.equal(verdict.state, 'completed');
  assert.equal(verdict.dominated, true);
});

test('each of the three signals ALONE closes Queued', () => {
  // Requirement 10 is a disjunction, not a conjunction: any one of these makes
  // "nothing has happened yet" a false statement.
  assert.equal(mayPresentQueued({ requestStatus: 'done' }), false);
  assert.equal(mayPresentQueued({ childRunState: 'completed' }), false);
  assert.equal(mayPresentQueued({ attemptTerminalOutcome: 'succeeded' }), false);
});

test('a stale running projection is dominated by the completed child', () => {
  const verdict = resolvePresentedState('running', { childRunState: 'completed' });
  assert.equal(verdict.state, 'completed');
  assert.equal(verdict.reason, 'child_run_completed');
});

test('a stalled presentation over a completed child is still completed', () => {
  // The watchdog's guess about a request must not outlive the run plane's fact.
  assert.equal(resolvePresentedState('stalled', { childRunState: 'completed' }).state, 'completed');
});

// ── What it must NEVER do ───────────────────────────────────────────────────

test('nothing promotes silence: absent evidence leaves the caller exactly as it was', () => {
  for (const evidence of [null, undefined, {}, { requestStatus: 'pending' }, { requestStatus: 'consumed' }]) {
    const verdict = resolvePresentedState('queued', evidence as TerminalEvidence);
    assert.equal(verdict.state, 'queued');
    assert.equal(verdict.dominated, false);
  }
  assert.equal(resolvePresentedState('running', { requestStatus: 'consumed' }).state, 'running');
});

test('validated artifacts alone never mean finished', () => {
  // A run registers files as it produces them. A half-written deliverable being
  // read as a delivered one is the mirror image of this whole incident.
  const midRun: TerminalEvidence = { requestStatus: 'consumed', childRunState: 'running', validatedArtifacts: 7 };
  assert.equal(resolvePresentedState('running', midRun).state, 'running');
  assert.equal(mayPresentQueued({ validatedArtifacts: 42 }), true);
});

test('a still-running child is never upgraded by a done request pointer', () => {
  // Parent completed + child running. The request row can settle ahead of the run
  // plane, and announcing "completed" here would be premature success — a
  // deliverable claimed while it is still being written.
  const verdict = resolvePresentedState('running', { requestStatus: 'done', childRunState: 'running' });
  assert.equal(verdict.state, 'running', 'the live child outranks a settled request pointer');
  assert.equal(verdict.dominated, false);
  // …and it is still not Queued: the child is provably in flight.
  const fromQueued = resolvePresentedState('queued', { requestStatus: 'done', childRunState: 'running' });
  assert.equal(fromQueued.state, 'running');
  assert.equal(fromQueued.dominated, true);
  // A stalled child is reported as stalled, not laundered into either extreme.
  assert.equal(resolvePresentedState('queued', { requestStatus: 'done', childRunState: 'stalled' }).state, 'stalled');
  // A succeeded receipt cannot override a child that is demonstrably still going.
  assert.equal(resolvePresentedState('running', {
    requestStatus: 'done', childRunState: 'running', attemptTerminalOutcome: 'succeeded',
  }).state, 'running');
});

test('a failure stamp outranks `done`, and cancellation outranks everything', () => {
  const failed = resolvePresentedState('running', {
    requestStatus: 'done', requestFailedAt: '2026-08-23T04:50:00.000Z',
    childRunState: 'completed', attemptTerminalOutcome: 'succeeded',
  });
  assert.equal(failed.state, 'failed');
  assert.equal(failed.reason, 'request_failed');

  const launchFailed = resolvePresentedState('queued', {
    requestStatus: 'done', requestLaunchFailedAt: '2026-08-23T04:50:00.000Z',
  });
  assert.equal(launchFailed.state, 'failed');

  const cancelled = resolvePresentedState('running', {
    requestStatus: 'cancelled', childRunState: 'completed', attemptTerminalOutcome: 'succeeded',
  });
  assert.equal(cancelled.state, 'failed');
  assert.equal(cancelled.reason, 'request_cancelled');
});

test('a failed child is failure, whatever the request pointer says', () => {
  const verdict = resolvePresentedState('running', { requestStatus: 'done', childRunState: 'failed' });
  assert.equal(verdict.state, 'failed');
  assert.equal(verdict.reason, 'child_run_failed');
});

test('only `succeeded` counts as a terminal receipt', () => {
  // `superseded` means another attempt took over — the work may still be running.
  // `needs_attention` is the opposite of a result.
  for (const outcome of ['superseded', 'needs_attention', 'failed', 'cancelled']) {
    assert.equal(mayPresentQueued({ attemptTerminalOutcome: outcome }), true,
      `${outcome} must not be read as a delivered result`);
  }
});

test('an already-terminal presentation is left alone — this resolves one direction only', () => {
  // A surface saying `failed` is not second-guessed into `completed` by an
  // attempt receipt. Upgrading a recorded failure is the one move that could turn
  // this safety net into the next incident.
  const verdict = resolvePresentedState('failed', INCIDENT);
  assert.equal(verdict.state, 'failed');
  assert.equal(verdict.dominated, false);
});

// ── Parent / child resolution ───────────────────────────────────────────────

test('the attempt terminal binding is the strongest pointer to the deliverable', () => {
  assert.equal(childRunEvidence({
    parentRunId: PARENT, requestRunId: PARENT, attemptRunId: CHILD, attemptTerminalRunId: CHILD,
  }), CHILD);
});

test('the reviewed parent is never returned as the continuation result', () => {
  // Before the close overwrites it, run_requests.run_id names the run being
  // continued FROM — which is completed, has its own older artifacts, and looks
  // entirely plausible while being the wrong run.
  assert.equal(childRunEvidence({ parentRunId: PARENT, requestRunId: PARENT }), null);
  assert.equal(childRunEvidence({
    parentRunId: PARENT, requestRunId: PARENT, attemptRunId: CHILD,
  }), CHILD);
});

test('the attempt binding outranks the request pointer when they disagree', () => {
  const stale = '11111111-1111-4111-8111-111111111111';
  assert.equal(childRunEvidence({
    parentRunId: PARENT, requestRunId: stale, attemptTerminalRunId: CHILD,
  }), CHILD);
});

test('no pointer at all is null, never a guess', () => {
  assert.equal(childRunEvidence({ parentRunId: PARENT }), null);
  assert.equal(childRunEvidence({ parentRunId: PARENT, requestRunId: '   ' }), null);
  assert.equal(childRunEvidence({}), null);
});

// ── The surfaces actually use it ────────────────────────────────────────────

test('the recovery panel has a terminal `completed` state and never offers retry in it', () => {
  const src = readFileSync(new URL('../app/(dashboard)/_components/review-continuation-recovery.tsx', import.meta.url), 'utf8');
  assert.match(src, /completed: 'This revision is complete'/);
  assert.match(src, /'running' \| 'unverifiable' \| 'retryable' \| 'queued' \| 'cancelled' \| 'completed'/);
  // The retry control appears under `unverifiable` and `retryable` and must not
  // appear under `completed`.
  const block = src.slice(src.indexOf("{resolved === 'completed' && ("), src.indexOf("{resolved === 'cancelled' && ("));
  assert.doesNotMatch(block, /onClick=\{retry\}/, 'a delivered revision must never offer to run again');
  assert.match(block, /Open the revised result/);
});

test('the review room stops claiming a queued revision once it completed', () => {
  const src = readFileSync(new URL('../app/(dashboard)/_components/review-room.tsx', import.meta.url), 'utf8');
  assert.match(src, /onCompleted=\{setRevisionCompleted\}/,
    'the room has to be told, or the panel and the block around it give two answers');
  assert.match(src, /revisionCompleted\s*\n?\s*\/\/[\s\S]*?\?\s*`\$\{submitView\.statusLine\} The revised result was delivered\.`/);
  assert.match(src, /revisionCompleted \? 'Open the revised result' : 'Open revision attempt'/);
});

test('the run page resolves the revision child rather than saying "no deliverable"', () => {
  const src = readFileSync(new URL('../app/(dashboard)/runs/[id]/page.tsx', import.meta.url), 'utf8');
  assert.match(src, /\.eq\('continued_from_run_id', r\.id\)/);
  assert.match(src, /\.eq\('run_state', 'completed'\)/);
  assert.match(src, /This run was revised, and the revision delivered/);
  // Beside the files, NOT inside the deliverable else-chain: a reviewed parent
  // usually has its own output and never reaches that chain, so a pointer hidden
  // there would be invisible on exactly the page that needs it.
  const artifactsAt = src.indexOf('<VerifiedArtifacts artifacts={verifiedArtifacts} />');
  const pointerAt = src.indexOf('{revisedResult && (');
  assert.ok(pointerAt > artifactsAt && pointerAt - artifactsAt < 900,
    'the revision pointer must render beside Files & Artifacts, for every revised run');
  assert.match(src, /it was revised, and the delivered result is linked above/,
    'the bare "no deliverable" line must stop contradicting the pointer above it');
  // The child's files stay attributed to the child. Merging them into this run's
  // list would be the same parent/child confusion wearing the opposite face.
  const fetchBlock = src.slice(src.indexOf('let revisedResult'), src.indexOf('let engineRouting'));
  assert.doesNotMatch(fetchBlock, /verifiedArtifacts\s*=|verifiedArtifacts\.push/,
    "the child's artifacts must not be listed as this run's output");
});
