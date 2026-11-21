import { test } from 'node:test';
import assert from 'node:assert/strict';

import { EDIT_SEED_COPY, resolveEditSeed, type EditSeed } from './generation-edit-seed.ts';
import { parseCompiledProfessionalV2Proposal } from './generation-proposal-v2.ts';
import { timelineFromCompiledProposal } from './professional-v2-entry.ts';
import { V2_PREVIEW_MULTI } from './professional-v2.fixtures.ts';
import type { GenerationSource } from './generation-source.ts';

const SOURCE_A = 'aa000000-0000-4000-8000-0000000000a1';
// The REAL fixture's bound source id — "source B" in the A/B scenario below.
const FIXTURE_SOURCE_B = 'b8a1d20c-4e73-4f19-9c8a-5d2e6f70b134';

const sourceA = (over: Partial<GenerationSource> = {}): GenerationSource => ({
  artifactId: SOURCE_A, relativePath: 'out/version-a.mp4', mediaDurationMs: 45000, ...over,
});
const sourceB = (over: Partial<GenerationSource> = {}): GenerationSource => ({
  artifactId: FIXTURE_SOURCE_B, relativePath: 'output/final-reel.mp4', mediaDurationMs: 600000, ...over,
});

/** The REAL producer's plan, as the page would seed it: moments + the signed
 * binding's artifact id. Using the probed fixture keeps this the same document
 * the strict parser accepts, not a hand-written stand-in. */
function fixtureSeed(): EditSeed {
  const compiled = parseCompiledProfessionalV2Proposal(
    (V2_PREVIEW_MULTI as { proposal: unknown }).proposal,
  );
  assert.ok(compiled, 'the real fixture must parse');
  const moments = timelineFromCompiledProposal(compiled!);
  assert.ok(moments && moments.length >= 2, 'the multi-moment fixture must carry a real timeline');
  return { moments: moments!, sourceArtifactId: compiled!.sourceBinding.sourceArtifactId };
}

// ── THE REQUIRED REPRODUCTION ───────────────────────────────────────────────
// A run holds TWO final videos, A and B. The plan under edit was compiled
// against B. Edit → source resolution must bind to B with every moment intact,
// no chooser, no approval identity — and A must play no part in it.

test('A/B run, plan on B: Edit binds to B with ALL moments preserved', () => {
  const seed = fixtureSeed();
  assert.equal(seed.sourceArtifactId, FIXTURE_SOURCE_B, 'the fixture binding names source B');

  const resolved = resolveEditSeed(seed, [sourceA(), sourceB()]);
  assert.equal(resolved.kind, 'bound');
  if (resolved.kind !== 'bound') return;
  // THE SOURCE: exactly B — not A, not "the first one", not "the longest one".
  assert.equal(resolved.source.artifactId, FIXTURE_SOURCE_B);
  assert.equal(resolved.source.mediaDurationMs, 600000);
  // THE TIMELINE: every moment, byte-for-byte the plan's own.
  assert.deepEqual(resolved.moments, seed.moments);
  // NO APPROVAL IDENTITY: the resolution carries nothing a stale approval could
  // ride on — no proposal id, no digests, no fingerprint.
  const keys = Object.keys(resolved).sort();
  assert.deepEqual(keys, ['kind', 'moments', 'source']);
  for (const forbidden of ['proposalId', 'proposalDigest', 'graphDigest', 'timelineFingerprint']) {
    assert.equal(forbidden in resolved, false, `${forbidden} must not travel with an edit seed`);
  }
});

test('order independence: B is found by IDENTITY, not by position', () => {
  const seed = fixtureSeed();
  const forward = resolveEditSeed(seed, [sourceA(), sourceB()]);
  const reversed = resolveEditSeed(seed, [sourceB(), sourceA()]);
  assert.equal(forward.kind, 'bound');
  assert.equal(reversed.kind, 'bound');
  if (forward.kind === 'bound' && reversed.kind === 'bound') {
    assert.equal(forward.source.artifactId, FIXTURE_SOURCE_B);
    assert.equal(reversed.source.artifactId, FIXTURE_SOURCE_B);
  }
});

// ── fail-closed states ──────────────────────────────────────────────────────

test('plan source UNVERIFIED: fail closed with the Desktop action — never rebound to A', () => {
  const resolved = resolveEditSeed(fixtureSeed(), [sourceA(), sourceB({ mediaDurationMs: null })]);
  assert.equal(resolved.kind, 'source_unverified');
  if (resolved.kind !== 'source_unverified') return;
  assert.equal(resolved.source.artifactId, FIXTURE_SOURCE_B, 'the refusal names the plan\'s OWN source');
  assert.deepEqual(resolved.moments, fixtureSeed().moments, 'the timeline survives the refusal');
  assert.match(EDIT_SEED_COPY.source_unverified.action ?? '', /Implexa Desktop/);
});

test('plan source MISSING from the run: fail closed — never rebound to whatever remains', () => {
  const resolved = resolveEditSeed(fixtureSeed(), [sourceA()]);
  assert.equal(resolved.kind, 'source_missing');
  if (resolved.kind !== 'source_missing') return;
  assert.equal(resolved.sourceArtifactId, FIXTURE_SOURCE_B);
  assert.deepEqual(resolved.moments, fixtureSeed().moments);
  assert.match(EDIT_SEED_COPY.source_missing.body, /deliberately/);
});

// ── the deliberate change ───────────────────────────────────────────────────

test('an EXPLICIT different source is a stated change, moments carried, original named', () => {
  const resolved = resolveEditSeed(fixtureSeed(), [sourceA(), sourceB()], SOURCE_A);
  assert.equal(resolved.kind, 'source_changed');
  if (resolved.kind !== 'source_changed') return;
  assert.equal(resolved.source.artifactId, SOURCE_A);
  assert.equal(resolved.originalSourceArtifactId, FIXTURE_SOURCE_B, 'the switch names what it switched from');
  assert.deepEqual(resolved.moments, fixtureSeed().moments);
});

test('an explicit choice that merely re-names the plan\'s own source is BOUND, not a change', () => {
  const resolved = resolveEditSeed(fixtureSeed(), [sourceA(), sourceB()], FIXTURE_SOURCE_B);
  assert.equal(resolved.kind, 'bound');
});

test('an explicit choice cannot rescue a missing original into a SILENT rebinding', () => {
  // The requested source is unverified: the deliberate path only honours a
  // VERIFIED target, and an unhonourable request falls back to the plan's own
  // source's true state — never to some third file.
  const toUnverified = resolveEditSeed(fixtureSeed(), [sourceA({ mediaDurationMs: null }), sourceB()], SOURCE_A);
  assert.equal(toUnverified.kind, 'bound', 'falls back to the plan\'s own (verified) source');

  const bothGone = resolveEditSeed(fixtureSeed(), [sourceA({ mediaDurationMs: null })], SOURCE_A);
  assert.equal(bothGone.kind, 'source_missing', 'and when the plan\'s source is gone, that is still the answer');
});
