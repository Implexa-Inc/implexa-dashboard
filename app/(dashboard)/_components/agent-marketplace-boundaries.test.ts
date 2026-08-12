import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..', '..', '..');
const sidebar = readFileSync(join(import.meta.dirname, 'sidebar.tsx'), 'utf8');
const list = readFileSync(join(import.meta.dirname, 'agents-list.tsx'), 'utf8');
const resume = readFileSync(join(import.meta.dirname, 'agent-resume.tsx'), 'utf8');
const service = readFileSync(join(root, 'lib', 'agent-discovery.ts'), 'utf8');

test('authenticated primary navigation is exactly Agents, Work, Training', () => {
  const block = sidebar.match(/const PRIMARY_NAV:[\s\S]*?\n\];/)?.[0] || '';
  assert.deepEqual([...block.matchAll(/label: '([^']+)'/g)].map((match) => match[1]), ['Agents', 'Work', 'Training']);
  assert.doesNotMatch(block, /Marketplace|Discover|Review|Home/);
  assert.equal(existsSync(join(root, 'app', '(dashboard)', 'marketplace', 'page.tsx')), false);
});

test('Agents is one outcome-first surface with available results and a query-prefilled build result', () => {
  assert.match(list, /placeholder="What outcome do you need\?"/);
  assert.match(list, /Build yours for free/);
  assert.match(list, /encodeURIComponent\(query\.trim\(\)\)/);
  assert.match(list, /Filter available agents/);
  assert.match(list, /Readiness/);
  assert.match(list, /Tested engine/);
  assert.doesNotMatch(list, />\s*(Discover|Yours)\s*</, 'no pre-gate Discover/Yours tab chrome');
  assert.match(service, /\/api\/v2\/agents\/discovery/);
});

test('agent resume uses locked ownership/action language and never package-install language', () => {
  for (const phrase of ['View agent', 'Use agent', 'Finish setup', 'View build']) assert.match(`${list}\n${resume}`, new RegExp(phrase));
  assert.doesNotMatch(`${list}\n${resume}`, /Install package|Install item|Marketplace item/i);
  assert.match(resume, /agent\.ownership === 'Owned'/);
  assert.match(resume, /Configure/); assert.match(resume, /Train/);
});

test('trust channels remain separate and sparse evidence is described without a score', () => {
  for (const phrase of ['Deterministic verification', 'Judge review', 'Human acceptance', 'Certification']) assert.match(resume, new RegExp(phrase));
  assert.match(resume, /channel\.status\.replaceAll\('_', ' '\)/);
  assert.doesNotMatch(resume, /trust score|reliability score/i);
});

test('readiness cannot falsely collapse Blocked or Needs setup into Ready', () => {
  assert.match(resume, /agent\.readiness\.state === 'Available'/);
  assert.match(resume, /agent\.readiness\.state === 'Needs setup' \|\| agent\.readiness\.state === 'Blocked'/);
  assert.match(resume, /role="status"/);
  assert.match(resume, /Finish setup/);
  assert.match(resume, /Adding agent…/); assert.match(resume, /Checking setup…/);
  assert.match(resume, /role="alert"/);
});

test('authority-broadening updates disclose the diff and require explicit acceptance', () => {
  assert.match(resume, /Added capabilities:/);
  assert.match(resume, /Added permissions:/);
  assert.match(resume, /type="checkbox"/);
  assert.match(resume, /acceptAuthorityChange: acceptedUpdate/);
  assert.match(resume, /agent\.update\.authorityDiff\.changesAuthority && !acceptedUpdate/);
});

test('disable/remove management preserves history and has explicit destructive confirmation', () => {
  assert.match(resume, /Prior runs, receipts, reviews, learning evidence, and version provenance stay intact/);
  assert.match(resume, /\/disable/); assert.match(resume, /\/enable/); assert.match(resume, /\/uninstall/);
  assert.match(resume, /disabled=\{busy \|\| !confirmUninstall\}/);
  assert.match(resume, /agent\.readiness\.state === 'Ready'/, 'Use agent is limited to Ready');
  assert.match(resume, /agent\.ownership === 'Owned'/, 'Train and Configure are owner-only');
});
