// node --test lib/professional-v2-entry.test.ts
//
// The entry boundary: preview, create, and the approval gate.
//
// Every response body here is REAL wire output from the pinned backend producer
// (previews and creates driven through generation-proposal.service.js itself), so
// "the parser accepts what the backend sends" is demonstrated rather than assumed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  approvalRefFor, decideProfessionalApproval, decideProfessionalEdit,
  interpretProfessionalApprovalResponse, interpretProfessionalCancelResponse,
  invalidateApprovalRef, parseProfessionalV2CreateResponse, parseProfessionalV2PreviewResponse,
  professionalEntryError, reconcileProposal, timelineFromCompiledProposal,
} from './professional-v2-entry.ts';
import { toRequestMoments, validateTimeline } from './professional-v2-timeline.ts';
import { parseProfessionalV2ProposalResponse } from './generation-proposal-v2-envelope.ts';
import { timelineFingerprint, type TimelineMoment } from './professional-v2-timeline.ts';
import {
  V1_PREVIEW_FAST, V2_CREATE_AVAILABLE, V2_CREATE_UNAVAILABLE, V2_GET_AWAITING_APPROVAL,
  V2_GET_UNAVAILABLE, V2_PREVIEW_AVAILABLE, V2_PREVIEW_MULTI, V2_PREVIEW_UNAVAILABLE,
} from './professional-v2.fixtures.ts';

type Doc = Record<string, unknown>;
const clone = <T>(v: T): Doc => structuredClone(v) as unknown as Doc;

const AGENT = 'daily-ig-reel';
const RUN_ID = '7c9e1b44-2f36-4d58-9a02-6e5b8c1d3f77';
// The exact validated source every fixture was compiled against, and its
// authoritative Desktop-probed length. A run is not a source (0158): the entry
// identity names the ARTIFACT, because two final videos in one run need not be
// the same length.
const SOURCE_ARTIFACT_ID = 'b8a1d20c-4e73-4f19-9c8a-5d2e6f70b134';
const SOURCE_MEDIA_DURATION_MS = 600000;
/** Just after the fixture's created_at, and well before its 30-minute expiry. */
const NOW = Date.parse('2026-08-04T17:05:00.000Z');
/** The id the fixture generator's fake table layer assigns on insert. */
const PROPOSAL_ID = 'd41f6a80-5b2c-4e19-8f36-1a7c9d0e2b43';

/** The timeline the fixture generator submitted, rebuilt from the compiled graph. */
function timelineOf(fixture: { proposal: { professional_control: { moments: readonly unknown[] } } }): TimelineMoment[] {
  return (fixture.proposal.professional_control.moments as Array<Record<string, never>>).map((m) => {
    const moment = m as unknown as {
      moment_id: string; prompt: string; ratio: string; variants_requested: number;
      judge_mode: 'off' | 'ranked'; repair_policy: { max_repairs: number };
      timestamp: { start_ms: number; end_ms: number };
    };
    return {
      id: moment.moment_id, prompt: moment.prompt,
      startSeconds: moment.timestamp.start_ms / 1000,
      endSeconds: moment.timestamp.end_ms / 1000,
      ratio: moment.ratio,
      variantsRequested: moment.variants_requested,
      judgeMode: moment.judge_mode,
      maxRepairs: moment.repair_policy.max_repairs,
    };
  });
}

const expectedFor = (fixture: Parameters<typeof timelineOf>[0]) => ({
  agentSubject: AGENT, sourceRunId: RUN_ID,
  sourceArtifactId: SOURCE_ARTIFACT_ID, mediaDurationMs: SOURCE_MEDIA_DURATION_MS,
  moments: timelineOf(fixture),
});

// ── preview ──────────────────────────────────────────────────────────────────

test('a real preview parses and binds to the submitted timeline', () => {
  for (const fixture of [V2_PREVIEW_UNAVAILABLE, V2_PREVIEW_AVAILABLE, V2_PREVIEW_MULTI]) {
    const compiled = parseProfessionalV2PreviewResponse(clone(fixture), expectedFor(fixture));
    assert.ok(compiled, JSON.stringify(fixture.proposal.professional_control.moments.length));
    assert.equal(compiled.controlContractVersion, 'professional-generation-control.v2');
    assert.deepEqual(reconcileProposal(timelineOf(fixture), compiled), { ok: true });
  }
});

