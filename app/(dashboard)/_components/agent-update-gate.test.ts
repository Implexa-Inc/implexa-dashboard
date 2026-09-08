import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { render } from '../../../lib/test/render.ts';

const source = readFileSync(new URL('./agent-update-gate.tsx', import.meta.url), 'utf8');
const actions = readFileSync(new URL('./agent-actions.tsx', import.meta.url), 'utf8');
const page = readFileSync(new URL('../workflows/[slug]/page.tsx', import.meta.url), 'utf8');

const VERSION_ID = '33333333-3333-4333-8333-333333333333';

function update(overrides: Record<string, unknown> = {}) {
  return {
    workflow_version_id: VERSION_ID,
    version: 8,
    state: 'reactivation_required',
    input_contract_digest: 'c'.repeat(64),
    input_contract: {
      version: 1,
      fields: [{
        key: 'presenter_source_media', label: 'Presenter video',
        description: 'The presenter take for this run.',
        kind: 'file', cardinality: 'one', required: true, order: 1,
        accept: { extensions: ['.mp4'], mediaTypes: ['video/mp4'] },
      }],
    },
    ...overrides,
  };
}

test('an available immutable update is an explicit activation gate, not a silent Run version swap', () => {
  assert.match(page, /workflow\.update_available/);
  assert.match(page, /<AgentUpdateGate/);
  assert.doesNotMatch(page, /false && workflow\.update_available/);
  assert.match(source, /Review & activate update/);
  assert.match(source, /Run now stays on your installed version/);
});

test('activation uses the owner-scoped service route and requires its exact confirmed version', () => {
  assert.match(source, /installed-agents\/\$\{encodeURIComponent\(workflowId\)\}\/activate-version/);
  assert.match(source, /workflowVersionId: update\.workflow_version_id/);
  assert.match(source, /inputContractDigest: update\.input_contract_digest/);
  assert.match(source, /result\.activeVersionId !== update\.workflow_version_id/);
});

test('ACTIVATION SENDS NO RUN INPUTS — not bindings, not an input session', () => {
  // §4.1. The REQUEST BODY is the enforcement point on this side: whatever the
  // component renders, an activation that carries no bindings cannot make one
  // file the standing input of every schedule. Scoped to the body so the comment
  // above it may keep naming the fields it is there to explain the absence of.
  const body = source.slice(source.indexOf('body: {'), source.indexOf('},\n      });'));
  assert.ok(body.length > 0, 'the activation request body must be findable');
  assert.doesNotMatch(body, /inputBindings/);
  assert.doesNotMatch(body, /inputSessionId/);
  assert.match(body, /workflowVersionId/);
  assert.match(body, /permissionsConfirmed/);
  // And the serializer is not imported at all — there is nothing to serialize.
  assert.doesNotMatch(source, /serializeArtifactBindings/);
  assert.doesNotMatch(source, /desktopBridge/);
});

test('ACTIVATION RENDERS NO FILE PICKER AND HASHES NOTHING', async () => {
  // §7.3 — a required presenter video in the contract, and still zero controls
  // that could select one. The bridge is provided precisely so that calling it
  // would be observable.
  const picks: unknown[] = [];
  const rendered = await render('agent-update-gate.tsx', { workflowId: 'workflow-1', update: update() }, {
    bridge: {
      pickRunInput: async (options: unknown) => { picks.push(options); return { ok: false, canceled: true }; },
    },
  });
  try {
    await rendered.click(rendered.getByText('Review & activate update'));
    for (const label of ['Choose file', 'Add file', 'Replace file', 'Choose folder', 'Add folder', 'Replace with folder']) {
      assert.equal(rendered.queryByText(label), null, `activation must not render "${label}"`);
    }
    assert.equal(picks.length, 0, 'no Desktop picker call is made during activation');
  } finally { rendered.cleanup(); }
});

test('the input contract is EXPLAINED, not collected', async () => {
  // §3.3 — "the activation surface may explain the new contract ... but must not
  // render a file picker".
  const rendered = await render('agent-update-gate.tsx', { workflowId: 'workflow-1', update: update() }, {});
  try {
    await rendered.click(rendered.getByText('Review & activate update'));
    const text = rendered.text();
    assert.match(text, /What each run will ask you for/);
    assert.match(text, /Presenter video/);
    assert.match(text, /required each run/);
    assert.match(text, /Run now collects and verifies these for that run only/);
  } finally { rendered.cleanup(); }
});

