// node --test lib/generation-proposal.test.ts
//
// The paid-generation parser boundary. Every test guards the same failure class as
// lib/review.test.ts — a malformed read rendered as a confident answer — except
// here the confident answer is about MONEY: what will be spent, whether it was,
// and whether it finished. Fixtures are the backend compiler's EXACT output
// (contract 2026-08-01), not approximations.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGenerationProposalResponse } from './generation-proposal.ts';
import { FAST_COMPILED, PROFESSIONAL_COMPILED, PRODUCTION_COMPILED } from './generation-proposal.fixtures.ts';

const PROPOSAL_ID = '4c1d16a8-9f7e-4b7a-8a55-2e9d0f6b3c21';
const AUTH_ID = '9d2f5c70-1b3e-4f6a-9c08-7a4e5d2b1f90';
const AUTH_DIGEST = 'c'.repeat(64);
const ARTIFACT_SHA = 'd'.repeat(64);
const EXPIRES = '2026-08-01T12:00:00.000Z';

type Dict = Record<string, unknown>;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

function identityFor(compiled: Dict, over: Dict = {}): Dict {
  return {
    user_id: '11111111-2222-4333-8444-555555555555',
    organization_id: null,
    agent_subject: 'ig-reel-producer',
    capability_key: compiled.capability_key,
    source_run_id: '66666666-7777-4888-9999-aaaaaaaaaaaa',
    source_request_id: null,
    proposal_id: PROPOSAL_ID,
    proposal_version: 'generation-quality.v1',
    proposal_digest: compiled.proposal_digest,
    authorization_id: null,
    authorization_digest: null,
    ...over,
  };
}

function pendingAuth(compiled: Dict, over: Dict = {}): Dict {
  return {
    authorization_id: AUTH_ID,
    authorization_digest: AUTH_DIGEST,
    status: 'pending',
    max_tasks: compiled.task_count,
    max_credits: compiled.maximum_credits,
    expires_at: EXPIRES,
    claimed_at: null,
    finalized_at: null,
    error_code: null,
    ...over,
  };
}

/** The exact GET envelope around a compiled proposal, default awaiting approval. */
function statusBody(compiledSource: unknown, over: Dict = {}): Dict {
  const compiled = clone(compiledSource) as Dict;
  return {
    ok: true,
    proposal_id: PROPOSAL_ID,
    lifecycle_state: 'awaiting_approval',
    progress_state: 'awaiting_approval',
    availability: compiled.availability,
    unavailable_reason: compiled.unavailable_reason,
    identity: identityFor(compiled),
    expires_at: EXPIRES,
    proposal: compiled,
    cost: { total_credits: 0, maximum_credits: compiled.maximum_credits },
    authorization: null,
    task_progress: [],
    receipt: null,
    ...over,
  };
}

/** An approved envelope with a live authorization in the given status. */
function approvedBody(compiledSource: unknown, authStatus: string, progress: string, over: Dict = {}): Dict {
  const compiled = clone(compiledSource) as Dict;
  const auth = pendingAuth(compiled, { status: authStatus });
  return statusBody(compiled, {
    lifecycle_state: 'approved',
    progress_state: progress,
    identity: identityFor(compiled, { authorization_id: AUTH_ID, authorization_digest: AUTH_DIGEST }),
    authorization: auth,
    ...over,
  });
}

const parse = (body: unknown) => parseGenerationProposalResponse(body, PROPOSAL_ID);

// ── the happy fixtures ──────────────────────────────────────────────────────

test('fast fixture parses: 3 clips, 180 credits, awaiting approval, no dollars', () => {
  const vm = parse(statusBody(FAST_COMPILED));
  assert.ok(vm);
  assert.equal(vm.qualityMode, 'fast');
  assert.equal(vm.taskCount, 3);
  assert.equal(vm.maximumCredits, 180);
  assert.equal(vm.lifecycle, 'awaiting_approval');
  assert.equal(vm.progress, 'awaiting_approval');
  assert.equal(vm.availability, true);
  assert.equal(vm.provider, 'runway');
  assert.equal(vm.model, 'gen4.5');
  // Credits only. The contract carries no dollar figure and the VM must not invent one.
  assert.equal(vm.dollars, null);
  assert.equal(vm.proposalDigest, FAST_COMPILED.proposal_digest);
  assert.deepEqual(vm.tasks.map((t) => t.taskId), ['hook-primary', 'build-primary', 'result-primary']);
  assert.deepEqual(vm.tasks[1].window, { startSeconds: 12, endSeconds: 17 });
});