test('a preview for a DIFFERENT plan than the one submitted is refused', () => {
  const base = timelineOf(V2_PREVIEW_AVAILABLE);
  const drifts: Array<Partial<TimelineMoment>> = [
    { prompt: 'a different shot entirely' },
    { startSeconds: 1 },
    { endSeconds: 5 },
    { variantsRequested: 3 },
    { judgeMode: 'off', maxRepairs: 0 },
    { maxRepairs: 0 },
    { id: 'other' },
  ];
  for (const drift of drifts) {
    assert.equal(
      parseProfessionalV2PreviewResponse(clone(V2_PREVIEW_AVAILABLE), {
        agentSubject: AGENT, sourceRunId: RUN_ID,
    sourceArtifactId: SOURCE_ARTIFACT_ID, mediaDurationMs: SOURCE_MEDIA_DURATION_MS,
        sourceArtifactId: SOURCE_ARTIFACT_ID, mediaDurationMs: SOURCE_MEDIA_DURATION_MS,
        moments: [{ ...base[0], ...drift }],
      }), null, JSON.stringify(drift),
    );
  }
  // A different agent or source run is a proposal about someone else's work.
  assert.equal(parseProfessionalV2PreviewResponse(clone(V2_PREVIEW_AVAILABLE), {
    ...expectedFor(V2_PREVIEW_AVAILABLE), agentSubject: 'another-agent',
  }), null);
  assert.equal(parseProfessionalV2PreviewResponse(clone(V2_PREVIEW_AVAILABLE), {
    ...expectedFor(V2_PREVIEW_AVAILABLE), sourceRunId: '00000000-0000-4000-8000-000000000000',
  }), null);
});

test('a v1 preview is refused where v2 was requested', () => {
  assert.equal(parseProfessionalV2PreviewResponse(clone(V1_PREVIEW_FAST), {
    agentSubject: AGENT, sourceRunId: RUN_ID,
    moments: [{
      id: 'hook', prompt: 'a camera moving over bay area bridge', startSeconds: 0, endSeconds: 3,
      ratio: '720:1280', variantsRequested: 1, judgeMode: 'off', maxRepairs: 0,
    }],
  }), null);
});

test('a preview carrying a durable identity is not a preview', () => {
  for (const mutate of [
    (b: Doc) => { b.proposal_id = 'd41f6a80-5b2c-4e19-8f36-1a7c9d0e2b43'; },
    (b: Doc) => { b.state = 'awaiting_approval'; },
    (b: Doc) => { b.expires_at = '2026-08-04T17:30:00.000Z'; },
    (b: Doc) => { b.created_at = '2026-08-04T17:00:00.000Z'; },
    (b: Doc) => { b.ok = false; },
  ]) {
    const body = clone(V2_PREVIEW_AVAILABLE);
    mutate(body);
    assert.equal(parseProfessionalV2PreviewResponse(body, expectedFor(V2_PREVIEW_AVAILABLE)), null);
  }
});

test('an envelope that contradicts its own compiled document is refused', () => {
  for (const mutate of [
    (b: Doc) => { b.availability = !(b.availability as boolean); },
    (b: Doc) => { b.unavailable_reason = 'something_else'; },
    (b: Doc) => { b.required_missing_capabilities = ['server.control_plane_v1']; },
    (b: Doc) => { (b.identity as Doc).capability_key = 'video.other'; },
  ]) {
    const body = clone(V2_PREVIEW_UNAVAILABLE);
    mutate(body);
    assert.equal(parseProfessionalV2PreviewResponse(body, expectedFor(V2_PREVIEW_UNAVAILABLE)), null);
  }
});

// ── create ───────────────────────────────────────────────────────────────────

test('a real create parses, and its persisted state must BE its availability', () => {
  const available = parseProfessionalV2CreateResponse(clone(V2_CREATE_AVAILABLE), expectedFor(V2_CREATE_AVAILABLE));
  assert.ok(available);
  assert.equal(available.state, 'awaiting_approval');
  assert.equal(available.compiled.availability, true);

  const unavailable = parseProfessionalV2CreateResponse(clone(V2_CREATE_UNAVAILABLE), expectedFor(V2_CREATE_UNAVAILABLE));
  assert.ok(unavailable);
  // With the Professional flags false this is the ONLY create the product can
  // produce: a saved plan that is honestly unavailable and cannot be approved.
  assert.equal(unavailable.state, 'unavailable');
  assert.equal(unavailable.compiled.availability, false);

  // A row claiming awaiting_approval for an unavailable document would offer an
  // approval the backend refuses — and would tell the user Professional is live.
  const lying = clone(V2_CREATE_UNAVAILABLE);
  lying.state = 'awaiting_approval';
  assert.equal(parseProfessionalV2CreateResponse(lying, expectedFor(V2_CREATE_UNAVAILABLE)), null);
});

