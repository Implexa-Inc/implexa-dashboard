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
import { interpretActionResponse } from './generation-proposal-state.ts';
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

// ── contract-shaped durable records ─────────────────────────────────────────

/** Deterministic provider task ids, one per task. */
const providerId = (n: number) => `${String(n + 1).repeat(8)}-0000-4000-8000-000000000000`.slice(0, 36);

const createdEvent = (taskId: string, provider: string): Dict => ({
  task_id: taskId, event_type: 'task_created', provider_task_id: provider,
  status: 'created', artifact: null, created_at: '2026-08-01T10:00:00.000Z',
});

const succeededEvent = (taskId: string, provider: string, sha: string): Dict => ({
  task_id: taskId, event_type: 'task_succeeded', provider_task_id: provider,
  status: 'succeeded', artifact: { sha256: sha }, created_at: '2026-08-01T10:05:00.000Z',
});

const receiptRow = (task: { task_id: string; prompt_digest: string }, provider: string, sha: string | null, status = 'succeeded'): Dict => ({
  task_id: task.task_id, provider_task_id: provider, prompt_digest: task.prompt_digest,
  status, artifact: sha ? { sha256: sha, mime_type: 'video/mp4', bytes: 123 } : null,
});

const receiptFor = (rows: Dict[], over: Dict = {}): Dict => ({
  authorization_id: AUTH_ID, authorization_digest: AUTH_DIGEST,
  receipt_digest: 'b'.repeat(64), tasks: rows, ...over,
});

const artifactShaFor = (n: number) => String(n + 1).repeat(64).slice(0, 64).replace(/[^0-9a-f]/g, 'a');

/**
 * The FULL completed-evidence envelope: a digested receipt covering every task,
 * every row succeeded with its artifact, and a created+succeeded event pair per
 * task agreeing on provider ids and digests. Tests perturb ONE link at a time.
 */
