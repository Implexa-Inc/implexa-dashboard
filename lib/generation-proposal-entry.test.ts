// node --test lib/generation-proposal-entry.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseGenerationCreateResponse, parseGenerationPreviewResponse,
  parseGenerationPreviewSet, proposalEntryError, validateGenerationMoment,
} from './generation-proposal-entry.ts';
import { FAST_COMPILED, PROFESSIONAL_COMPILED, PRODUCTION_COMPILED } from './generation-proposal.fixtures.ts';

const RUN_ID = '52f93684-6cd5-49b1-b183-671e9fcfb4a5';
const PROPOSAL_ID = '4c1d16a8-9f7e-4b7a-8a55-2e9d0f6b3c21';
const USER_ID = 'b15ce0cc-3e6a-4d7d-84bf-1f514f845ffc';
const ORG_ID = 'a526071d-2350-433b-ae75-4447b3368af6';
const MOMENT = {
  id: 'hook', prompt: 'Founder opens laptop in dim room, screen glow on face',
  startSeconds: 0, endSeconds: 5,
};

function compiledFor(mode: 'fast' | 'professional' | 'production'): Record<string, unknown> {
  const source = mode === 'fast' ? FAST_COMPILED : mode === 'professional' ? PROFESSIONAL_COMPILED : PRODUCTION_COMPILED;
  const c = structuredClone(source) as unknown as Record<string, unknown>;
  const count = mode === 'fast' ? 1 : mode === 'professional' ? 2 : 0;
  const tasks = (c.tasks as Array<Record<string, unknown>>).slice(0, count);
  c.tasks = tasks;
  c.task_count = count;
  c.per_task_credits = tasks.map((t) => ({ task_id: t.task_id, credits: t.credits }));
  c.maximum_credits = tasks.reduce((n, t) => n + Number(t.credits), 0);
  c.proposal_digest = 'a'.repeat(64);
  return c;
}

function expected(mode: 'fast' | 'professional' | 'production') {
  return { agentSubject: 'cinematic-b-roll-generator', sourceRunId: RUN_ID, qualityMode: mode, moment: MOMENT } as const;
}

function preview(mode: 'fast' | 'professional' | 'production') {
  const proposal = compiledFor(mode);
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

function created(mode: 'fast' | 'professional' | 'production') {
  const body = preview(mode) as Record<string, any>;
  body.proposal_id = PROPOSAL_ID;
  body.state = mode === 'fast' ? 'awaiting_approval' : 'unavailable';
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
  assert.equal(parseGenerationPreviewResponse(preview('professional'), expected('professional'))?.tasks.length, 2);
  assert.equal(parseGenerationPreviewResponse(preview('production'), expected('production'))?.tasks.length, 0);
});

test('mode comparison refuses a partial preview set', () => {
  const set = { fast: preview('fast'), professional: preview('professional'), production: preview('production') };
  assert.equal(parseGenerationPreviewSet(set, {
    agentSubject: 'cinematic-b-roll-generator', sourceRunId: RUN_ID, moment: MOMENT,
  })?.professional.availability, false);
  (set.professional as any).identity.source_run_id = USER_ID;
  assert.equal(parseGenerationPreviewSet(set, {
    agentSubject: 'cinematic-b-roll-generator', sourceRunId: RUN_ID, moment: MOMENT,
  }), null);
});

test('preview is bound to this run, agent, mode, prompt, and timestamp', () => {
  for (const mutate of [
    (b: any) => { b.identity.source_run_id = USER_ID; },
    (b: any) => { b.identity.agent_subject = 'another-agent'; },
    (b: any) => { b.proposal.quality_mode = 'professional'; },
    (b: any) => { b.proposal.tasks[0].prompt_text = 'Different work'; },
    (b: any) => { b.proposal.tasks[0].timestamp.end_seconds = 6; },
    (b: any) => { b.availability = false; },
    (b: any) => { b.proposal_id = PROPOSAL_ID; },
  ]) {
    const body = preview('fast'); mutate(body);
    assert.equal(parseGenerationPreviewResponse(body, expected('fast')), null);
  }
});

test('create accepts only the persisted identity and availability-derived state', () => {
  assert.deepEqual(parseGenerationCreateResponse(created('fast'), expected('fast'))?.proposalId, PROPOSAL_ID);
  assert.equal(parseGenerationCreateResponse(created('professional'), expected('professional'))?.state, 'unavailable');
  assert.equal(parseGenerationCreateResponse(created('production'), expected('production'))?.state, 'unavailable');

  for (const mutate of [
    (b: any) => { b.identity.proposal_id = USER_ID; },
    (b: any) => { b.identity.proposal_digest = 'b'.repeat(64); },
    (b: any) => { b.identity.authorization_id = USER_ID; },
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
});
