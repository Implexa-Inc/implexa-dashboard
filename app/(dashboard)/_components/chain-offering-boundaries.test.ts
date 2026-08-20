import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..', '..', '..');
const resume = readFileSync(join(import.meta.dirname, 'chain-offering-resume.tsx'), 'utf8');
const section = readFileSync(join(import.meta.dirname, 'chain-offerings-section.tsx'), 'utf8');
const parser = readFileSync(join(root, 'lib', 'agent-chain-offerings.ts'), 'utf8');
const page = readFileSync(join(root, 'app', '(dashboard)', 'workflows', 'chains', '[slug]', 'page.tsx'), 'utf8');
const agentsPage = readFileSync(join(root, 'app', '(dashboard)', 'workflows', 'page.tsx'), 'utf8');

test('chains live inside the Agents surface — no separate marketplace page', () => {
  assert.equal(existsSync(join(root, 'app', '(dashboard)', 'marketplace')), false);
  assert.match(agentsPage, /ChainOfferingsSection/);
  assert.match(section, /aria-label="Agent chains"/);
  assert.match(section, /\/workflows\/chains\//);
});

test('an unauthorized viewer gets notFound — indistinguishable from nonexistence', () => {
  assert.match(page, /if \(result\.status === 'not_available'\) notFound\(\);/);
  // The comment EXPLAINS why there is no access-denied page; rendered JSX may
  // not contain one. Strip comments before scanning — the recurring trap.
  const rendered = page.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(rendered, /access denied|not authorized|permission/i,
    'an authorization-shaped error page would itself be a disclosure');
});

test('an unreadable offering fails closed without an invented catalog', () => {
  assert.match(agentsPage, /chainOfferings\.status === 'ready' \? chainOfferings\.offerings : \[\]/);
  assert.match(page, /Nothing about this chain could be verified, so acquiring and running are disabled/);
  assert.match(parser, /parseEvidenceChannels\(value\.evidenceChannels\)/);
  assert.match(parser, /if \(evidence\.status !== 'ready'\) return null;/,
    'a component with unreadable evidence refuses its node, which refuses the offering');
});

test('the parser refuses fabricated consequences and missing disclosures', () => {
  assert.match(parser, /zeroDefault !== \(ceiling\.maxProviderCalls === 0 && ceiling\.maxSpendMinor === 0\)/);
  assert.match(parser, /Local paths are never sent to the server/);
  assert.match(parser, /removes access, not history/);
  assert.match(parser, /orderedChain\.length !== 2/);
});

test('acquisition consents to the exact composition and cannot double-fire', () => {
  assert.match(resume, /offeringVersionId: offering\.version\.id, offeringDigest: offering\.version\.digest/);
  assert.match(resume, /if \(inFlight\.current\) return;/);
  assert.match(resume, /operationKeys\.current\.get\(fingerprint\)/);
  assert.match(resume, /disabled=\{busy \|\| !confirmUninstall\}/);
  assert.match(resume, /offering\.acquisition\?\.authority === 'exact'/);
  assert.match(resume, /offering\.acquisition\?\.authority === 'upgrade_required'/);
});

test('the chain resume preserves the no-blending and privacy language', () => {
  assert.match(resume, /Implexa does not combine them into a score, rating, or rank/);
  assert.match(resume, /stays private to your organization/);
  assert.match(resume, /If Step 1 does not succeed, Step 2 never runs/);
  assert.match(resume, /own connections and credentials/);
  assert.doesNotMatch(resume, /trust score|reliability|star rating|leaderboard/i);
});
