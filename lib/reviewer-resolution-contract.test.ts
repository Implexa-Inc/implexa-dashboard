import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseReviewPacketResponse } from './review.ts';
import { revisionCompositionLabel } from './review-room-state.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixturePath = resolve(root, 'fixtures/reviewer-resolution-packet.json');
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
const packet = fixture.packet;

test('backend-produced reviewer-resolution packet parses and preserves cross-round identities', () => {
  const parsed = parseReviewPacketResponse(packet, packet.run.id);
  assert.ok(parsed);
  assert.equal(parsed.issues.length, 3);
  assert.equal(parsed.issues[0].sessionId !== parsed.session?.id, true, 'carried issue keeps its origin session and ID');
  assert.equal(parsed.issues[2].reviewerResolution?.actor.kind, 'reviewer_dashboard_user');
  assert.equal(parsed.issues[2].reviewerResolution?.issueId, parsed.issues[2].id);
  assert.equal(fixture.resolveResponse.resolutions[0].issueId, parsed.issues[0].id);
  assert.equal(parsed.issues[2].status, 'submitted', 'reviewer assertion does not overwrite executor lifecycle status');
  assert.equal(revisionCompositionLabel(1, 1), 'Send 1 unresolved + 1 new change');
  assert.equal(revisionCompositionLabel(0, 2), 'Send 0 unresolved + 2 new changes');
});

test('a reviewer-resolution without its issueId fails the packet boundary', () => {
  const malformed = structuredClone(packet);
  delete malformed.issues[2].reviewerResolution.issueId;
  assert.equal(parseReviewPacketResponse(malformed, malformed.run.id), null);
});

test('a packet without the contracted reviewer-resolution source fails closed', () => {
  const malformed = structuredClone(packet);
  delete malformed.sources.reviewer_resolutions;
  assert.equal(parseReviewPacketResponse(malformed, malformed.run.id), null);
});

test('every issue must explicitly carry reviewerResolution as null or a valid object', () => {
  const malformed = structuredClone(packet);
  delete malformed.issues[0].reviewerResolution;
  assert.equal(parseReviewPacketResponse(malformed, malformed.run.id), null);
});

test('checked-in fixture is byte-equivalent JSON to the backend producer', () => {
  const candidates = [
    process.env.IMPLEXA_BACKEND_DIR,
    resolve(root, '../implexa-backend-reviewer-resolution'),
    resolve(root, '../implexa-backend'),
  ].filter(Boolean) as string[];
  const backend = candidates.find((dir) => existsSync(resolve(dir, 'scripts/generate-reviewer-resolution-dashboard-fixture.js')));
  assert.ok(backend, 'checkout the matching backend PR beside the Dashboard or set IMPLEXA_BACKEND_DIR');
  const generated = spawnSync(process.execPath, ['scripts/generate-reviewer-resolution-dashboard-fixture.js'], { cwd: backend, encoding: 'utf8' });
  assert.equal(generated.status, 0, generated.stderr);
  assert.deepEqual(JSON.parse(generated.stdout), fixture);
});
