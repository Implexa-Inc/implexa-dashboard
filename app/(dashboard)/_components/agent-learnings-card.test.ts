import test from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../../../lib/test/render.ts';

const ready = { ok: true, source: 'ready',
  selectedVersion: { id: 'agent-version-13', version: 13, taskSignatureDigest: 'b'.repeat(64) },
  suggested: [], active: [] };
const oneRunSuggestion = {
  id: 'candidate-1', candidateKey: 'a'.repeat(64), ruleClass: 'preference', polarity: 'positive',
  summary: 'Time text and animations to the spoken narration.',
  instruction: 'Align text and animation timing precisely with the spoken narration.',
  scope: { kind: 'private_agent', agentSlug: 'video-agent', agentFamilyId: 'family-1',
    taskSignatureDigest: 'b'.repeat(64), stepIndex: null, capabilityIdentity: null, toolIdentity: null },
  evidenceCount: 1, recurrenceCount: 1, taskCoverage: 1, contradictionCount: 0,
  eligible: false, eligibilityReason: 'insufficient_recurrence',
};

test('historical feedback analysis posts to the agent-bound backfill and refreshes suggestions', async () => {
  const responses: Array<{ path: string; method?: string }> = [];
  const rendered = await render('agent-learnings-card.tsx', {
    slug: 'video-agent', initialPayload: ready, initialSource: 'ready',
  }, {
    backend(path, init) {
      const method = (init as { method?: string })?.method;
      responses.push({ path, method });
      if (path.endsWith('/backfill')) return {
        ok: true, source: 'ready', scannedEvidence: 103, agentEvidence: 87,
        matchedEvidence: 42, proposals: 58, createdCandidates: 6,
        attachedEvidence: 42, replaySafe: true,
      };
      return ready;
    },
  });
  try {
    await rendered.click(rendered.getByText('Analyze past feedback'));
    assert.ok(responses.some(({ path, method }) =>
      path === '/api/v2/agents/video-agent/learning-influence/backfill' && method === 'POST'));
    assert.match(rendered.text(), /42 of 87 implemented feedback items matched reviewed patterns/);
    assert.match(rendered.text(), /6 new suggestions and 42 new evidence links were added without duplicates/);
  } finally { rendered.cleanup(); }
});

test('an unverifiable backfill result fails closed and never reports analysis success', async () => {
  const rendered = await render('agent-learnings-card.tsx', {
    slug: 'video-agent', initialPayload: ready, initialSource: 'ready',
  }, {
    backend(path) {
      if (path.endsWith('/backfill')) return {
        ok: true, source: 'ready', scannedEvidence: 103, agentEvidence: 87,
        matchedEvidence: 42, proposals: 58, createdCandidates: -1,
        attachedEvidence: 42, replaySafe: true,
      };
      return ready;
    },
  });
  try {
    await rendered.click(rendered.getByText('Analyze past feedback'));
    assert.match(rendered.text(), /Historical feedback analysis returned an unverifiable result/);
    assert.doesNotMatch(rendered.text(), /implemented feedback items matched reviewed patterns/);
  } finally { rendered.cleanup(); }
});

