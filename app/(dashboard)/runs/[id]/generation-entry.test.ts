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
  // RE-ANCHORED for the source-duration boundary. The page no longer asks the
  // weaker question ("is there SOME validated video?") — it resolves the EXACT
  // artifact and reads its authoritative length, because a run is not a source
  // and the moments placed here are bounded by that number.
  assert.match(entryPage, /classifyGenerationSource/);
  assert.match(entryPage, /\.eq\('status', 'validated'\)/);
  // The duration is READ from the artifact row. If this select ever stops
  // naming it, the page would be back to compiling against no ceiling.
  assert.match(entryPage, /media_duration_ms/);
  // ...and an unresolved source stops the page before the builder mounts.
  assert.match(entryPage, /if \(!source\)/);
  // The user resolves ambiguity; the page never picks a source for them.
  assert.match(entryPage, /selectSource/);
  assert.doesNotMatch(entryPage, /sources\[0\]|\.find\(\(\) => true\)/,
    'the page must never silently choose among several validated final videos');
  assert.match(entryPage, /sourceRunId: source run|owner-scoped|RLS/is);
});

test('the assembled builder compares before create and has an in-memory single flight', () => {
  assert.match(builder, /action: 'preview'/);
  // Quick is bound to the exact source too — an unbound Quick moment would be
  // the cheaper way to authorize a clip with nowhere to go.
  assert.match(builder, /sourceArtifactId: source\.artifactId/);
  assert.match(builder, /withinSourceDuration\(/);
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