test('professional fixture parses: 6 clips (2 per moment), 360 credits', () => {
  const vm = parse(statusBody(PROFESSIONAL_COMPILED));
  assert.ok(vm);
  assert.equal(vm.qualityMode, 'professional');
  assert.equal(vm.taskCount, 6);
  assert.equal(vm.maximumCredits, 360);
  assert.equal(vm.generationsPerMoment, 2);
  assert.equal(vm.densityLabel, 'high');
  assert.deepEqual(vm.reviewRequirements, ['per_asset_judge', 'clip_level_repair_eligible', 'segmented_assembly', 'user_review']);
});

test('production fixture parses as unavailable with the machine-readable reason', () => {
  const vm = parse(statusBody(PRODUCTION_COMPILED, {
    lifecycle_state: 'unavailable', progress_state: 'unavailable',
  }));
  assert.ok(vm);
  assert.equal(vm.availability, false);
  assert.equal(vm.unavailableReason, 'missing_required_production_capabilities');
  assert.deepEqual(vm.requiredMissingCapabilities, ['video.judge.per_asset', 'video.orchestration.segmented_assembly']);
  assert.equal(vm.taskCount, 0);
  assert.equal(vm.lifecycle, 'unavailable');
});

test('unknown ADDITIVE fields are allowed at every level', () => {
  const body = statusBody(FAST_COMPILED, { some_future_field: { nested: true } });
  (body.proposal as Dict).future_hint = 'ok';
  (body.identity as Dict).future_identity_bit = 1;
  assert.ok(parse(body));
});

// ── every lifecycle/progress state ──────────────────────────────────────────

test('every authorization status projects to its progress state and parses', () => {
  const map: Array<[string, string]> = [
    ['pending', 'pending'], ['claimed', 'generating'], ['completed', 'completed'],
    ['failed', 'failed'], ['unknown', 'unknown'], ['expired', 'expired'],
  ];
  for (const [authStatus, progress] of map) {
    const vm = parse(approvedBody(FAST_COMPILED, authStatus, progress));
    assert.ok(vm, `auth=${authStatus}`);
    assert.equal(vm.lifecycle, 'approved');
    assert.equal(vm.progress, progress);
  }
});

test('cancelled and expired lifecycles parse with matching progress', () => {
  for (const state of ['cancelled', 'expired'] as const) {
    const vm = parse(statusBody(FAST_COMPILED, { lifecycle_state: state, progress_state: state }));
    assert.ok(vm, state);
    assert.equal(vm.lifecycle, state);
    assert.equal(vm.progress, state);
  }
});

test('a lifecycle/progress pair the backend projection cannot produce is rejected', () => {
  // awaiting_approval cannot be generating; approved cannot be awaiting_approval.
  assert.equal(parse(statusBody(FAST_COMPILED, { progress_state: 'generating' })), null);
  assert.equal(parse(approvedBody(FAST_COMPILED, 'pending', 'awaiting_approval')), null);
});

test('the progress state must agree with the authorization status', () => {
  // claimed projects to generating; claiming completed over it lies about doneness.
  assert.equal(parse(approvedBody(FAST_COMPILED, 'claimed', 'completed')), null);
});

// ── malformed 200s: rejection, not coercion ─────────────────────────────────

test('missing or null required arrays are malformed, not empty', () => {
  for (const key of ['tasks', 'per_task_credits', 'stages', 'review_requirements', 'required_missing_capabilities'] as const) {
    const body = statusBody(FAST_COMPILED);
    delete (body.proposal as Dict)[key];
    assert.equal(parse(body), null, `missing proposal.${key}`);
    const body2 = statusBody(FAST_COMPILED);
    (body2.proposal as Dict)[key] = null;
    assert.equal(parse(body2), null, `null proposal.${key}`);
  }
  const noProgress = statusBody(FAST_COMPILED);
  delete noProgress.task_progress;
  assert.equal(parse(noProgress), null, 'missing task_progress');
  const nullProgress = statusBody(FAST_COMPILED, { task_progress: null });
  assert.equal(parse(nullProgress), null, 'null task_progress');
});

test('unknown state values fail closed', () => {
  assert.equal(parse(statusBody(FAST_COMPILED, { lifecycle_state: 'paused' })), null);
  assert.equal(parse(statusBody(FAST_COMPILED, { progress_state: 'degraded' })), null);
  assert.equal(parse(approvedBody(FAST_COMPILED, 'archived', 'unknown')), null);
  const body = statusBody(FAST_COMPILED);
  (body.proposal as Dict).quality_mode = 'ultra';
  assert.equal(parse(body), null, 'unknown quality_mode');
});

