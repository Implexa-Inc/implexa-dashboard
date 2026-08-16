// node --test lib/review-capsule-contract.test.ts
//
// Revision Reliability Tranche 1 — Dashboard side of the cross-repo contract,
// against REAL PRODUCER OUTPUT. test-fixtures/generated/review-capsule-producer.json
// is the committed output of the backend's scripts/generate-review-capsule-fixtures.js
// at the pinned commit. The Review Room consumes three things this file pins:
//   1. the submit response echo (sourceMode / sourceModeDerived / instruction /
//      expectedArtifacts) that the queued panel renders;
//   2. the packet's approvedVersions (Approved badge is digest-matched, so the
//      producer's member shape is load-bearing);
//   3. the typed refusal codes the submit flow maps to actionable copy instead of
//      the old dead-end incomplete-input-contract error.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const FIXTURE = JSON.parse(fs.readFileSync(
  path.join(process.cwd(), 'test-fixtures', 'generated', 'review-capsule-producer.json'),
  'utf8',
));

const BACKEND_PIN = '71af67e1f83987ed93df4a5dc56af9514a0bd7e2';

test('the committed producer fixture is the one this build was verified against', () => {
  assert.equal(FIXTURE.backendPin, BACKEND_PIN);
  assert.equal(FIXTURE.contractVersion, 2);
});

test('submit echo: the server derives the mode and says so — the room never guesses', () => {
  const e = FIXTURE.capsuleExternalFiles.explicit;
  assert.equal(e.sourceMode, 'reviewed_capsule');
  assert.equal(e.sourceModeDerived, false);
  const d = FIXTURE.capsuleExternalFiles.derivedFromIncompleteLineage;
  assert.equal(d.sourceMode, 'reviewed_capsule');
  assert.equal(d.sourceModeDerived, true);
});

test('capsule members carry exactly the identity the room displays: position, artifactId, sha256, role, name', () => {
  const members = FIXTURE.capsuleExternalFiles.explicit.sourceContext.members;
  assert.ok(members.length >= 2);
  for (const [i, m] of members.entries()) {
    assert.deepEqual(Object.keys(m).sort(), ['artifactId', 'name', 'position', 'role', 'sha256']);
    assert.equal(m.position, i + 1);
    assert.match(m.sha256, /^[0-9a-f]{64}$/);
  }
  // The declared project bundle is a first-class member, not a loose attachment.
  assert.equal(members.some((m) => m.role === 'project_capsule'), true);
});

test('typed refusal codes reach the client — ambiguity is actionable, not a dead end', () => {
  const r = FIXTURE.capsuleRefusals;
  assert.equal(r.emptyCapsule.code, 'reviewed_capsule_incomplete');
  assert.equal(r.sourceModeAmbiguous.code, 'source_mode_ambiguous');
  assert.match(r.sourceModeAmbiguous.error, /open the exact files \(or attach them\)/);
  assert.equal(r.missingProjectCapsule.code, 'reviewed_capsule_incomplete');
});

test('approved versions are digest-bound and ordered — the Approved badge can match by sha256 alone', () => {
  const approved = FIXTURE.nativeRebuild4307f3c0.approvedVersions;
  assert.equal(approved.length, 5);
  for (const [i, a] of approved.entries()) {
    assert.deepEqual(Object.keys(a).sort(), ['artifactId', 'name', 'position', 'sha256']);
    assert.equal(a.position, i + 1);
    assert.match(a.sha256, /^[0-9a-f]{64}$/);
  }
});

test('instruction rounds: the queued panel can render "v2 (supersedes v1)" from the echo', () => {
  const r = FIXTURE.instructionRounds;
  assert.deepEqual(r.round1.instruction, { version: 1, supersedesVersion: null });
  assert.deepEqual(r.round2.instruction, { version: 2, supersedesVersion: 1 });
});

test('expected artifacts: the pre-submit roster the footer summarizes is frozen server-side', () => {
  const roster = FIXTURE.expectedResultsTotality.expectedArtifacts;
  assert.ok(roster.length >= 2);
  for (const e of roster) {
    assert.deepEqual(Object.keys(e).sort(), ['key', 'kind', 'name', 'sourceArtifactId']);
    assert.ok(['revision_of', 'assembly'].includes(e.kind));
  }
  assert.match(FIXTURE.expectedResultsTotality.partial.error, /A partial artifact set cannot close as success/);
});
