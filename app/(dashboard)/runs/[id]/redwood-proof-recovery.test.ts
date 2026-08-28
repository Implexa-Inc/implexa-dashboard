import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const page = readFileSync(join(process.cwd(), 'app', '(dashboard)', 'runs', '[id]', 'page.tsx'), 'utf8');
const review = readFileSync(join(process.cwd(), 'app', '(dashboard)', 'review', '[runId]', 'page.tsx'), 'utf8');
const room = readFileSync(join(process.cwd(), 'app', '(dashboard)', '_components', 'review-room.tsx'), 'utf8');

test('run and Review Room render stage competence separately from learnings', () => {
  assert.match(page, /<StageCompetenceProof/);
  assert.match(page, /getReviewPacket\(r\.id\)/);
  assert.match(page, /aria-label="Learnings used"/);
  assert.match(review, /<StageCompetenceProof proof=\{packet\.competenceProof\}/);
  assert.match(review, /aria-label="Learnings used"/);
  assert.doesNotMatch(page, /\.from\('run_competence_handling_receipts'\)/);
  assert.doesNotMatch(review, /\.from\('run_competence_handling_receipts'\)/);
  assert.doesNotMatch(page, /No learning context was frozen[^<]+skills/i);
});

test('failed runs with validated finals lead with the recovered artifact and suppress duplicate work', () => {
  assert.match(page, /A validated final output was recovered from this run/);
  assert.match(page, /suppressDuplicateRetry\(recoveryPresentation\)/);
  assert.match(page, /runProblemHeadline\(recoveryPresentation/);
  assert.match(page, /run_recovery_attempts/);
});

test('Review Room names exact lineage version, time, digest and latest validated final output', () => {
  assert.match(review, /versions=\{versions\}/);
  assert.match(review, /currentVersionLabel=\{currentLabel\}/);
  assert.match(room, /Reviewing \{currentVersion/);
  assert.match(room, /Latest validated final output:/);
  assert.match(room, /sha256 \{latestFinalOutput\.sha256/);
  assert.match(room, /Review latest final/);
});
