// node --test lib/generation-proposal-entry.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  beginProposalCreate, parseGenerationCreateResponse, parseGenerationPreviewResponse,
  parseGenerationPreviewSet, proposalCreateLabel, proposalEntryError, proposalSummaryLine,
  validateGenerationMoment,
} from './generation-proposal-entry.ts';
import {
  FAST_LIVE_COMPILED, PROFESSIONAL_LIVE_COMPILED, PROFESSIONAL_LIVE_UNAVAILABLE_COMPILED,
  PRODUCTION_LIVE_COMPILED,
} from './generation-proposal.fixtures.ts';

const RUN_ID = '52f93684-6cd5-49b1-b183-671e9fcfb4a5';
const PROPOSAL_ID = '4c1d16a8-9f7e-4b7a-8a55-2e9d0f6b3c21';
const USER_ID = 'b15ce0cc-3e6a-4d7d-84bf-1f514f845ffc';
const ORG_ID = 'a526071d-2350-433b-ae75-4447b3368af6';
// The exact moment the browser entry point builds, and the fixtures the backend
// compiles from it. These are REAL compiler output: a previous version of this
// harness sliced the multi-moment fixtures down by hand, which silently dropped
// Professional's repair reserve and tested the parser against a document the
// compiler cannot emit.
const MOMENT = {
  id: 'hook', prompt: 'a camera moving over bay area bridge',
  startSeconds: 0, endSeconds: 3,
};

function compiledFor(
  mode: 'fast' | 'professional' | 'production',
  { available = true } = {},
): Record<string, unknown> {
  const source = mode === 'fast'
    ? FAST_LIVE_COMPILED
    : mode === 'professional'
      ? (available ? PROFESSIONAL_LIVE_COMPILED : PROFESSIONAL_LIVE_UNAVAILABLE_COMPILED)
      : PRODUCTION_LIVE_COMPILED;
  return structuredClone(source) as unknown as Record<string, unknown>;
}

function expected(mode: 'fast' | 'professional' | 'production') {
  return { agentSubject: 'cinematic-b-roll-generator', sourceRunId: RUN_ID, qualityMode: mode, moment: MOMENT } as const;
}

function preview(mode: 'fast' | 'professional' | 'production', opts: { available?: boolean } = {}) {
  const proposal = compiledFor(mode, opts);
  return {
    ok: true, proposal_id: null, state: 'proposed',
    availability: proposal.availability,
    unavailable_reason: proposal.unavailable_reason,
    required_missing_capabilities: proposal.required_missing_capabilities,
    identity: {
      capability_key: 'video.generate_broll', agent_subject: 'cinematic-b-roll-generator',
      source_run_id: RUN_ID, source_request_id: null,
    },
    expires_at: null, created_at: null, proposal,
  };
}

function created(mode: 'fast' | 'professional' | 'production', opts: { available?: boolean } = {}) {
  const body = preview(mode, opts) as Record<string, any>;
  body.proposal_id = PROPOSAL_ID;
  body.state = body.proposal.availability === true ? 'awaiting_approval' : 'unavailable';
  body.created_at = '2026-08-01T20:00:00.000Z';
  body.expires_at = '2026-08-01T20:30:00.000Z';
  body.identity = {
    ...body.identity, user_id: USER_ID, organization_id: ORG_ID,
    proposal_id: PROPOSAL_ID, proposal_version: 'generation-quality.v1',
    proposal_digest: body.proposal.proposal_digest,
    authorization_id: null, authorization_digest: null,
  };
  return body;
}

test('all three preview modes parse with their exact compiled behavior', () => {
  assert.equal(parseGenerationPreviewResponse(preview('fast'), expected('fast'))?.availability, true);
  assert.equal(parseGenerationPreviewResponse(preview('production'), expected('production'))?.tasks.length, 0);

  // Professional carries THREE tasks for one moment: two candidates plus the
  // bounded repair reserve, priced into the 108-credit ceiling. Binding it to
  // two tasks is what made the live comparison refuse to render at all.
  const professional = parseGenerationPreviewResponse(preview('professional'), expected('professional'));
  assert.ok(professional, 'the live approvable Professional preview must parse');
  assert.equal(professional.tasks.length, 3);
  assert.equal(professional.candidateCount, 2);
  assert.equal(professional.repairCount, 1);
  assert.equal(professional.availability, true);
  assert.equal(professional.initialCredits, 72);
  assert.equal(professional.repairReserveCredits, 36);
  assert.equal(professional.maximumCredits, 108);
});

