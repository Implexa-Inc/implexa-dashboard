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
const read = (rel: string) => readFileSync(join(dir, rel), 'utf8');
const actions = readFileSync(join(dir, 'agent-actions.tsx'), 'utf8');
const card = readFileSync(join(dir, 'setup-required-card.tsx'), 'utf8');
const continueBox = readFileSync(join(dir, 'run-continue-box.tsx'), 'utf8');
const gate = read('setup-required-gate.tsx');
const setupPage = readFileSync(join(dir, '..', 'settings', 'machine-setup', '[slug]', 'machine-setup-client.tsx'), 'utf8');
const lib = readFileSync(join(dir, '..', '..', '..', 'lib', 'setup-required.ts'), 'utf8');

test('admission is asked BEFORE the run request is created, and the request carries only the machine NAME', () => {
  const fn = actions.slice(actions.indexOf('async function doQueue('), actions.indexOf('async function doWatch('))
    .split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
  const admission = fn.indexOf("callBackend('/api/v2/me/run-admission'");
  const request = fn.indexOf("callBackend('/api/v2/me/run-requests'");
  assert.ok(admission > 0 && request > admission, 'admission precedes creation');
  assert.match(fn, /executionMachineId = opts\?\.executionMachineId \?\? \(await desktopBridge\(\)\?\.executionMachineId\?\.\(\)\.catch\(\(\) => null\) \?\? null\)/,
    'the bridge NAMES the machine; after a Recheck admission the admitted machine wins');
  assert.match(fn, /\.\.\.\(executionMachineId \? \{ executionMachineId \} : \{\}\),\n\s+\},\n\s+\}\);/);
  const body = fn.slice(request, fn.indexOf('});', request));
  for (const forbidden of ['readiness', 'cliInstalled', 'higgsfield', 'items:', 'attestation']) {
    assert.doesNotMatch(body, new RegExp(forbidden, 'i'), `the request body must never carry a browser readiness claim (${forbidden})`);
  }
});