test('null or contradictory totals are rejected', () => {
  const nullMax = statusBody(FAST_COMPILED);
  (nullMax.proposal as Dict).maximum_credits = null;
  assert.equal(parse(nullMax), null);

  const wrongSum = statusBody(FAST_COMPILED);
  (wrongSum.proposal as Dict).maximum_credits = 999;
  assert.equal(parse(wrongSum), null, 'maximum must equal the task sum');

  const nullTotal = statusBody(FAST_COMPILED, { cost: { total_credits: null, maximum_credits: 180 } });
  assert.equal(parse(nullTotal), null);

  const rivalCost = statusBody(FAST_COMPILED, { cost: { total_credits: 0, maximum_credits: 120 } });
  assert.equal(parse(rivalCost), null, 'cost must restate the compiled maximum');

  const overCharge = statusBody(FAST_COMPILED, { cost: { total_credits: 500, maximum_credits: 180 } });
  assert.equal(parse(overCharge), null, 'charged above the authorized maximum');
});

test('per_task_credits must be the same statement as tasks', () => {
  const body = statusBody(FAST_COMPILED);
  ((body.proposal as Dict).per_task_credits as Dict[])[0].credits = 61;
  assert.equal(parse(body), null);
  const missingRow = statusBody(FAST_COMPILED);
  ((missingRow.proposal as Dict).per_task_credits as Dict[]).pop();
  assert.equal(parse(missingRow), null);
});

test('duplicate task ids are rejected', () => {
  const body = statusBody(FAST_COMPILED);
  const tasks = (body.proposal as Dict).tasks as Dict[];
  tasks[1] = clone(tasks[0]);
  // keep the sums plausible so ONLY the duplication is what fails
  const perTask = (body.proposal as Dict).per_task_credits as Dict[];
  perTask[1] = clone(perTask[0]);
  assert.equal(parse(body), null);
});

test('foreign identity is refused everywhere it can appear', () => {
  // envelope id vs requested id
  assert.equal(parseGenerationProposalResponse(statusBody(FAST_COMPILED), 'some-other-proposal'), null);
  // identity block naming a different proposal
  const body = statusBody(FAST_COMPILED);
  (body.identity as Dict).proposal_id = 'different';
  assert.equal(parse(body), null);
  // identity digest disagreeing with the compiled document
  const digestDrift = statusBody(FAST_COMPILED);
  (digestDrift.identity as Dict).proposal_digest = 'e'.repeat(64);
  assert.equal(parse(digestDrift), null);
  // an event about a task this proposal does not contain
  const foreignEvent = approvedBody(FAST_COMPILED, 'claimed', 'generating', {
    task_progress: [{ task_id: 'not-our-task', event_type: 'task_created', provider_task_id: null, status: 'created', artifact: null, created_at: null }],
  });
  assert.equal(parse(foreignEvent), null);
  // a receipt row for a foreign task
  const foreignReceipt = approvedBody(FAST_COMPILED, 'completed', 'completed', {
    receipt: { receipt_digest: null, tasks: [{ task_id: 'not-our-task', provider_task_id: null, prompt_digest: null, status: 'succeeded', artifact: null }] },
  });
  assert.equal(parse(foreignReceipt), null);
});

test('a receipt row with a different prompt digest than its task is refused', () => {
  const body = approvedBody(FAST_COMPILED, 'completed', 'completed', {
    receipt: {
      receipt_digest: null,
      tasks: [{ task_id: 'hook-primary', provider_task_id: null, prompt_digest: 'f'.repeat(64), status: 'succeeded', artifact: null }],
    },
  });
  assert.equal(parse(body), null);
});

test('duplicate receipt rows for one task are refused', () => {
  const row = {
    task_id: 'hook-primary', provider_task_id: null,
    prompt_digest: (FAST_COMPILED.tasks[0] as { prompt_digest: string }).prompt_digest,
    status: 'succeeded', artifact: { sha256: ARTIFACT_SHA },
  };
  const body = approvedBody(FAST_COMPILED, 'completed', 'completed', {
    receipt: { receipt_digest: null, tasks: [row, clone(row)] },
  });
  assert.equal(parse(body), null);
});

test('partial reads are refused: approval facts must arrive whole', () => {
  // approved with no authorization block
  const noAuth = statusBody(FAST_COMPILED, { lifecycle_state: 'approved', progress_state: 'pending' });
  assert.equal(parse(noAuth), null);
  // authorization whose digest disagrees with the identity block
  const digestDrift = approvedBody(FAST_COMPILED, 'pending', 'pending');
  (digestDrift.authorization as Dict).authorization_digest = 'a'.repeat(64);
  assert.equal(parse(digestDrift), null);
  // authorization bounds disagreeing with the proposal
  const boundsDrift = approvedBody(FAST_COMPILED, 'pending', 'pending');
  (boundsDrift.authorization as Dict).max_credits = 60;
  assert.equal(parse(boundsDrift), null);
  // task events without any authorization that could have produced them
  const orphanEvents = statusBody(FAST_COMPILED, {
    task_progress: [{ task_id: 'hook-primary', event_type: 'task_created', provider_task_id: null, status: 'created', artifact: null, created_at: null }],
  });
  assert.equal(parse(orphanEvents), null);
  // a receipt without an authorization
  const orphanReceipt = statusBody(FAST_COMPILED, {
    receipt: { receipt_digest: null, tasks: [] },
  });
  assert.equal(parse(orphanReceipt), null);
});

