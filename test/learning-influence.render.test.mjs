import './support/tsx-register.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';

const { default: AgentLearningsCard } = await import('@/app/(dashboard)/_components/agent-learnings-card.tsx');
const fixture = JSON.parse(readFileSync(new URL('../test-fixtures/learning-influence-v1.json',import.meta.url),'utf8'));
const task = fixture.scope.taskSignatureDigest;
const scope = { kind: 'private_agent', agentSlug: fixture.scope.agentSlug, agentFamilyId: fixture.scope.agentFamilyId,
  originatingAgentVersionId: fixture.scope.workflowVersionId, taskSignatureDigest: task, stepIndex: 4, capabilityIdentity: 'final-assembly' };
const payload = { ok: true, source: 'ready', suggested: fixture.suggested.map((item) => ({...item,scope})),
  active: fixture.active.map((item) => ({...item,scope})) };

test('rendered ready surface explains evidence, scope, lifecycle, and active receipt', () => {
  const html = renderToStaticMarkup(React.createElement(AgentLearningsCard,
    { slug: fixture.scope.agentSlug, initialPayload: payload, initialSource: 'ready' }));
  for (const phrase of ['Train → Learnings','Suggested','Active','Evidence </dt><dd',
    'Contradictions </dt><dd','Private agent','Approve','Dismiss','Disable','Undo','last applied']) {
    assert.match(html, new RegExp(phrase));
  }
  assert.match(html, /Ready for your approval/);
  assert.match(html, new RegExp(task.slice(0, 12)));
});

test('rendered unavailable source is explicit and cannot masquerade as empty', () => {
  const html = renderToStaticMarkup(React.createElement(AgentLearningsCard,
    { slug: 'render-agent', initialSource: 'unavailable' }));
  assert.match(html, /could not be verified/);
  assert.match(html, /Nothing is shown as empty/);
  assert.match(html, /disabled=""/);
  assert.doesNotMatch(html, />Approve</);
  assert.doesNotMatch(html, /No suggestions awaiting review/);
});