test('a required input never disables activation', async () => {
  // The §2.1 defect exactly: the button used to be disabled until every required
  // input was bound, which is how activation came to demand a presenter video.
  assert.doesNotMatch(source, /missingRequiredInputs/);
  const rendered = await render('agent-update-gate.tsx', {
    workflowId: 'workflow-1', update: update({ state: 'configuration_required' }),
  }, {});
  try {
    await rendered.click(rendered.getByText('Review & activate update'));
    const button = rendered.getByText('Activate update') as unknown as { disabled: boolean };
    assert.equal(button.disabled, false, 'a version with an unbound required input still activates');
  } finally { rendered.cleanup(); }
});

test('an authority-expanding update shows the EXACT delta and gates on approval', async () => {
  // §7.2 — the diff must name what the agent gains, and approval must be required.
  const rendered = await render('agent-update-gate.tsx', {
    workflowId: 'workflow-1',
    update: update({
      authority_delta: {
        added: {
          permission_groups: ['shell'],
          capabilities: ['browser'],
          destructive: ['send'],
          spend: { 'runway:USD': { from: 0, to: 5000 } },
        },
        removed: { permission_groups: ['web'] },
      },
    }),
  }, {});
  try {
    await rendered.click(rendered.getByText('Review & activate update'));
    const text = rendered.text();
    assert.match(text, /This version changes what the agent is allowed to do/);
    assert.match(text, /run commands on your computer/);
    assert.match(text, /control a browser/);
    assert.match(text, /send messages on your behalf/);
    assert.match(text, /spend up to \$50\.00 per run on runway/);
    assert.match(text, /Gives up/);
    assert.match(text, /read web pages/);

    const button = rendered.getByText('Activate update') as unknown as { disabled: boolean };
    assert.equal(button.disabled, true, 'approval is required before a permission change activates');
  } finally { rendered.cleanup(); }
});

test('an update that changes no authority shows no authority panel', async () => {
  const rendered = await render('agent-update-gate.tsx', {
    workflowId: 'workflow-1', update: update({ state: 'configuration_required', authority_delta: null }),
  }, {});
  try {
    await rendered.click(rendered.getByText('Review & activate update'));
    assert.doesNotMatch(rendered.text(), /changes what the agent is allowed to do/);
  } finally { rendered.cleanup(); }
});

test('an incompatible update is blocked with a migration explanation, not an input prompt', async () => {
  // §3.4 — "Do not disguise incompatibility as a file-input prompt."
  const rendered = await render('agent-update-gate.tsx', {
    workflowId: 'workflow-1', update: update({ state: 'incompatible' }),
  }, {});
  try {
    const text = rendered.text();
    assert.match(text, /needs a migration, not an activation/);
    const button = rendered.getByText('Update is incompatible') as unknown as { disabled: boolean };
    assert.equal(button.disabled, true);
  } finally { rendered.cleanup(); }
});

test('the deployed stale-version protection is retained', () => {
  // §6 — "Retain the deployed behavior that warns about a waiting update and
  // prevents an unnoticed stale-version run."
  assert.match(actions, /Agent update v\{pendingUpdate\.version\} is waiting for activation/);
  assert.match(actions, /Run the installed version instead of update v\{pendingUpdate\.version\}/);
  assert.match(actions, /allowSupersededInstalledVersion: true/);
  // The submit path refuses until the owner explicitly chooses the old version.
  assert.match(actions, /if \(\(pendingUpdate && !runInstalledVersionConfirmed\)/);
  // And the watch-in-a-session bypass stays closed while an update waits.
  assert.match(actions, /!revisePending && !pendingUpdate/);
});

test('the active version is stated persistently, not inferred from a vanished card', () => {
  // §3.1 — with compatible edits landing on their own, the disappearance of an
  // update card is the ONLY other signal, and it looks identical to an edit that
  // never registered.
  assert.match(page, /Active version: v\{workflow\.version\}/);
  assert.match(page, /activeVersionNumber=\{workflow\.version\}/);
  assert.match(actions, /This run will use v\{activeVersionNumber\}/);
});

test('Run now cannot render Queued from an unconfirmed or rejected response', () => {
  const receipt = actions.indexOf('confirmedRunRequestId(res)');
  const queued = actions.indexOf("setState('queued')", receipt);
  assert.ok(receipt >= 0 && queued > receipt);
  assert.match(actions.slice(receipt, queued), /if \(!confirmedRequestId\)[\s\S]*throw new Error/);
});
