import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./agent-update-gate.tsx', import.meta.url), 'utf8');
const actions = readFileSync(new URL('./agent-actions.tsx', import.meta.url), 'utf8');
const page = readFileSync(new URL('../workflows/[slug]/page.tsx', import.meta.url), 'utf8');

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
  assert.match(source, /serializeArtifactBindings\(bindings\)/);
  assert.match(source, /result\.activeVersionId !== update\.workflow_version_id/);
});

test('Run now cannot render Queued from an unconfirmed or rejected response', () => {
  const receipt = actions.indexOf('confirmedRunRequestId(res)');
  const queued = actions.indexOf("setState('queued')", receipt);
  assert.ok(receipt >= 0 && queued > receipt);
  assert.match(actions.slice(receipt, queued), /if \(!confirmedRequestId\)[\s\S]*throw new Error/);
});