test('a create whose identity block does not agree with itself is refused', () => {
  for (const mutate of [
    (b: Doc) => { (b.identity as Doc).proposal_digest = 'f'.repeat(64); },
    (b: Doc) => { (b.identity as Doc).proposal_id = 'd41f6a80-5b2c-4e19-8f36-1a7c9d0e2b44'; },
    (b: Doc) => { (b.identity as Doc).proposal_version = 'generation-quality.v2'; },
    (b: Doc) => { (b.identity as Doc).authorization_id = 'd41f6a80-5b2c-4e19-8f36-1a7c9d0e2b43'; },
    (b: Doc) => { (b.identity as Doc).user_id = 'not-a-uuid'; },
    (b: Doc) => { b.proposal_id = 'not-a-uuid'; },
    (b: Doc) => { b.expires_at = b.created_at; },
  ]) {
    const body = clone(V2_CREATE_AVAILABLE);
    mutate(body);
    assert.equal(parseProfessionalV2CreateResponse(body, expectedFor(V2_CREATE_AVAILABLE)), null);
  }
});

// ── the approval boundary ────────────────────────────────────────────────────

function approvableVm() {
  const vm = parseProfessionalV2ProposalResponse(clone(V2_GET_AWAITING_APPROVAL));
  assert.ok(vm, 'the awaiting-approval read fixture must parse');
  return vm;
}

const gateInput = (over: Partial<Parameters<typeof decideProfessionalApproval>[0]> = {}) => {
  const vm = over.vm ?? approvableVm();
  return {
    vm,
    ref: approvalRefFor(vm, null),
    currentTimelineFingerprint: null,
    confirmedMaximumCredits: vm.compiled.maximumCredits,
    idempotencyKey: 'approve-6f2a1c34-9d55-4b7e-8a01-2c3d4e5f6071',
    inFlight: false,
    now: NOW,
    ...over,
  };
};

test('a complete, confirmed, unedited approval is allowed exactly once', () => {
  const input = gateInput();
  const decision = decideProfessionalApproval(input);
  assert.equal(decision.ok, true);
  assert.deepEqual(decision.ok ? decision.request : null, {
    action: 'approve',
    proposalId: input.vm.proposalId,
    proposalVersion: input.vm.proposalVersion,
    proposalDigest: input.vm.proposalDigest,
    idempotencyKey: input.idempotencyKey,
  });
  // Single flight: the second click, while the first is in the air, sends nothing.
  assert.equal(decideProfessionalApproval({ ...input, inFlight: true }).ok, false);
});

test('an unavailable proposal can never be approved', () => {
  const vm = parseProfessionalV2ProposalResponse(clone(V2_GET_UNAVAILABLE));
  assert.ok(vm);
  assert.equal(vm.compiled.availability, false);
  const decision = decideProfessionalApproval(gateInput({ vm, ref: approvalRefFor(vm, null) }));
  assert.equal(decision.ok, false);
  assert.equal(decision.ok ? null : decision.code, 'unavailable');
});

test('the hard maximum must be confirmed explicitly, and exactly', () => {
  const input = gateInput();
  for (const confirmed of [null, 0, input.vm.compiled.maximumCredits - 1, input.vm.compiled.maximumCredits + 1,
    input.vm.compiled.initialCredits]) {
    const decision = decideProfessionalApproval({ ...input, confirmedMaximumCredits: confirmed });
    assert.equal(decision.ok, false, String(confirmed));
    assert.equal(decision.ok ? null : decision.code, 'ceiling_not_confirmed', String(confirmed));
  }
  // Confirming the EXPECTED spend is not confirming the ceiling: the reserve is
  // the part a user is most likely to miss.
  assert.notEqual(input.vm.compiled.initialCredits, input.vm.compiled.maximumCredits);
});

test('editing invalidates the approval identity, and nothing restores it locally', () => {
  const input = gateInput();
  const decision = decideProfessionalApproval({ ...input, ref: invalidateApprovalRef() });
  assert.equal(decision.ok, false);
  assert.equal(decision.ok ? null : decision.code, 'edited');
});

test('a reference bound to a different plan, digest or graph cannot approve', () => {
  const input = gateInput();
  const cases: Array<[string, Record<string, unknown>]> = [
    ['identity_mismatch', { proposalId: 'd41f6a80-5b2c-4e19-8f36-1a7c9d0e2b44' }],
    ['identity_mismatch', { proposalDigest: 'a'.repeat(64) }],
    ['identity_mismatch', { proposalVersion: 'generation-quality.v2' }],
    ['graph_changed', { graphDigest: 'b'.repeat(64) }],
  ];
  for (const [code, patch] of cases) {
    const decision = decideProfessionalApproval({ ...input, ref: { ...input.ref, ...patch } });
    assert.equal(decision.ok, false, code);
    assert.equal(decision.ok ? null : decision.code, code, JSON.stringify(patch));
  }
});

