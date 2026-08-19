import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { PRIMARY_NAV } from '../../../lib/navigation.ts';

const root = join(import.meta.dirname, '..', '..', '..');
const list = readFileSync(join(import.meta.dirname, 'agents-list.tsx'), 'utf8');
const resume = readFileSync(join(import.meta.dirname, 'agent-resume.tsx'), 'utf8');
const service = readFileSync(join(root, 'lib', 'agent-discovery.ts'), 'utf8');

test('authenticated primary navigation is exactly Agents, Work, Training', () => {
  assert.deepEqual(PRIMARY_NAV.map((item) => item.label), ['Agents', 'Work', 'Training']);
  assert.equal(PRIMARY_NAV.some((item) => /Marketplace|Discover|Review|Home/.test(item.label)), false);
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
  assert.match(resume, /agent\.ownership === 'Owned' \? 'Finish setup' : 'Use agent'/,
    'an owner without an acquisition must not receive a runnable label');
  assert.match(resume, /Configure/); assert.match(resume, /Train/);
});

test('evidence keeps two axes: four provenance channels, four evidence types inside each', () => {
  for (const phrase of ['Deterministic verification', 'Judge review', 'Human acceptance', 'Certification']) assert.match(resume, new RegExp(phrase));
  for (const phrase of ['Builder training', 'Neutral benchmark', 'Customer field', 'Personal fit']) assert.match(resume, new RegExp(phrase));
  assert.match(resume, /EVIDENCE_CHANNEL_KEYS\.map/);
  assert.match(resume, /EVIDENCE_TYPE_KEYS\.map/);
  assert.match(resume, /Number\(entry\.count\) > 0/);
  // A channel is projected, never trusted straight off the wire.
  assert.match(resume, /parseEvidenceChannels\(agent\.evidenceChannels\)/);
  assert.match(resume, /evidenceChannels\.status === 'ready'/);
  assert.doesNotMatch(resume, /trust score|reliability score|star rating|leaderboard/i);
});

const DISCLAIMER = 'Implexa does not combine them into a score, rating, or rank.';

test('nothing in the resume blends channels into a single number', () => {
  const parser = readFileSync(join(root, 'lib', 'agent-evidence-channels.ts'), 'utf8');
  // The disclaimer NAMES the forbidden things, so it is removed before looking
  // for them — otherwise the promise not to compute a score would read as one.
  assert.match(resume, new RegExp(DISCLAIMER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  for (const source of [resume.replace(DISCLAIMER, ''), parser]) {
    assert.doesNotMatch(source, /\bscore\b|\brating\b|\bstars\b|percent|\brank\b|reliability|\baverage\b|\bweighted\b/i);
    // No arithmetic across channels or across evidence types.
    assert.doesNotMatch(source, /reduce\(\(/);
  }
});

test('personal fit is described as private and never as shared or global', () => {
  assert.match(resume, /Private to you/);
  assert.match(resume, /the builder and other buyers never see it/);
  assert.match(resume, /It stays private to your organization/);
  assert.doesNotMatch(resume, /personalFit[\s\S]{0,200}(public|shared|everyone|global)/i);
});

test('an unreadable projection is announced, never rendered as measured zero', () => {
  assert.match(resume, /Evidence by source is unavailable for this version, so none is shown/);
  assert.match(resume, /role="status"/);
  // The unavailable branch renders NO cards at all.
  assert.doesNotMatch(resume, /evidenceChannels\.status !== 'ready' \? [\s\S]{0,80}EVIDENCE_CHANNEL_KEYS/);
});

test('readiness cannot falsely collapse Blocked or Needs setup into Ready', () => {
  assert.match(resume, /agent\.readiness\.state === 'Available'/);
  assert.match(resume, /agent\.readiness\.state === 'Needs setup'/);
  assert.doesNotMatch(resume, /agent\.readiness\.state === 'Needs setup' \|\| agent\.readiness\.state === 'Blocked'/,
    'non-remediable Blocked state must not offer Finish setup');
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
  assert.match(resume, /update\.authorityDiff\.changesAuthority && !acceptedUpdate/);
});

test('disable/remove management preserves history and has explicit destructive confirmation', () => {
  assert.match(resume, /Prior runs, receipts, reviews, learning evidence, and version provenance stay intact/);
  assert.match(resume, /\/disable/); assert.match(resume, /\/enable/); assert.match(resume, /\/uninstall/);
  assert.match(resume, /disabled=\{busy \|\| !confirmUninstall\}/);
  assert.match(resume, /agent\.readiness\.state === 'Ready'/, 'Use agent is limited to Ready');
  assert.match(resume, /agent\.ownership === 'Owned'/, 'Train and Configure are owner-only');
  assert.match(resume, /\{agent\.ownership === 'Owned' &&/, 'owner controls stay explicitly owner-gated');
  assert.match(resume, /agent\.acquisition\.lifecycle !== 'uninstalled'/,
    'uninstalled acquisitions never render disable/remove controls');
});
