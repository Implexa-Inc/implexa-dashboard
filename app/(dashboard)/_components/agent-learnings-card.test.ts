import test from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../../../lib/test/render.ts';

const ready = { ok: true, source: 'ready', suggested: [], active: [] };
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

test('a one-run suggestion offers an explicit low-evidence override and saves an auditable refinement', async () => {
  const calls: Array<{ path: string; body?: unknown }> = [];
  const payload = { ...ready, suggested: [oneRunSuggestion] };
  const rendered = await render('agent-learnings-card.tsx', {
    slug: 'video-agent', initialPayload: payload, initialSource: 'ready',
  }, {
    backend(path, init) {
      calls.push({ path, body: (init as { body?: unknown })?.body });
      return path.endsWith('/refine') ? { ok: true, candidateId: 'candidate-2' } : payload;
    },
  });
  try {
    assert.match(rendered.text(), /Only 1 independent run supports this suggestion/);
    const approve = rendered.getByText('Approve anyway') as HTMLButtonElement;
    assert.equal(approve.disabled, false);
    await rendered.click(approve);
    const approvalCall = calls.find(({ path }) => path.endsWith('/candidates/candidate-1/approve'));
    assert.ok(approvalCall);
    assert.equal(JSON.stringify(approvalCall.body), JSON.stringify({
      candidateKey: 'a'.repeat(64), allowLowEvidence: true,
    }));
    await rendered.click(rendered.getByText('Edit rule'));
    assert.match(rendered.text(), /does not manufacture another supporting run/);
    const textarea = rendered.document.querySelector('textarea') as HTMLTextAreaElement;
    const refined = 'Align text and animation timing precisely with the spoken narration. Make sure animations start slightly after the narration, never before it.';
    await rendered.act(() => {
      const setter = Object.getOwnPropertyDescriptor(rendered.window.HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(textarea, refined);
      textarea.dispatchEvent(new rendered.window.Event('input', { bubbles: true }));
    });
    await rendered.click(rendered.getByText('Save refinement'));
    const call = calls.find(({ path }) => path.endsWith('/candidates/candidate-1/refine'));
    assert.ok(call);
    assert.equal(JSON.stringify(call.body), JSON.stringify({ candidateKey: 'a'.repeat(64), instruction: refined }));
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
      const approve = rendered.getByText('Approve') as HTMLButtonElement;
      assert.equal(approve.disabled, true);
      assert.doesNotMatch(rendered.text(), /Approve anyway/);
    } finally { rendered.cleanup(); }
  }
});
