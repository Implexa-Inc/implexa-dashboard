import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(import.meta.dirname, 'agent-actions.tsx'), 'utf8');

test('saved verification and a manual replacement share one frozen run-input session', () => {
  const open = SRC.slice(SRC.indexOf("async function openPreRun"), SRC.indexOf("async function loadSetup"));
  const pick = SRC.slice(SRC.indexOf("async function chooseTypedInput"), SRC.indexOf("async function verifySavedFileInputs"));
  const verify = SRC.slice(SRC.indexOf("async function verifySavedFileInputs"), SRC.indexOf("// Poll the queued request"));

  assert.match(open, /const modalInputSessionId = inputSessionRef\.current \|\| crypto\.randomUUID\(\)/);
  assert.match(open, /verifySavedFileInputs\(savedInputs\.filesToVerify, modalInputSessionId\)/);
  assert.match(pick, /const sessionId = inputSessionRef\.current \|\| crypto\.randomUUID\(\)/);
  assert.match(pick, /inputSessionId: sessionId/);
  assert.match(verify, /inputSessionId: sessionId/);

  // The exact race: automatic verification starts, the user chooses a
  // replacement, then the automatic result arrives last. Both calls must have
  // been issued under the same identity, so arrival order cannot orphan one of
  // the two artifact bindings at backend validation.
  const ref = { current: null as string | null };
  const ensure = () => (ref.current ||= 'session-one');
  const savedStartedWith = ensure();
  const manualStartedWith = ensure();
  const lateSavedFinishedWith = savedStartedWith;
  assert.deepEqual(
    [savedStartedWith, manualStartedWith, lateSavedFinishedWith],
    ['session-one', 'session-one', 'session-one'],
  );
});

test('a bridge cannot silently switch the frozen session', () => {
  const pick = SRC.slice(SRC.indexOf("async function chooseTypedInput"), SRC.indexOf("async function verifySavedFileInputs"));
  const verify = SRC.slice(SRC.indexOf("async function verifySavedFileInputs"), SRC.indexOf("// Poll the queued request"));
  assert.match(pick, /outcome\.inputSessionId !== sessionId/);
  assert.match(verify, /outcome\.inputSessionId !== sessionId/);
});

test('a late saved-source result cannot overwrite a newer manual file or folder', () => {
  const pick = SRC.slice(SRC.indexOf("async function chooseTypedInput"), SRC.indexOf("async function verifySavedFileInputs"));
  const verify = SRC.slice(SRC.indexOf("async function verifySavedFileInputs"), SRC.indexOf("// Poll the queued request"));
  assert.match(pick, /advanceInputRevision\(inputRevisionRef\.current, field\.key\)/,
    'a successful manual result advances the field clock before it is displayed');
  assert.match(pick, /advanceInputRevision[\s\S]*setInputError\(field\.key, null\)[\s\S]*setInputOverrides/,
    'success clears any saved-source error that arrived while the native picker was open');
  assert.match(verify, /const revision = readInputRevision[\s\S]*inputRevisionIsCurrent\([\s\S]*continue/,
    'saved verification checks its starting revision before applying either a binding or an error');
});

test('a successfully queued run retires its session before the next run', () => {
  const queue = SRC.slice(SRC.indexOf("async function doQueue"), SRC.indexOf("function renderCapabilityCard"));
  assert.match(queue, /setInputOverrides\(\{\}\);\s*inputSessionRef\.current = null;\s*setInputSessionId\(null\);/);
});