test('an edited one-run suggestion atomically approves the replacement text', async () => {
  const calls: Array<{ path: string; body?: unknown }> = [];
  const payload = { ...ready, suggested: [oneRunSuggestion] };
  const rendered = await render('agent-learnings-card.tsx', {
    slug: 'video-agent', initialPayload: payload, initialSource: 'ready',
  }, {
    backend(path, init) {
      calls.push({ path, body: (init as { body?: unknown })?.body });
      return path.endsWith('/refine-and-approve')
        ? { ok: true, approved: true, candidateId: 'candidate-2', ruleId: 'rule-1', version: 1 }
        : payload;
    },
  });
  try {
    assert.match(rendered.text(), /Only 1 independent run supports this suggestion/);
    await rendered.click(rendered.getByText('Edit rule'));
    assert.match(rendered.text(), /does not manufacture another supporting run/);
    const buttonLabels = Array.from(rendered.document.querySelectorAll('button')).map((button) => button.textContent?.trim());
    assert.equal(buttonLabels.includes('Approve anyway'), false, 'the original candidate must not remain separately approvable while editing');
    const textarea = rendered.document.querySelector('textarea') as HTMLTextAreaElement;
    const refined = 'Align text and animation timing precisely with the spoken narration. Make sure animations start slightly after the narration, never before it.';
    await rendered.act(() => {
      const setter = Object.getOwnPropertyDescriptor(rendered.window.HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(textarea, refined);
      textarea.dispatchEvent(new rendered.window.Event('input', { bubbles: true }));
    });
    await rendered.click(rendered.getByText('Save & approve'));
    const call = calls.find(({ path }) => path.endsWith('/candidates/candidate-1/refine-and-approve'));
    assert.ok(call);
    assert.equal(JSON.stringify(call.body), JSON.stringify({
      candidateKey: 'a'.repeat(64), instruction: refined, allowLowEvidence: true,
    }));
    assert.equal(calls.some(({ path }) => path.endsWith('/candidates/candidate-1/approve')), false,
      'editing must never activate the stale original candidate through a separate approval request');
  } finally { rendered.cleanup(); }
});

test('editing an active rule appends a new immutable version', async () => {
  const calls: Array<{ path: string; body?: unknown }> = [];
  const activeRule = {
    id: 'version-1', ruleId: 'rule-1', version: 1, versionDigest: 'd'.repeat(64),
    ruleClass: 'preference', instruction: oneRunSuggestion.instruction,
    scope: oneRunSuggestion.scope, evidenceIds: ['evidence-1'], lastAppliedRun: null,
    contradictionCount: 0, influenceState: 'active',
    eligibleForVersion: true, eligibilityReason: 'same_task_key_and_task_contract',
    compatibilityReceiptId: 'compatibility-1', targetWorkflowVersionId: 'agent-version-13',
  };
  const payload = { ...ready, active: [activeRule] };
  const rendered = await render('agent-learnings-card.tsx', {
    slug: 'video-agent', initialPayload: payload, initialSource: 'ready',
  }, {
    backend(path, init) {
      calls.push({ path, body: (init as { body?: unknown })?.body });
      return path.endsWith('/rules/rule-1/refine')
        ? { ok: true, ruleId: 'rule-1', version: 2, instruction: 'replacement' }
        : payload;
    },
  });
  try {
    await rendered.click(rendered.getByText('Edit active rule'));
    assert.match(rendered.text(), /Saving appends v2/);
    assert.match(rendered.text(), /current version.*remain unchanged and auditable/);
    const textarea = rendered.document.querySelector('textarea') as HTMLTextAreaElement;
    const refined = 'Align text and animation timing precisely with the spoken narration. Make sure animations start slightly after the narration, never before it.';
    await rendered.act(() => {
      const setter = Object.getOwnPropertyDescriptor(rendered.window.HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(textarea, refined);
      textarea.dispatchEvent(new rendered.window.Event('input', { bubbles: true }));
    });
    await rendered.click(rendered.getByText('Save new version'));
    const call = calls.find(({ path }) => path.endsWith('/rules/rule-1/refine'));
    assert.ok(call);
    assert.equal(JSON.stringify(call.body), JSON.stringify({ versionDigest: 'd'.repeat(64), instruction: refined }));
  } finally { rendered.cleanup(); }
});

test('an active rule that is ineligible for the selected version is never presented as influencing its runs', async () => {
  const activeRule = {
    id: 'version-legacy', ruleId: 'rule-legacy', version: 1, versionDigest: 'd'.repeat(64),
    ruleClass: 'preference', instruction: oneRunSuggestion.instruction,
    scope: oneRunSuggestion.scope, evidenceIds: ['evidence-1'], lastAppliedRun: null,
    contradictionCount: 0, influenceState: 'active', eligibleForVersion: false,
    eligibilityReason: 'task_identity_or_contract_changed', compatibilityReceiptId: null,
    targetWorkflowVersionId: 'agent-version-13',
  };
  const payload = { ...ready, active: [activeRule] };
  const rendered = await render('agent-learnings-card.tsx', {
    slug: 'video-agent', initialPayload: payload, initialSource: 'ready',
  }, { backend() { return payload; } });
  try {
    assert.match(rendered.text(), /Active · Not eligible for agent v13/i);
    assert.match(rendered.text(), /will not be frozen or supplied to runs of v13/i);
    assert.doesNotMatch(rendered.text(), /Active · Eligible for agent v13/i);
  } finally { rendered.cleanup(); }
});

test('low-evidence override never unlocks contradicted or scoped suggestions', async () => {
  const blocked = [
    { ...oneRunSuggestion, id: 'contradicted', contradictionCount: 1 },
    { ...oneRunSuggestion, id: 'scoped', scope: { ...oneRunSuggestion.scope, toolIdentity: 'higgsfield.seedance' } },
  ];
  for (const item of blocked) {
    const payload = { ...ready, suggested: [item] };
    const rendered = await render('agent-learnings-card.tsx', {
      slug: 'video-agent', initialPayload: payload, initialSource: 'ready',
    }, {
      backend() { return payload; },
    });
    try {
      const approve = Array.from(rendered.document.querySelectorAll('button'))
        .find((button) => button.textContent?.trim() === 'Approve') as HTMLButtonElement;
      assert.ok(approve);
      assert.equal(approve.disabled, true);
      assert.doesNotMatch(rendered.text(), /Approve anyway/);
    } finally { rendered.cleanup(); }
  }
});