test('the typed 409 becomes the modal, not an error sentence; Recheck continues the same doQueue with the remembered note + fingerprint, once', () => {
  assert.match(actions, /const setup = parseSetupRequired\(e\);\n\s+if \(setup\) \{\n\s+setState\('idle'\);\n\s+setMsg\(''\);\n\s+setSetupCard\(setup\);\n\s+return;/);
  assert.match(actions, /onAdmitted=\{async \(machineId\) => \{ setSetupCard\(null\); await doQueue\(lastNote\.current, \{ fingerprint: lastFingerprint\.current, admitted: true, executionMachineId: machineId \}\); \}\}/,
    'the admitted retry carries THE machine the admission was proven on');
  assert.match(actions, /<SetupRequiredModal\n\s+card=\{setupCard\}/, 'the one shared modal shell');
  assert.match(gate, /export const SETUP_REQUIRED_TITLE = 'Setup required before this agent can run\.';/);
  assert.match(card, /const inFlightRef = useRef\(false\);\n\s+const admittedRef = useRef\(false\);/);
  assert.match(card, /async function recheck\(\) \{\n\s+if \(inFlightRef\.current \|\| admittedRef\.current\) return;\n\s+inFlightRef\.current = true;/,
    'BLOCKER 13: the in-flight guard is SYNCHRONOUS, set before the first await — a second click during the check cannot start a second admission');
  assert.match(card, /if \(admittedRef\.current\) return;\n\s+if \(res\?\.ok === true && res\?\.admitted === true\) \{\n\s+admittedRef\.current = true;\n\s+await onAdmitted\(machineId\);/,
    'admission is re-checked after the awaits and continues the same action exactly once, naming the machine');
  assert.match(card, /const machineId: string \| null = current\.machine\.id;/, 'BLOCKER 16: Recheck asks about THE machine the card was raised for');
  assert.match(card, /if \(!machineId \|\| !bridgeMachine \|\| bridgeMachine === machineId\) \{\n\s+const r = await native\.recheckMachineCapabilities\(\)/, 'the bridge re-probes only when it IS that machine');
  assert.match(card, /const target = setupTargetFor\(current, \{ slug, workflowVersionId \}\);/, 'Open setup carries the real agent, frozen version and selected machine');
  assert.doesNotMatch(card, /this-agent/, 'never a guessed slug');
  assert.match(card, /if \(!target\) \{\n\s+setNote\(/, 'no agent named → a note, not a navigation');
  assert.match(card, /if \(!preAdmit \|\| !target\) \{/, 'a continuation retries its own request (frozen version), only Run pre-admits');
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
  assert.match(setupPage, /Sign in with the vendor’s CLI in a terminal on this computer \(Implexa never captures the credential\)/);
  assert.match(setupPage, /if \(r\.installUrl\) \{ window\.open\(r\.installUrl, '_blank', 'noopener,noreferrer'\)/);
});

test('a Continue gets the same typed refusal and modal', () => {
  assert.match(continueBox, /const setup = parseSetupRequired\(e\);\n\s+if \(setup\) \{ setSetupCard\(setup\); return; \}/);
  assert.match(continueBox, /<SetupRequiredModal\n\s+card=\{setupCard\}\n\s+slug=\{slug\}\n\s+workflowVersionId=\{workflowVersionId\}\n\s+onAdmitted=\{async \(machineId\) => \{ setSetupCard\(null\); await submit\(\{ executionMachineId: machineId \}\); \}\}/);
});

test('BLOCKER 14: every surface that creates a run request routes the typed refusal through the ONE gate — none swallows it or navigates on it', () => {
  const surfaces = {
    'run-actions.tsx': ['approveFinish', 'continueWithChanges', 'reconnectAndContinue'],
    'finish-run-button.tsx': ['finish'],
    'fix-now-button.tsx': ['fix'],
    'run-claude-actions.tsx': ['approveAndFinish'],
    'agent-feedback.tsx': ['send'],
  };
  for (const [file, fns] of Object.entries(surfaces)) {
    const src = read(file);
    assert.match(src, /useSetupRequiredGate\(/, `${file} uses the shared gate`);
    assert.match(src, /\{setupGate\.modal\}/, `${file} renders the shared modal`);
    for (const fn of fns) {
      const body = src.slice(src.indexOf(`function ${fn}(`), src.indexOf('\n  }\n', src.indexOf(`function ${fn}(`)));
      assert.match(body, /setupGate\.guard\(|await enqueueRun\(\)/, `${file}#${fn} is guarded`);
      assert.match(body, /if \(!gated\.ok\)|if \(!queued\)/, `${file}#${fn} stops on a refusal`);
      const stop = body.indexOf('if (!gated.ok)') >= 0 ? body.indexOf('if (!gated.ok)') : body.indexOf('if (!queued)');
      const refusalBranch = body.slice(stop, body.indexOf('\n', stop));
      assert.doesNotMatch(refusalBranch, /router\.push|location\.href|openInClaude/, `${file}#${fn} never navigates on a refusal`);
    }
  }
  const gateSrc = read('setup-required-gate.tsx');
  assert.match(gateSrc, /const card = parseSetupRequired\(e\);\n\s+if \(!card\) throw e;/, 'every other error is rethrown to the surface, unchanged');
  assert.match(gateSrc, /setPending\(\{ card, retry: async \(admittedMachine\) => \{ await guard\(action, onSuccess, admittedMachine \?\? card\.machine\.id\); \} \}\);/, 'Recheck retries the SAME action once, on the admitted machine');
  assert.match(read('fix-now-button.tsx'), /const queued = await enqueueRun\(\);\n\s+if \(!queued\) \{ setFiring\(false\); return; \}/, 'Fix now no longer navigates while an enqueue fails in the background');
  const claudeActions = read('run-claude-actions.tsx');
  const approve = claudeActions.slice(claudeActions.indexOf('async function approveAndFinish()'), claudeActions.indexOf('async function openInClaude()'));
  assert.doesNotMatch(approve, /openInClaude|location\.href|\/review`/, 'Approve & finish never opens Claude or marks the run approved on ANY failure');
  assert.match(approve, /\} catch \(error\) \{\n(?:\s*\/\/[^\n]*\n)*\s+setErr\(runRequestRefusalCopy\(error,/);
});

test('BLOCKER 15/16/17: the setup page routes every backend action, renders the backend instructions, is pinned to the selected machine, and hides stale readiness', () => {
  for (const action of ['install_runtime', 'install_cli', 'install_media_tools', 'sign_in_cli', 'free_disk']) {
    assert.match(setupPage, new RegExp(`action === '${action}'`), `${action} is routed`);
  }
  assert.match(setupPage, /native\.requestInstallMediaRuntime\(\)/, 'install_runtime goes through the Desktop’s consented runtime install');
  assert.match(setupPage, /data-testid=\{`machine-setup-instructions-\$\{req\.id\}`\}/, 'backend instructions render verbatim');
  assert.match(setupPage, /const selectedMachine = useRef<string \| null>\(machineId\);/, 'the machine segment pins the page');
  assert.match(setupPage, /if \(!target \|\| !here \|\| here === target\) \{/, 'the bridge re-probes only when it IS the selected machine');
  assert.match(setupPage, /setStale\(true\);/);
  assert.match(setupPage, /\{stale\n\s+\? <span[^>]*data-testid="machine-setup-stale"/, 'a failed refresh never shows Ready');
  assert.match(read('modal.tsx'), /first\?\.focus\(\);/, 'focus enters the dialog');
  assert.match(read('modal.tsx'), /if \(e\.key !== 'Tab' \|\| !dialog\) return;/, 'Tab is contained');
  assert.match(read('modal.tsx'), /if \(back && typeof back\.focus === 'function' && back\.isConnected\) back\.focus\(\);/, 'focus is restored on close');
  const route = read('../settings/machine-setup/[slug]/[[...scope]]/page.tsx');
  assert.match(route, /const scope = parseSetupScope\(params\.scope\);\n\s+if \(!scope\) notFound\(\);/);
  assert.match(route, /machineId=\{scope\.machineId\} workflowVersionId=\{scope\.workflowVersionId\}/);
  assert.match(setupPage, /\$\{workflowVersionId \? `&workflowVersionId=\$\{encodeURIComponent\(workflowVersionId\)\}` : ''\}/, 'the setup page reads the frozen version');
  const runPage = read('../runs/[id]/page.tsx');
  assert.match(runPage, /<FinishRunButton runId=\{r\.id\} slug=\{r\.skill_slug\} workflowVersionId=\{runWorkflowVersionId\} \/>/);
  assert.match(runPage, /<RunContinueBox runId=\{r\.id\}\n\s+agentName=\{name\}\n\s+slug=\{r\.skill_slug\}\n\s+workflowVersionId=\{runWorkflowVersionId\}/);
  assert.match(runPage, /skillSlug=\{r\.skill_slug\}\n\s+workflowVersionId=\{runWorkflowVersionId\}/);
});

test('parseSetupRequired admits only a 409 with the exact discriminator', () => {
  assert.match(lib, /if \(e\.status !== 409\) return null;/);
  assert.match(lib, /if \(c\.code !== 'setup_required' \|\| !Array\.isArray\(c\.items\)\) return null;/);
});
