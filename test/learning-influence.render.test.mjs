import './support/tsx-register.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const cardModule = process.env.LEARNING_CARD_MODULE
  ? pathToFileURL(process.env.LEARNING_CARD_MODULE).href
  : '@/app/(dashboard)/_components/agent-learnings-card.tsx';
const { default: AgentLearningsCard } = await import(cardModule);
const fixture = JSON.parse(readFileSync(new URL('../test-fixtures/learning-influence-v1.json',import.meta.url),'utf8'));
const task = fixture.scope.taskSignatureDigest;
const baseScope = { kind: 'private_agent', agentSlug: fixture.scope.agentSlug, agentFamilyId: fixture.scope.agentFamilyId,
  originatingAgentVersionId: fixture.scope.workflowVersionId, taskSignatureDigest: task };
const payload = { ok: true, source: 'ready', selectedVersion: {
  id: fixture.scope.workflowVersionId, version: 13, taskSignatureDigest: task,
}, suggested: fixture.suggested.map((item) => ({...item,
  scope: {...baseScope,stepIndex:item.stepIndex,capabilityIdentity:item.capabilityIdentity,toolIdentity:item.toolIdentity}})),
  active: fixture.active.map((item) => ({...item,
    eligibleForVersion:true,eligibilityReason:'same_task_key_and_task_contract',
    compatibilityReceiptId:'00000044-0000-4000-8000-000000000044',targetWorkflowVersionId:fixture.scope.workflowVersionId,
    scope: {...baseScope,stepIndex:item.stepIndex,capabilityIdentity:item.capabilityIdentity,toolIdentity:item.toolIdentity}})),
  history: fixture.history };

test('rendered ready surface explains evidence, scope, lifecycle, and active receipt', () => {
  const html = renderToStaticMarkup(React.createElement(AgentLearningsCard,
    { slug: fixture.scope.agentSlug, initialPayload: payload, initialSource: 'ready' }));
  for (const phrase of ['Train → Learnings','Suggested','Approved competence','Active','Eligible for agent v13','Evidence </dt><dd',
    'Contradictions </dt><dd','Private agent','Approve','Dismiss','Edit rule','Edit active rule','Disable','Undo','last applied',
    'Use feedback you already gave','Analyze past feedback','up to 180 days',
    'remain inert until they meet the evidence threshold and you approve them','last supplied','last applied']) {
    assert.match(html, new RegExp(phrase));
  }
  assert.match(html, /Exact runtime scope is not enforceable; shadow-only/);
  assert.match(html, /Approval is locked because the current runtime cannot enforce this exact scope/);
  assert.match(html, /final-assembly/);
  assert.match(html, /remotion\.render/);
  assert.match(html, /<button[^>]+disabled=""[^>]*>Approve/);
  assert.match(html, /<button[^>]*>Analyze past feedback<\/button>/);
  assert.doesNotMatch(html, /<button[^>]+disabled=""[^>]*>Analyze past feedback<\/button>/);
  assert.match(html, new RegExp(task.slice(0, 12)));
});

test('rendered proof history covers empty, pending, supplied, applied, unsupported, and revoked honestly', () => {
  const html = renderToStaticMarkup(React.createElement(AgentLearningsCard,
    { slug: fixture.scope.agentSlug, initialPayload: payload, initialSource: 'ready' }));
  for (const phrase of ['Rule history', 'supply pending', 'supplied to run', 'applied',
    'unsupported scope', 'outcome pending', 'outcome accepted', 'revoked',
    'does not prove this rule caused the outcome']) assert.match(html, new RegExp(phrase));
  const empty = renderToStaticMarkup(React.createElement(AgentLearningsCard,
    { slug: fixture.scope.agentSlug, initialPayload: { ...payload, history: [] }, initialSource: 'ready' }));
  assert.match(empty, /No frozen learning context has been recorded yet/);
  assert.doesNotMatch(empty, /supplied to run/);
});

test('rendered post-approval contradiction is visibly suspended but reversible', () => {
  const suspended = {...payload,active:payload.active.map((rule) => ({...rule,
    contradictionCount:1,influenceState:'suspended_contradiction'}))};
  const html = renderToStaticMarkup(React.createElement(AgentLearningsCard,
    { slug: fixture.scope.agentSlug, initialPayload: suspended, initialSource: 'ready' }));
  assert.match(html, /Suspended from future runs/);
  assert.match(html, /Already-frozen runs are unchanged/);
  assert.match(html, />Disable</);
  assert.match(html, />Undo</);
});

test('rendered unavailable source is explicit and cannot masquerade as empty', () => {
  const html = renderToStaticMarkup(React.createElement(AgentLearningsCard,
    { slug: 'render-agent', initialSource: 'unavailable' }));
  assert.match(html, /could not be verified/);
  assert.match(html, /Nothing is shown as empty/);
  assert.match(html, /disabled=""/);
  assert.doesNotMatch(html, />Approve</);
  assert.doesNotMatch(html, /No suggestions awaiting review/);
  assert.doesNotMatch(html, /Analyze past feedback/);
});

test('rendered one-run unscoped preference is advisory and author-overridable', () => {
  const item = { ...payload.suggested[0], id: 'one-run', ruleClass: 'preference',
    eligible: false, eligibilityReason: 'insufficient_recurrence', evidenceCount: 1,
    recurrenceCount: 1, contradictionCount: 0,
    scope: { ...baseScope, stepIndex: null, capabilityIdentity: null, toolIdentity: null } };
  const html = renderToStaticMarkup(React.createElement(AgentLearningsCard,
    { slug: fixture.scope.agentSlug, initialPayload: { ...payload, suggested: [item] }, initialSource: 'ready' }));
  assert.match(html, /Only 1 independent run supports this suggestion/);
  assert.match(html, /low-evidence author override/);
  assert.match(html, /<button[^>]*>Approve anyway<\/button>/);
  assert.doesNotMatch(html, /<button[^>]+disabled=""[^>]*>Approve anyway/);
});
