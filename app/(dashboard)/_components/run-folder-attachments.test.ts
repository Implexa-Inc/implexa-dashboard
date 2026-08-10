import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const attachments = readFileSync(new URL('./run-attachments.tsx', import.meta.url), 'utf8');
const consumers = [
  './run-continue-box.tsx',
  './run-actions.tsx',
  './talk-to-implexa.tsx',
  './agent-actions.tsx',
].map((file) => readFileSync(new URL(file, import.meta.url), 'utf8'));

test('the desktop bridge and shared attachment UI distinguish files from folders', () => {
  assert.match(attachments, /pickDirectory\?: \(\) => Promise/);
  assert.match(attachments, /await bridge\.pickDirectory\(\)\.catch/);
  assert.match(attachments, />\s*Attach folder\s*</);
});

test('every generic run, continue, and build attachment surface wires the folder handler', () => {
  for (const source of consumers) {
    assert.match(source, /canAttachFolder/);
    assert.match(source, /attachFolder/);
    assert.match(source, /onAttachFolder=\{attachFolder\}/);
  }
});
