import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const runPage = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');
const entryPage = readFileSync(new URL('./generate-broll/page.tsx', import.meta.url), 'utf8');
const builder = readFileSync(new URL('../../_components/broll-proposal-builder.tsx', import.meta.url), 'utf8');

test('the entry flow is mounted from a validated video run through to the builder', () => {
  assert.match(runPage, /verifiedArtifacts\.some\(isValidatedVideoOutput\)/);
  assert.match(runPage, /\/generate-broll/);
  assert.match(entryPage, /<BrollProposalBuilder/);
  assert.match(entryPage, /classifyGenerationEntryArtifacts/);
  assert.match(entryPage, /\.eq\('status', 'validated'\)/);
  assert.match(entryPage, /eligibility !== 'eligible'/);
  assert.match(entryPage, /sourceRunId: source run|owner-scoped|RLS/is);
});

test('the assembled builder compares before create and has an in-memory single flight', () => {
  assert.match(builder, /action: 'preview'/);
  assert.match(builder, /parseGenerationPreviewSet/);
  assert.match(builder, /action: 'create'/);
  assert.match(builder, /parseGenerationCreateResponse/);
  assert.match(builder, /createFlight\.current/);
  assert.match(builder, /router\.push\(`\/generations\//);
});

test('the assembled selector consumes canonical per-mode selectability', () => {
  const selector = readFileSync(new URL('../../_components/quality-mode-selector.tsx', import.meta.url), 'utf8');
  assert.match(selector, /qualityModeSelectorState\(compiledByMode\)/);
  assert.match(selector, /disabled=!\{?selectable\}?|disabled=\{!selectable\}/);
});