test('the repair reserve is bound to the typed prompt, not merely counted', () => {
  // A reserve carrying someone else's intent is still 36 credits of the user's
  // money, so it is identity-bound exactly like the candidates are.
  const body = preview('professional') as Record<string, any>;
  body.proposal.tasks[2].prompt_text = 'Corrective regeneration of an unrelated moment.';
  assert.equal(parseGenerationPreviewResponse(body, expected('professional')), null);

  // And it must belong to the moment the user typed.
  const foreign = preview('professional') as Record<string, any>;
  foreign.proposal.tasks[2].moment_id = 'other';
  assert.equal(parseGenerationPreviewResponse(foreign, expected('professional')), null);
});

test('an unavailable Professional preview still parses, so the comparison stays whole', () => {
  // When the server flags or the machine attestation do not hold, Professional
  // is a PREVIEW. It must still render beside the other modes — refusing it
  // would blank the whole comparison, which is the failure this file guards.
  const vm = parseGenerationPreviewResponse(preview('professional', { available: false }), expected('professional'));
  assert.ok(vm);
  assert.equal(vm.availability, false);
  assert.equal(vm.unavailableReason, 'missing_required_professional_execution_capabilities');
  assert.equal(vm.repairCount, 1);
});

test('mode comparison refuses a partial preview set', () => {
  const set = { fast: preview('fast'), professional: preview('professional'), production: preview('production') };
  const whole = parseGenerationPreviewSet(set, {
    agentSubject: 'cinematic-b-roll-generator', sourceRunId: RUN_ID, moment: MOMENT,
  });
  // The comparison the user actually sees: fast and professional both offerable,
  // production still gated. Professional showing 108 credits across 2 clips plus
  // a reserve is the whole point of the mode being selectable at all.
  assert.ok(whole);
  assert.equal(whole.fast.availability, true);
  assert.equal(whole.professional.availability, true);
  assert.equal(whole.professional.maximumCredits, 108);
  assert.equal(whole.production.availability, false);
  (set.professional as any).identity.source_run_id = USER_ID;
  assert.equal(parseGenerationPreviewSet(set, {
    agentSubject: 'cinematic-b-roll-generator', sourceRunId: RUN_ID, moment: MOMENT,
  }), null);

  const missingProduction = { fast: preview('fast'), professional: preview('professional'), production: null };
  assert.equal(parseGenerationPreviewSet(missingProduction as any, {
    agentSubject: 'cinematic-b-roll-generator', sourceRunId: RUN_ID, moment: MOMENT,
  }), null);
});

test('preview is bound to this run, agent, mode, prompt, and timestamp', () => {
  for (const mutate of [
    (b: any) => { b.identity.source_run_id = USER_ID; },
    (b: any) => { b.identity.agent_subject = 'another-agent'; },
    (b: any) => { b.proposal.quality_mode = 'professional'; },
    (b: any) => { b.proposal.tasks[0].prompt_text = 'Different work'; },
    (b: any) => { b.proposal.tasks[0].timestamp.start_seconds = 1; },
    (b: any) => { b.proposal.tasks[0].timestamp.end_seconds = 6; },
    (b: any) => { b.availability = false; },
    (b: any) => { b.proposal_id = PROPOSAL_ID; },
  ]) {
    const body = preview('fast'); mutate(body);
    assert.equal(parseGenerationPreviewResponse(body, expected('fast')), null);
  }

  assert.equal(parseGenerationPreviewResponse(preview('fast'), expected('production')), null);
  assert.equal(parseGenerationPreviewResponse(preview('production'), expected('fast')), null);
});

