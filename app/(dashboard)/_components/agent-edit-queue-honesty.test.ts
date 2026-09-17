// node --test "app/(dashboard)/_components/agent-edit-queue-honesty.test.ts"

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { confirmedRunRequestId } from '../../../lib/run-request-receipt.ts';

const dir = import.meta.dirname;
const improve = readFileSync(join(dir, 'improve-agent.tsx'), 'utf8');
const editButton = readFileSync(join(dir, 'agent-edit-button.tsx'), 'utf8');
const feedback = readFileSync(join(dir, 'agent-feedback.tsx'), 'utf8');
const runFeedback = readFileSync(join(dir, 'run-feedback.tsx'), 'utf8');
const runActions = readFileSync(join(dir, 'run-actions.tsx'), 'utf8');
const activation = readFileSync(join(dir, 'activation-card.tsx'), 'utf8');
const page = readFileSync(join(dir, '..', 'workflows', '[slug]', 'page.tsx'), 'utf8');
const route = readFileSync(join(dir, '..', '..', 'api', 'agents', 'revise', 'route.ts'), 'utf8');

test('an edit is acknowledged only with the durable inserted request identity', () => {
  assert.equal(confirmedRunRequestId({ ok: true, request: { id: 'revise-request' } }), 'revise-request');
  for (const unconfirmed of [null, { ok: true }, { ok: true, request: null }, { ok: true, request: { id: '' } }]) {
    assert.equal(confirmedRunRequestId(unconfirmed), null);
  }
  assert.match(route, /const requestId = confirmedRunRequestId\(data\)/);
  assert.match(route, /if \(!res\.ok \|\| !requestId\)/);
  assert.match(improve, /const requestId = confirmedAgentRevisionRequestId\(res\.ok, data\)/);
  assert.ok(improve.indexOf('if (!requestId)') < improve.indexOf("setState('queued')"));
  for (const [name, source] of [['run feedback', runFeedback], ['run actions', runActions]] as const) {
    assert.match(source, /confirmedAgentRevisionRequestId\(response\.ok, body\)/, `${name} must require HTTP success and the durable receipt`);
  }
  assert.ok(runFeedback.indexOf('confirmedAgentRevisionRequestId(response.ok, body)') < runFeedback.indexOf('setDone(true)'));
  assert.match(runFeedback, /permanent edit was not confirmed/);
  const continuation = runActions.slice(runActions.indexOf('async function continueWithChanges()'), runActions.indexOf('async function reconnectAndContinue()'));
  assert.ok(continuation.indexOf('confirmedAgentRevisionRequestId(response.ok, body)') < continuation.indexOf("router.push('/workflows')"));
  assert.match(continuation, /continuation was queued, but the permanent agent edit was not confirmed/);
});

test('queued copy distinguishes the saved edit request from a not-yet-created version', () => {
  assert.match(improve, /Edit request queued/);
  assert.match(improve, /A new agent version does not exist yet/);
  assert.match(improve, /Request \{queuedRequestId\.slice\(0, 8\)\}/);
  assert.match(feedback, /Edit request queued\. The current version stays active until your engine saves a new version/);
  assert.doesNotMatch(feedback, /it applies to every future run/);
});

test('an unreadable lifecycle blocks both Run and a duplicate Edit', () => {
  assert.match(page, /const lifecycleUnavailable = detail!\.isUnavailable\('lifecycle'\)/);
  assert.match(page, /const actionsBlocked = activationUnavailable \|\| connectionsUnavailable \|\| lifecycleUnavailable/);
  assert.match(page, /<AgentEditButton slug=\{workflow\.slug\} statusUnavailable=\{lifecycleUnavailable\} revisePending=\{revisePending\} \/>/);
  assert.match(page, /a queued edit may still exist/);
  assert.match(editButton, /disabled=\{statusUnavailable \|\| revisePending\}/);
  assert.match(editButton, /<ImproveAgent slug=\{slug\} bare statusUnavailable=\{statusUnavailable\} revisePending=\{revisePending\} \/>/,
    'an already-open modal must receive a later unavailable state');
  assert.match(improve, /canSubmitAgentRevision\(\{ statusUnavailable, revisionPending: revisePending, busy: state === 'sending', note: text \}\)/);
  assert.match(feedback, /canSubmitAgentRevision\(\{ statusUnavailable, revisionPending: revisePending, busy: sending, note: t \}\)/);
  assert.match(feedback, /disabled=\{!canSubmitAgentRevision\(\{ statusUnavailable, revisionPending: revisePending, busy: sending, note: text \}\)\}/);
  assert.match(feedback, /confirmedRunRequestId\(receipt\)/, 'the direct permanent-edit surface also needs a receipt');
  assert.match(page, /<AgentFeedback slug=\{workflow\.slug\} name=\{workflow\.name\} statusUnavailable=\{lifecycleUnavailable\} revisePending=\{revisePending\} \/>/);
  assert.match(activation, /<AgentFeedback slug=\{checklist\.slug\} name=\{checklist\.name\} statusUnavailable=\{statusUnavailable\} revisePending=\{revisePending\} \/>/);
});

test('known pending edits block duplicate permanent edits at the submit boundary', () => {
  assert.match(editButton, /disabled=\{statusUnavailable \|\| revisePending\}/);
  assert.match(feedback, /disabled=\{statusUnavailable \|\| revisePending\}/);
  assert.match(feedback, /An edit is already queued/);
  assert.match(improve, /An edit is already queued/);
});

test('ActivationCard forwards its action block to its nested Run surface', () => {
  assert.match(activation, /<AgentActions[\s\S]*?revisePending=\{revisePending\}[\s\S]*?statusUnavailable=\{statusUnavailable\}[\s\S]*?\/>/);
  assert.match(page, /<ActivationCard checklist=\{checklist\}[\s\S]*?statusUnavailable=\{actionsBlocked\} revisePending=\{revisePending\} \/>/);
});