test('a timeline that moved since the preview cannot approve the old proposal', () => {
  const vm = approvableVm();
  const moments = timelineOf(V2_GET_AWAITING_APPROVAL as unknown as Parameters<typeof timelineOf>[0]);
  const ref = approvalRefFor(vm, moments);
  assert.equal(decideProfessionalApproval(gateInput({
    vm, ref, currentTimelineFingerprint: timelineFingerprint(moments),
  })).ok, true);
  const edited = [{ ...moments[0], prompt: 'a completely different shot' }, ...moments.slice(1)];
  const decision = decideProfessionalApproval(gateInput({
    vm, ref, currentTimelineFingerprint: timelineFingerprint(edited),
  }));
  assert.equal(decision.ok, false);
  assert.equal(decision.ok ? null : decision.code, 'timeline_changed');
});

test('an expired proposal, or one not awaiting approval, cannot approve', () => {
  const input = gateInput();
  const expired = decideProfessionalApproval({ ...input, now: Date.parse(input.vm.expiresAt) + 1 });
  assert.equal(expired.ok ? null : expired.code, 'expired');
  const cancelled = decideProfessionalApproval({
    ...input, vm: { ...input.vm, lifecycle: 'cancelled', progress: 'cancelled' },
  });
  assert.equal(cancelled.ok ? null : cancelled.code, 'not_awaiting_approval');
});

test('a malformed idempotency key is refused before it can burn the one attempt', () => {
  for (const key of ['', 'short', '.leading-dot-is-invalid', 'x'.repeat(200), 'has spaces here']) {
    const decision = decideProfessionalApproval(gateInput({ idempotencyKey: key }));
    assert.equal(decision.ok, false, key);
    assert.equal(decision.ok ? null : decision.code, 'invalid_idempotency_key', key);
  }
});

test('approval is CONFIRMED only by a response that parses and matches', () => {
  const vm = approvableVm();
  const ref = approvalRefFor(vm, null);
  // A bare ok:true is not an approval.
  assert.deepEqual(interpretProfessionalApprovalResponse(true, { ok: true }, ref), { outcome: 'unverified' });
  // The awaiting-approval read is a valid document but is NOT an approval.
  assert.deepEqual(
    interpretProfessionalApprovalResponse(true, clone(V2_GET_AWAITING_APPROVAL), ref), { outcome: 'unverified' },
  );
  // A typed refusal is a refusal; an unreadable answer is never one.
  assert.deepEqual(
    interpretProfessionalApprovalResponse(false, { ok: false, error: 'proposal_expired' }, ref),
    { outcome: 'refused', code: 'proposal_expired' },
  );
  assert.deepEqual(
    interpretProfessionalApprovalResponse(false, { ok: false, error: 'proposal_read_failed', unavailable: true }, ref),
    { outcome: 'unverified' },
  );
  assert.deepEqual(interpretProfessionalApprovalResponse(false, null, ref), { outcome: 'unverified' });
  // A well-formed read of a DIFFERENT proposal never confirms this one.
  assert.deepEqual(
    interpretProfessionalApprovalResponse(true, clone(V2_GET_AWAITING_APPROVAL), {
      ...ref, proposalId: 'd41f6a80-5b2c-4e19-8f36-1a7c9d0e2b44',
    }), { outcome: 'unverified' },
  );
  assert.deepEqual(interpretProfessionalApprovalResponse(true, clone(V2_GET_AWAITING_APPROVAL), invalidateApprovalRef()), { outcome: 'unverified' });
});

// ── the edit lifecycle ───────────────────────────────────────────────────────

test('a compiled plan round-trips back into an editable timeline, unchanged', () => {
  for (const fixture of [V2_PREVIEW_AVAILABLE, V2_PREVIEW_MULTI, V2_PREVIEW_UNAVAILABLE]) {
    const compiled = parseProfessionalV2PreviewResponse(clone(fixture), expectedFor(fixture));
    assert.ok(compiled);
    const timeline = timelineFromCompiledProposal(compiled);
    assert.ok(timeline, 'a real compiled plan must be editable');
    // THE POINT OF THE SEED: editing must not lose the plan. Every field the user
    // chose comes back, in order.
    assert.deepEqual(timeline, timelineOf(fixture));
    assert.equal(validateTimeline(timeline).ok, true);
    // And re-submitting the seeded timeline reproduces the same request, so the
    // edit starts from the plan rather than from a blank builder.
    assert.deepEqual(
      toRequestMoments(timeline),
      fixture.proposal.professional_control.moments.map((m) => ({
        id: m.moment_id, prompt: m.prompt,
        start_seconds: m.timestamp.start_ms / 1000, end_seconds: m.timestamp.end_ms / 1000,
        ratio: m.ratio, variants_requested: m.variants_requested,
        judge_mode: m.judge_mode, max_repairs: m.repair_policy.max_repairs,
      })),
    );
  }
});