test('create accepts only the persisted identity and availability-derived state', () => {
  assert.deepEqual(parseGenerationCreateResponse(created('fast'), expected('fast'))?.proposalId, PROPOSAL_ID);
  // State is DERIVED from compiled availability, not asserted per mode: an
  // approvable Professional creates awaiting_approval, an unavailable one
  // creates unavailable, and a response whose state contradicts its own
  // proposal is refused (covered by the mutation loop below).
  assert.equal(parseGenerationCreateResponse(created('professional'), expected('professional'))?.state, 'awaiting_approval');
  assert.equal(
    parseGenerationCreateResponse(created('professional', { available: false }), expected('professional'))?.state,
    'unavailable',
  );
  assert.equal(parseGenerationCreateResponse(created('production'), expected('production'))?.state, 'unavailable');

  // An approvable Professional create claiming 'unavailable' — or the reverse —
  // is a lifecycle the user could be shown while the truth is the opposite.
  const mismatched = created('professional') as Record<string, any>;
  mismatched.state = 'unavailable';
  assert.equal(parseGenerationCreateResponse(mismatched, expected('professional')), null);

  for (const mutate of [
    (b: any) => { b.identity.proposal_id = USER_ID; },
    (b: any) => { b.identity.proposal_digest = 'b'.repeat(64); },
    (b: any) => { b.identity.authorization_id = USER_ID; },
    (b: any) => { b.identity.authorization_digest = 'b'.repeat(64); },
    (b: any) => { b.state = 'unavailable'; },
    (b: any) => { b.expires_at = b.created_at; },
    (b: any) => { b.proposal.tasks[0].moment_id = 'other'; },
  ]) {
    const body = created('fast'); mutate(body);
    assert.equal(parseGenerationCreateResponse(body, expected('fast')), null);
  }
});

test('moment validation pins the paid compiler window', () => {
  assert.equal(validateGenerationMoment(MOMENT), null);
  assert.match(validateGenerationMoment({ ...MOMENT, prompt: '' }) || '', /Describe/);
  assert.match(validateGenerationMoment({ ...MOMENT, endSeconds: 1 }) || '', /between 2 and 10/);
  assert.match(validateGenerationMoment({ ...MOMENT, endSeconds: 11 }) || '', /between 2 and 10/);
  assert.match(validateGenerationMoment({ ...MOMENT, startSeconds: 0.0001 }) || '', /valid timestamp/);
});

test('entry errors distinguish unavailable from affirmative refusal', () => {
  assert.match(proposalEntryError(false, { unavailable: true }), /reliable answer/);
  assert.equal(proposalEntryError(false, { error: 'invalid_moments' }), 'The proposal was refused (invalid_moments).');
  assert.match(proposalEntryError(true, { ok: true }), /unexpected form/);
  assert.match(proposalEntryError(false, { error: 'internal_error' }, 'create', 500), /couldn't confirm whether/);
  assert.match(proposalEntryError(false, { unavailable: true }, 'create', null), /Reload this run/);
  assert.equal(
    proposalEntryError(false, { error: 'invalid_moments' }, 'create', 400),
    'The proposal was refused (invalid_moments).',
  );
});

test('the proposal create latch admits exactly one synchronous flight', () => {
  const flight = { current: false };
  assert.equal(beginProposalCreate(flight, 'ready', true, true), true);
  assert.equal(flight.current, true);
  assert.equal(beginProposalCreate(flight, 'ready', true, true), false);
  for (const args of [
    ['idle', true, true], ['ready', false, true], ['ready', true, false],
  ] as const) {
    assert.equal(beginProposalCreate({ current: false }, ...args), false);
  }
});

// ── what the builder SAYS it will do ────────────────────────────────────────

test('the create button names the SELECTED mode, never a fixed one', () => {
  // REGRESSION: this label was hard-coded to "Create Quick proposal" while the
  // selector offered three modes. Selecting Professional showed a button
  // promising Quick — a control in a paid flow naming the wrong mode, at three
  // times the credits.
  assert.equal(proposalCreateLabel('fast'), 'Create Quick proposal');
  assert.equal(proposalCreateLabel('professional'), 'Create Professional proposal');
  assert.equal(proposalCreateLabel('production'), 'Create Production proposal');
});

test('the summary counts CLIPS and names the reserve separately', () => {
  // REGRESSION: this read "3 clips · up to 108 credits" for a proposal that
  // generates TWO clips and holds the third task in reserve. The ceiling is
  // right; the clip count was not.
  assert.equal(
    proposalSummaryLine({ candidateCount: 2, repairCount: 1, maximumCredits: 108 }),
    '2 clips + 1 repair reserve · up to 108 credits',
  );
  assert.equal(
    proposalSummaryLine({ candidateCount: 1, repairCount: 0, maximumCredits: 36 }),
    '1 clip · up to 36 credits',
  );
});

test('the summary line is derived from the live compiled proposal, not hand-written', () => {
  const professional = parseGenerationPreviewResponse(preview('professional'), expected('professional'));
  assert.ok(professional);
  assert.equal(proposalSummaryLine(professional), '2 clips + 1 repair reserve · up to 108 credits');
  const fast = parseGenerationPreviewResponse(preview('fast'), expected('fast'));
  assert.ok(fast);
  assert.equal(proposalSummaryLine(fast), '1 clip · up to 36 credits');
});