test('self-contradictory availability is refused', () => {
  // envelope says available, document says not
  const body = statusBody(FAST_COMPILED, { availability: false, unavailable_reason: 'x' });
  assert.equal(parse(body), null);
  // availability alone flipped, everything else agreeing — the envelope's own
  // statement must still match the compiled document
  assert.equal(parse(statusBody(FAST_COMPILED, { availability: false })), null);
  // available document under an unavailable lifecycle
  const lifecycleDrift = statusBody(FAST_COMPILED, { lifecycle_state: 'unavailable', progress_state: 'unavailable' });
  assert.equal(parse(lifecycleDrift), null);
  // unavailable document with tasks in it
  const armedUnavailable = statusBody(PRODUCTION_COMPILED, { lifecycle_state: 'unavailable', progress_state: 'unavailable' });
  ((armedUnavailable.proposal as Dict).tasks as unknown[]).push(clone(FAST_COMPILED.tasks[0]));
  assert.equal(parse(armedUnavailable), null);
  // available document with an empty task list
  const emptyAvailable = statusBody(FAST_COMPILED);
  (emptyAvailable.proposal as Dict).tasks = [];
  assert.equal(parse(emptyAvailable), null);
});

test('a valid receipt with artifacts parses and carries the digests', () => {
  const tasks = FAST_COMPILED.tasks as ReadonlyArray<{ task_id: string; prompt_digest: string }>;
  const body = approvedBody(FAST_COMPILED, 'completed', 'completed', {
    cost: { total_credits: 180, maximum_credits: 180 },
    receipt: {
      receipt_digest: 'b'.repeat(64),
      tasks: tasks.map((t) => ({
        task_id: t.task_id, provider_task_id: null, prompt_digest: t.prompt_digest,
        status: 'succeeded', artifact: { sha256: ARTIFACT_SHA, mime_type: 'video/mp4', bytes: 123 },
      })),
    },
  });
  const vm = parse(body);
  assert.ok(vm);
  assert.equal(vm.receipt?.tasks.length, 3);
  assert.equal(vm.receipt?.tasks[0].artifactSha256, ARTIFACT_SHA);
  assert.equal(vm.chargedCredits, 180);
});

test('malformed artifact digests in events or receipts are refused', () => {
  const badEvent = approvedBody(FAST_COMPILED, 'claimed', 'generating', {
    task_progress: [{ task_id: 'hook-primary', event_type: 'x', provider_task_id: null, status: 'succeeded', artifact: { sha256: 'not-a-digest' }, created_at: null }],
  });
  assert.equal(parse(badEvent), null);
});

test('an unparseable expiry is refused', () => {
  assert.equal(parse(statusBody(FAST_COMPILED, { expires_at: 'whenever' })), null);
  assert.equal(parse(statusBody(FAST_COMPILED, { expires_at: null })), null);
});

test('the contract hard bounds are enforced: over 10 tasks or 1200 credits is refused', () => {
  const body = statusBody(FAST_COMPILED);
  const proposal = body.proposal as Dict;
  const tasks = proposal.tasks as Dict[];
  // 11 internally-consistent tasks — everything agrees except the schema bound
  const grown: Dict[] = [];
  for (let i = 0; i < 11; i++) grown.push({ ...clone(tasks[0]), task_id: `t${i}`, credits: 60 });
  proposal.tasks = grown;
  proposal.task_count = 11;
  proposal.per_task_credits = grown.map((t) => ({ task_id: t.task_id, credits: 60 }));
  proposal.maximum_credits = 11 * 60;
  (body.cost as Dict).maximum_credits = 11 * 60;
  assert.equal(parse(body), null);

  // and the credit bound alone, with a legal task count
  const rich = statusBody(FAST_COMPILED);
  const richProposal = rich.proposal as Dict;
  for (const t of richProposal.tasks as Dict[]) t.credits = 500;
  richProposal.per_task_credits = (richProposal.tasks as Dict[]).map((t) => ({ task_id: t.task_id, credits: 500 }));
  richProposal.maximum_credits = 1500;
  (rich.cost as Dict).maximum_credits = 1500;
  assert.equal(parse(rich), null);
});

test('ok:false and non-object bodies never parse', () => {
  assert.equal(parse(null), null);
  assert.equal(parse([]), null);
  assert.equal(parse({ ok: false, error: 'proposal_not_found' }), null);
  assert.equal(parse({ ok: true }), null);
});