test('an approvable plan must be RETIRED before it can be edited', () => {
  const vm = approvableVm();
  assert.equal(vm.lifecycle, 'awaiting_approval');
  const decision = decideProfessionalEdit(vm);
  assert.deepEqual(decision, { ok: true, mustRetire: true });
});

test('a plan that was never approvable has nothing to retire', () => {
  const vm = parseProfessionalV2ProposalResponse(clone(V2_GET_UNAVAILABLE));
  assert.ok(vm);
  assert.deepEqual(decideProfessionalEdit(vm), { ok: true, mustRetire: false });
  for (const lifecycle of ['cancelled', 'expired'] as const) {
    assert.deepEqual(decideProfessionalEdit({ lifecycle }), { ok: true, mustRetire: false });
  }
});

test('an approved plan cannot be edited at all — the money is committed', () => {
  const decision = decideProfessionalEdit({ lifecycle: 'approved' });
  assert.equal(decision.ok, false);
  assert.match(decision.ok ? '' : decision.reason, /already approved/);
});

test('retirement is CONFIRMED only by a parsed, matching, cancelled read', () => {
  const cancelled = clone(V2_GET_AWAITING_APPROVAL);
  cancelled.lifecycle_state = 'cancelled';
  cancelled.progress_state = 'cancelled';
  assert.equal(interpretProfessionalCancelResponse(true, cancelled, PROPOSAL_ID), 'cancelled');
  // A bare ok:true, or a still-approvable read, is NOT a retirement — and the
  // editor only opens on a confirmed one, so an unverified answer leaves the
  // plan visibly approvable instead of silently abandoned.
  assert.equal(interpretProfessionalCancelResponse(true, { ok: true }, PROPOSAL_ID), 'unverified');
  assert.equal(interpretProfessionalCancelResponse(true, clone(V2_GET_AWAITING_APPROVAL), PROPOSAL_ID), 'unverified');
  // A cancellation of someone else's proposal never counts as this one's.
  assert.equal(interpretProfessionalCancelResponse(true, cancelled, 'd41f6a80-5b2c-4e19-8f36-1a7c9d0e2b44'), 'unverified');
  assert.equal(interpretProfessionalCancelResponse(false, { ok: false, error: 'proposal_not_cancellable' }, PROPOSAL_ID), 'refused');
  assert.equal(interpretProfessionalCancelResponse(false, { ok: false, error: 'x', unavailable: true }, PROPOSAL_ID), 'unverified');
  assert.equal(interpretProfessionalCancelResponse(false, null, PROPOSAL_ID), 'unverified');
});

test('a seeded edit carries no approval identity, so a fresh preview is unavoidable', () => {
  const compiled = parseProfessionalV2PreviewResponse(clone(V2_PREVIEW_MULTI), expectedFor(V2_PREVIEW_MULTI));
  assert.ok(compiled);
  const timeline = timelineFromCompiledProposal(compiled);
  assert.ok(timeline);
  // The seed is moments and nothing else — no proposal id, version, digest or
  // graph digest travels with it, so nothing downstream can approve the plan the
  // moments came from.
  for (const moment of timeline) {
    assert.deepEqual(Object.keys(moment).sort(), [
      'endSeconds', 'id', 'judgeMode', 'maxRepairs', 'prompt', 'ratio', 'startSeconds', 'variantsRequested',
    ]);
  }
  assert.equal(JSON.stringify(timeline).includes(compiled.graphDigest), false);
  assert.equal(JSON.stringify(timeline).includes(compiled.proposalDigest), false);
});

test('create failures never read as "nothing happened"', () => {
  assert.match(professionalEntryError(false, null, 'create', null), /couldn.t confirm whether the proposal was created/);
  assert.match(professionalEntryError(false, { unavailable: true }, 'create', 503), /couldn.t confirm/);
  assert.match(professionalEntryError(false, { error: 'invalid_moments' }, 'preview', 400), /invalid_moments/);
  assert.match(professionalEntryError(true, {}, 'preview', 200), /unexpected form/);
});
