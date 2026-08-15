import test from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../../../lib/test/render.ts';

const ready = { ok: true, source: 'ready', suggested: [], active: [] };

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