function completedBody(compiledSource: unknown, over: Dict = {}): Dict {
  const compiled = clone(compiledSource) as Dict;
  const tasks = compiled.tasks as Array<{ task_id: string; prompt_digest: string; credits: number }>;
  const events: Dict[] = [];
  const rows: Dict[] = [];
  tasks.forEach((task, i) => {
    const provider = providerId(i);
    const sha = artifactShaFor(i);
    events.push(createdEvent(task.task_id, provider), succeededEvent(task.task_id, provider, sha));
    rows.push(receiptRow(task, provider, sha));
  });
  const incurred = tasks.reduce((sum, t) => sum + t.credits, 0);
  return approvedBody(compiled, 'completed', 'completed', {
    cost: { total_credits: incurred, maximum_credits: compiled.maximum_credits },
    task_progress: events,
    receipt: receiptFor(rows),
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

test('professional fixture parses as UNAVAILABLE while retaining its graph for preview', () => {
  // Post-review contract: Professional's Judge/repair/assembly pipeline is
  // described but not yet enforced, so it compiles unavailable — with its full
  // task graph intact so the plan can be previewed. It must parse, and it must
  // parse as something that can never be approved.
  const vm = parse(statusBody(PROFESSIONAL_COMPILED, {
    lifecycle_state: 'unavailable', progress_state: 'unavailable',
  }));
  assert.ok(vm);
  assert.equal(vm.qualityMode, 'professional');
  assert.equal(vm.availability, false);
  assert.equal(vm.unavailableReason, 'missing_required_professional_execution_capabilities');
  assert.equal(vm.lifecycle, 'unavailable');
  assert.equal(vm.taskCount, 6);
  assert.equal(vm.maximumCredits, 360);
  assert.equal(vm.generationsPerMoment, 2);
  assert.equal(vm.densityLabel, 'high');
  assert.equal(vm.provider, 'runway');
  assert.deepEqual(vm.reviewRequirements, ['per_asset_judge', 'clip_level_repair_eligible', 'segmented_assembly', 'user_review']);
});

test('professional can never cross into an approvable lifecycle, even with its full graph', () => {
  const armed = statusBody(PROFESSIONAL_COMPILED);
  const proposal = armed.proposal as Dict;
  proposal.availability = true;
  proposal.unavailable_reason = null;
  proposal.required_missing_capabilities = [];
  armed.availability = true;
  armed.unavailable_reason = null;
  assert.equal(parse(armed), null);
});

test('a professional proposal under an approvable lifecycle is refused', () => {
  // unavailable-with-tasks is a PREVIEW shape. The same document claiming
  // awaiting_approval would put an approve button on an unenforceable pipeline.
  assert.equal(parse(statusBody(PROFESSIONAL_COMPILED)), null);
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

test('Production remains a zero-task static gate and cannot carry the Professional graph', () => {
  const disguised = clone(PROFESSIONAL_COMPILED) as Dict;
  disguised.quality_mode = 'production';
  disguised.unavailable_reason = 'missing_required_production_capabilities';
  const body = statusBody(disguised, {
    lifecycle_state: 'unavailable', progress_state: 'unavailable',
    unavailable_reason: 'missing_required_production_capabilities',
  });
  assert.equal(parse(body), null);
});

test('unknown ADDITIVE fields are allowed at every level', () => {
  const body = statusBody(FAST_COMPILED, { some_future_field: { nested: true } });
  (body.proposal as Dict).future_hint = 'ok';
  (body.identity as Dict).future_identity_bit = 1;
  assert.ok(parse(body));
});

// ── every lifecycle/progress state ──────────────────────────────────────────

test('every non-completed authorization status projects to its progress state and parses', () => {
  const map: Array<[string, string]> = [
    ['pending', 'pending'], ['claimed', 'generating'],
    ['failed', 'failed'], ['unknown', 'unknown'], ['expired', 'expired'],
  ];
  for (const [authStatus, progress] of map) {
    const vm = parse(approvedBody(FAST_COMPILED, authStatus, progress));
    assert.ok(vm, `auth=${authStatus}`);
    assert.equal(vm.lifecycle, 'approved');
    assert.equal(vm.progress, progress);
  }
});

// ── completed is an evidence claim ──────────────────────────────────────────

test('THE FALSE-COMPLETION CASE: completed with no receipt and no events is refused', () => {
  // This exact shape previously parsed and rendered "All 3 clips finished."
  // A status flag with zero completion evidence proves nothing finished.
  assert.equal(parse(approvedBody(FAST_COMPILED, 'completed', 'completed')), null);
});

test('the full evidence chain parses and carries the digests', () => {
  const vm = parse(completedBody(FAST_COMPILED));
  assert.ok(vm);
  assert.equal(vm.progress, 'completed');
  assert.equal(vm.receipt?.tasks.length, 3);
  assert.equal(vm.incurredCredits, 180);
  assert.equal(vm.receipt?.tasks[0].artifactSha256, artifactShaFor(0));
});

test('completed evidence: every missing or disagreeing link is refused', () => {
  // no receipt digest
  const noDigest = completedBody(FAST_COMPILED);
  (noDigest.receipt as Dict).receipt_digest = null;
  assert.equal(parse(noDigest), null, 'null receipt digest');

  // a receipt that does not cover every task
  const partial = completedBody(FAST_COMPILED);
  ((partial.receipt as Dict).tasks as Dict[]).pop();
  assert.equal(parse(partial), null, 'missing receipt row');

  // a row that did not succeed
  const failedRow = completedBody(FAST_COMPILED);
  ((failedRow.receipt as Dict).tasks as Dict[])[0].status = 'failed';
  assert.equal(parse(failedRow), null, 'row not succeeded');

  // a succeeded row with no artifact
  const noArtifact = completedBody(FAST_COMPILED);
  ((noArtifact.receipt as Dict).tasks as Dict[])[0].artifact = null;
  assert.equal(parse(noArtifact), null, 'row without artifact');

  // a row whose provider id disagrees with its events
  const providerDrift = completedBody(FAST_COMPILED);
  ((providerDrift.receipt as Dict).tasks as Dict[])[0].provider_task_id = providerId(7);
  assert.equal(parse(providerDrift), null, 'row provider id != events');

  // a row whose artifact digest disagrees with the succeeded event
  const shaDrift = completedBody(FAST_COMPILED);
  (((shaDrift.receipt as Dict).tasks as Dict[])[0].artifact as Dict).sha256 = 'f'.repeat(64);
  assert.equal(parse(shaDrift), null, 'row artifact != succeeded event artifact');

  // a task with no succeeded event on record (its start remains, so incurred
  // credits are unchanged — ONLY the missing success is at fault here)
  const noSuccess = completedBody(FAST_COMPILED);
  noSuccess.task_progress = (noSuccess.task_progress as Dict[]).filter((_, i) => i !== 1);
  assert.equal(parse(noSuccess), null, 'missing succeeded event');

  // a task with NO events at all (cost adjusted to agree with the remaining
  // starts, so only the completed chain can be what refuses)
  const noEvents = completedBody(FAST_COMPILED);
  noEvents.task_progress = (noEvents.task_progress as Dict[]).slice(2);
  (noEvents.cost as Dict).total_credits = 120;
  assert.equal(parse(noEvents), null, 'task with no events');
});

test('a receipt bound to a different authorization is refused', () => {
  const wrongAuth = completedBody(FAST_COMPILED);
  (wrongAuth.receipt as Dict).authorization_id = '00000000-1111-4222-8333-444444444444';
  assert.equal(parse(wrongAuth), null);
  const wrongDigest = completedBody(FAST_COMPILED);
  (wrongDigest.receipt as Dict).authorization_digest = 'e'.repeat(64);
  assert.equal(parse(wrongDigest), null);
});

// ── event contract ──────────────────────────────────────────────────────────

test('only contracted event types with their type-specific statuses parse', () => {
  const t1 = (FAST_COMPILED.tasks[0] as { task_id: string }).task_id;
  const base = (events: Dict[], incurred: number) => approvedBody(FAST_COMPILED, 'claimed', 'generating', {
    task_progress: events, cost: { total_credits: incurred, maximum_credits: 180 },
  });
  // the legal pair
  assert.ok(parse(base([createdEvent(t1, providerId(0))], 60)));
  // an unknown event type — in BOTH status dressings, so the type allowlist is
  // what rejects it, not a status check downstream of it
  assert.equal(parse(base([{ ...createdEvent(t1, providerId(0)), event_type: 'task_retried' }], 60)), null);
  assert.equal(
    parse(base([createdEvent(t1, providerId(0)), { ...succeededEvent(t1, providerId(0), artifactShaFor(0)), event_type: 'task_retried' }], 60)),
    null,
  );
  // type/status mismatch in both directions
  assert.equal(parse(base([{ ...createdEvent(t1, providerId(0)), status: 'succeeded' }], 60)), null);
  const success = succeededEvent(t1, providerId(0), artifactShaFor(0));
  assert.equal(parse(base([createdEvent(t1, providerId(0)), { ...success, status: 'created' }], 60)), null);
  // a missing provider task id
  assert.equal(parse(base([{ ...createdEvent(t1, providerId(0)), provider_task_id: null }], 60)), null);
});

test('duplicate events per (task, type) are refused', () => {
  const t1 = (FAST_COMPILED.tasks[0] as { task_id: string }).task_id;
  const body = approvedBody(FAST_COMPILED, 'claimed', 'generating', {
    task_progress: [createdEvent(t1, providerId(0)), createdEvent(t1, providerId(0))],
    cost: { total_credits: 60, maximum_credits: 180 },
  });
  assert.equal(parse(body), null);
});

test('a success must pair with its start on the same provider task', () => {
  const t1 = (FAST_COMPILED.tasks[0] as { task_id: string }).task_id;
  // success with no created event at all
  const unpaired = approvedBody(FAST_COMPILED, 'claimed', 'generating', {
    task_progress: [succeededEvent(t1, providerId(0), artifactShaFor(0))],
    cost: { total_credits: 0, maximum_credits: 180 },
  });
  assert.equal(parse(unpaired), null);
  // success under a DIFFERENT provider task than the start
  const mismatched = approvedBody(FAST_COMPILED, 'claimed', 'generating', {
    task_progress: [createdEvent(t1, providerId(0)), succeededEvent(t1, providerId(3), artifactShaFor(0))],
    cost: { total_credits: 60, maximum_credits: 180 },
  });
  assert.equal(parse(mismatched), null);
});

test('incurred credits must equal the credits of started tasks — in both directions', () => {
  const t1 = (FAST_COMPILED.tasks[0] as { task_id: string }).task_id;
  const events = [createdEvent(t1, providerId(0))];
  // understated: one clip started (60 credits) but cost claims 0
  const understated = approvedBody(FAST_COMPILED, 'claimed', 'generating', {
    task_progress: events, cost: { total_credits: 0, maximum_credits: 180 },
  });
  assert.equal(parse(understated), null);
  // overstated: nothing started but cost claims spend
  const overstated = approvedBody(FAST_COMPILED, 'claimed', 'generating', {
    task_progress: [], cost: { total_credits: 60, maximum_credits: 180 },
  });
  assert.equal(parse(overstated), null);
  // agreement parses and lands in the VM
  const agreed = parse(approvedBody(FAST_COMPILED, 'claimed', 'generating', {
    task_progress: events, cost: { total_credits: 60, maximum_credits: 180 },
  }));
  assert.equal(agreed?.incurredCredits, 60);
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
  // an event about a task this proposal does not contain — otherwise fully valid
  const foreignEvent = approvedBody(FAST_COMPILED, 'claimed', 'generating', {
    task_progress: [createdEvent('not-our-task', providerId(0))],
  });
  assert.equal(parse(foreignEvent), null);
  // a receipt row for a foreign task, inside otherwise-complete evidence
  const foreignReceipt = completedBody(FAST_COMPILED);
  ((foreignReceipt.receipt as Dict).tasks as Dict[])[0].task_id = 'not-our-task';
  assert.equal(parse(foreignReceipt), null);
});

test('a receipt row with a different prompt digest than its task is refused', () => {
  const body = completedBody(FAST_COMPILED);
  ((body.receipt as Dict).tasks as Dict[])[0].prompt_digest = 'f'.repeat(64);
  assert.equal(parse(body), null);
});

test('a receipt row with NO prompt digest is refused — absence is not agreement', () => {
  const body = completedBody(FAST_COMPILED);
  ((body.receipt as Dict).tasks as Dict[])[0].prompt_digest = null;
  assert.equal(parse(body), null);
});

test('duplicate receipt rows for one task are refused', () => {
  const body = completedBody(FAST_COMPILED);
  const rows = (body.receipt as Dict).tasks as Dict[];
  rows[1] = clone(rows[0]);
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
    task_progress: [createdEvent('hook-primary', providerId(0))],
  });
  assert.equal(parse(orphanEvents), null);
  // a receipt without an authorization
  const orphanReceipt = statusBody(FAST_COMPILED, {
    receipt: receiptFor([]),
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
  // ...and the FULLY-stripped variant: an internally-consistent empty graph
  // (production's shape) claiming to be available. Every coherence check
  // passes; only the approvable-must-propose-something rule can refuse it.
  const hollowAvailable = statusBody(PRODUCTION_COMPILED, { availability: true, unavailable_reason: null });
  const hollowProposal = hollowAvailable.proposal as Dict;
  hollowProposal.availability = true;
  hollowProposal.unavailable_reason = null;
  hollowProposal.required_missing_capabilities = [];
  assert.equal(parse(hollowAvailable), null);
});

test('malformed artifact digests in events are refused', () => {
  const bad = succeededEvent('hook-primary', providerId(0), ARTIFACT_SHA);
  (bad.artifact as Dict).sha256 = 'not-a-digest';
  const badEvent = approvedBody(FAST_COMPILED, 'claimed', 'generating', {
    task_progress: [createdEvent('hook-primary', providerId(0)), bad],
    cost: { total_credits: 60, maximum_credits: 180 },
  });
  assert.equal(parse(badEvent), null);
});

test('task_succeeded without the backend-required artifact digest is refused mid-flight', () => {
  const success = succeededEvent('hook-primary', providerId(0), ARTIFACT_SHA);
  success.artifact = null;
  const body = approvedBody(FAST_COMPILED, 'claimed', 'generating', {
    task_progress: [createdEvent('hook-primary', providerId(0)), success],
    cost: { total_credits: 60, maximum_credits: 180 },
  });
  assert.equal(parse(body), null);
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

// ── action responses go through THE parser ──────────────────────────────────
//
// Approve and cancel return the full proposal read. `{ok:true}` alone is not a
// confirmation — the response must parse, name THIS proposal, and be in the
// lifecycle the action claims to have produced.

test('approve is confirmed only by a parsed, own-identity, approved read', () => {
  const good = interpretActionResponse('approve', true, approvedBody(FAST_COMPILED, 'pending', 'pending'), PROPOSAL_ID);
  assert.equal(good.outcome, 'confirmed');
  assert.equal(good.outcome === 'confirmed' ? good.vm.lifecycle : null, 'approved');
});

test('THE BYPASS CASE: a malformed ok:true is never announced as approved', () => {
  const malformed = approvedBody(FAST_COMPILED, 'pending', 'pending');
  delete (malformed.proposal as Dict).tasks;
  assert.deepEqual(interpretActionResponse('approve', true, malformed, PROPOSAL_ID), { outcome: 'unconfirmed' });
  assert.deepEqual(interpretActionResponse('approve', true, { ok: true }, PROPOSAL_ID), { outcome: 'unconfirmed' });
});

test('an approved read for a DIFFERENT proposal never confirms this one', () => {
  const foreign = approvedBody(FAST_COMPILED, 'pending', 'pending');
  assert.deepEqual(interpretActionResponse('approve', true, foreign, 'some-other-proposal'), { outcome: 'unconfirmed' });
});

test('HTTP failure can never confirm an otherwise valid approved payload', () => {
  const approved = approvedBody(FAST_COMPILED, 'pending', 'pending');
  assert.deepEqual(interpretActionResponse('approve', false, approved, PROPOSAL_ID), { outcome: 'unconfirmed' });
});

test('a valid read in the WRONG lifecycle is unconfirmed, not success', () => {
  // The server answered, but the proposal is still awaiting approval — announcing
  // approval now would claim an authorization that does not exist.
  assert.deepEqual(interpretActionResponse('approve', true, statusBody(FAST_COMPILED), PROPOSAL_ID), { outcome: 'unconfirmed' });
  // ...and a cancel that reads anything but cancelled is equally unconfirmed.
  assert.deepEqual(
    interpretActionResponse('cancel', true, approvedBody(FAST_COMPILED, 'pending', 'pending'), PROPOSAL_ID),
    { outcome: 'unconfirmed' },
  );
});

test('cancel is confirmed only by a cancelled read', () => {
  const cancelled = statusBody(FAST_COMPILED, { lifecycle_state: 'cancelled', progress_state: 'cancelled' });
  const read = interpretActionResponse('cancel', true, cancelled, PROPOSAL_ID);
  assert.equal(read.outcome, 'confirmed');
});

test('cancel also requires HTTP success and this proposal identity', () => {
  const cancelled = statusBody(FAST_COMPILED, { lifecycle_state: 'cancelled', progress_state: 'cancelled' });
  assert.deepEqual(interpretActionResponse('cancel', false, cancelled, PROPOSAL_ID), { outcome: 'unconfirmed' });
  assert.deepEqual(interpretActionResponse('cancel', true, cancelled, 'some-other-proposal'), { outcome: 'unconfirmed' });
});

test('refusals carry their machine code; unverifiable answers do not become refusals', () => {
  assert.deepEqual(
    interpretActionResponse('approve', false, { ok: false, error: 'stale_proposal' }, PROPOSAL_ID),
    { outcome: 'refused', code: 'stale_proposal' },
  );
  // `unavailable` marks an answer the backend could not verify — possibly a
  // landed approve. It must read as unconfirmed, never as a refusal.
  assert.deepEqual(
    interpretActionResponse('approve', false, { ok: false, error: 'proposal_read_failed', unavailable: true }, PROPOSAL_ID),
    { outcome: 'unconfirmed' },
  );
  assert.deepEqual(interpretActionResponse('approve', false, null, PROPOSAL_ID), { outcome: 'unconfirmed' });
  assert.deepEqual(interpretActionResponse('approve', true, 'ok', PROPOSAL_ID), { outcome: 'unconfirmed' });
});
