// node --test "app/(dashboard)/_components/setup-required-wiring.test.ts"
//
// Source-guard pins for machine-capability admission (backend 0346): the
// Dashboard NEVER infers local CLI availability and NEVER sends a readiness
// claim; it names a machine, asks the backend, and renders the typed answer.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = import.meta.dirname;
const actions = readFileSync(join(dir, 'agent-actions.tsx'), 'utf8');
const card = readFileSync(join(dir, 'setup-required-card.tsx'), 'utf8');
const continueBox = readFileSync(join(dir, 'run-continue-box.tsx'), 'utf8');
const setupPage = readFileSync(join(dir, '..', 'settings', 'machine-setup', '[slug]', 'machine-setup-client.tsx'), 'utf8');
const lib = readFileSync(join(dir, '..', '..', '..', 'lib', 'setup-required.ts'), 'utf8');

test('admission is asked BEFORE the run request is created, and the request carries only the machine NAME', () => {
  const fn = actions.slice(actions.indexOf('async function doQueue('), actions.indexOf('async function doWatch('))
    .split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
  const admission = fn.indexOf("callBackend('/api/v2/me/run-admission'");
  const request = fn.indexOf("callBackend('/api/v2/me/run-requests'");
  assert.ok(admission > 0 && request > admission, 'admission precedes creation');
  assert.match(fn, /executionMachineId = await desktopBridge\(\)\?\.executionMachineId\?\.\(\)\.catch\(\(\) => null\) \?\? null/);
  assert.match(fn, /\.\.\.\(executionMachineId \? \{ executionMachineId \} : \{\}\),\n\s+\},\n\s+\}\);/);
  const body = fn.slice(request, fn.indexOf('});', request));
  for (const forbidden of ['readiness', 'cliInstalled', 'higgsfield', 'items:', 'attestation']) {
    assert.doesNotMatch(body, new RegExp(forbidden, 'i'), `the request body must never carry a browser readiness claim (${forbidden})`);
  }
});

test('the typed 409 becomes the modal, not an error sentence; Recheck continues the same doQueue with the remembered note + fingerprint, once', () => {
  assert.match(actions, /const setup = parseSetupRequired\(e\);\n\s+if \(setup\) \{\n\s+setState\('idle'\);\n\s+setMsg\(''\);\n\s+setSetupCard\(setup\);\n\s+return;/);
  assert.match(actions, /onAdmitted=\{async \(\) => \{ setSetupCard\(null\); await doQueue\(lastNote\.current, \{ fingerprint: lastFingerprint\.current, admitted: true \}\); \}\}/);
  assert.match(actions, /title="Setup required before this agent can run\."/);
  assert.match(card, /const admittedRef = useRef\(false\);/);
  assert.match(card, /if \(checking \|\| admittedRef\.current\) return;/, 'a double Recheck cannot continue the run twice');
  assert.match(card, /if \(res\?\.ok === true && res\?\.admitted === true\) \{\n\s+admittedRef\.current = true;\n\s+await onAdmitted\(\);/);
});

test('the modal offers exactly Open setup in Implexa / Recheck / Cancel, shows the computer, and promises no silent install or credential capture', () => {
  assert.match(card, />Open setup in Implexa</);
  assert.match(card, /\{checking \? 'Rechecking…' : 'Recheck'\}/);
  assert.match(card, /onClick=\{onCancel\}>Cancel</);
  assert.match(card, /data-testid="setup-required-machine"/);
  assert.match(card, /Implexa never installs software or captures credentials on its own/);
  assert.doesNotMatch(card, /installTool|npm install|brew install/, 'the modal never installs; the setup page does, on an explicit click');
});

test('the browser never decides readiness: recheck asks the Desktop to re-probe, then the BACKEND for the decision', () => {
  const recheck = card.slice(card.indexOf('async function recheck()'), card.indexOf('function openSetup()'));
  assert.match(recheck, /native\.recheckMachineCapabilities\(\)/);
  assert.match(recheck, /callBackend\('\/api\/v2\/me\/run-admission'/);
  assert.doesNotMatch(recheck, /machineCapabilityState|items\[|status === 'ready'/, 'bridge statuses are never turned into an admission');
  assert.match(setupPage, /callBackend\(`\/api\/v2\/me\/machine-capabilities\?slug=/);
  assert.doesNotMatch(setupPage, /machineCapabilityState/, 'the setup page renders the backend’s read model, not the bridge’s');
});

test('the setup page’s install/sign-in are explicit clicks through the Desktop tool registry; the vendor CLI is opened, never scripted', () => {
  assert.match(setupPage, /native\.installTool\(key\)/);
  assert.match(setupPage, /higgsfield_cli: 'higgsfield'/);
  assert.match(setupPage, /Sign in with the vendor’s CLI in a terminal \(Implexa never captures the credential\)/);
  assert.match(setupPage, /if \(r\.installUrl\) \{ window\.open\(r\.installUrl, '_blank', 'noopener,noreferrer'\)/);
});

test('a Continue gets the same typed refusal and modal', () => {
  assert.match(continueBox, /const setup = parseSetupRequired\(e\);\n\s+if \(setup\) \{ setSetupCard\(setup\); return; \}/);
  assert.match(continueBox, /<SetupRequiredCard\n\s+card=\{setupCard\}\n\s+onAdmitted=\{async \(\) => \{ setSetupCard\(null\); await submit\(\); \}\}/);
});

test('parseSetupRequired admits only a 409 with the exact discriminator', () => {
  assert.match(lib, /if \(e\.status !== 409\) return null;/);
  assert.match(lib, /if \(c\.code !== 'setup_required' \|\| !Array\.isArray\(c\.items\)\) return null;/);
});
