// node --test "app/(dashboard)/runs/[id]/recovered-affordance.test.ts"

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const page = readFileSync(join(import.meta.dirname, 'page.tsx'), 'utf8');

test('the recovered-elsewhere check queries run_recovery_attempts scoped to THIS run and status=recovered', () => {
  const i = page.indexOf('alreadyRecoveredElsewhere');
  const block = page.slice(i, i + 700);
  assert.match(block, /from\('run_recovery_attempts'\)/, 'must read the recovery ledger');
  assert.match(block, /\.eq\('target_run_id', params\.id\)/, 'scoped to the run on the page, not any run');
  assert.match(block, /\.eq\('status', 'recovered'\)/, 'only a SUCCEEDED recovery counts — a failed/needs_human attempt must not hide the affordance');
});

test('THE CROSS-FEATURE FIX: when already recovered elsewhere, deriveRecoveredWork is never even consulted', () => {
  assert.match(page, /const recovered = alreadyRecoveredElsewhere\s*\n\s*\? \{ recoverable: false,/,
    'a run already recovered by a continuation must short-circuit to non-recoverable, not fall through to the trace-based derivation');
});

test('THE FALSE-POSITIVE FIX (2026-09-10): the derivation receives the VALIDATED artifacts, and transcript-only evidence gets an explanation, never a finalize button', () => {
  assert.match(page, /deriveRecoveredWork\(\{ runState: r\.run_state, outputMarkdown: r\.output_markdown, progress, stepsState, validatedArtifacts: recoveryArtifacts \}\)/,
    'the affordance must be gated on Desktop-validated artifacts, not on heartbeat/step counts');
  // BLOCKER 12 (2026-09-11): the derivation needs id + sha256 + status, which
  // the display projection never carried — ONE projection now serves both.
  assert.match(page, /\.select\(RUN_ARTIFACT_COLUMNS\)/, 'the page selects the projection’s column list (id, sha256, status included)');
  assert.match(page, /const projected = projectRunArtifacts\(data, artifactRolePriority\);\n\s+verifiedArtifacts = projected\.verified;\n\s+recoveryArtifacts = projected\.recovery;/);
  assert.doesNotMatch(page, /\.select\('relative_path, validated_path, role, size_bytes'\)/, 'the sha-less projection is gone');
  const notice = page.slice(page.indexOf('!recovered.recoverable && recovered.transcriptOnly && ('), page.indexOf('!recovered.recoverable && recovered.transcriptOnly && (') + 900);
  assert.match(notice, /No deliverable was recovered/);
  assert.doesNotMatch(notice, /FinalizeRecoveredButton/, 'transcript-only work must never be markable as done');
  const banner = page.slice(page.indexOf('recovered.recoverable && ('), page.indexOf('recovered.recoverable && (') + 1800);
  assert.match(banner, /A validated deliverable \(\{recovered\.deliverable\?\.relativePath\}\) exists/);
});

test('the finalize action renders only when the recovered trace looks complete', () => {
  const i = page.indexOf('recovered.recoverable && (');
  assert.notEqual(i, -1);
  // Through the end of the incomplete branch (the continuation carries the run's slug + frozen version).
  const block = page.slice(i, page.indexOf('{/* Transcript-only evidence is explained', i));
  assert.match(block, /recovered\.looksComplete \? \(/);
  assert.match(block, /Work recovered — review and finalize/);
  assert.match(block, /<FinalizeRecoveredButton runId=\{r\.id\} looksComplete \/>/);
  assert.match(block, /Partial work is preserved — continuation required/);
  const incomplete = block.slice(block.indexOf('Partial work is preserved — continuation required'));
  assert.doesNotMatch(incomplete, /FinalizeRecoveredButton/,
    'an incomplete trace must never offer manual finalization');
  assert.match(incomplete, /<PreservedWorkContinuation runId=\{r\.id\} slug=\{r\.skill_slug\} workflowVersionId=\{runWorkflowVersionId\} \/>/,
    'an incomplete trace must offer the managed typed continuation');
});

test('partial preserved work never falls back to a generic attended Codex task', () => {
  assert.match(page, /!\(recovered\.recoverable && !recovered\.looksComplete\)[\s\S]*?<StuckRunButton/,
    'the generic Open-in-Codex escape hatch must be hidden when the typed continuation is available');
  assert.match(page, /import PreservedWorkContinuation from '\.\.\/\.\.\/_components\/preserved-work-continuation'/);
});

test('an incomplete trace is not advertised as a deterministic continuation', () => {
  assert.match(page, /hasDeterministicContinuation: approvalContinuationRecovery\s*\n\s*\|\| \(recovered\.recoverable && recovered\.looksComplete\)/);
});

test('the button is imported from the shared component, not re-implemented inline on the page', () => {
  assert.match(page, /import \{ FinalizeRecoveredButton \} from '\.\.\/\.\.\/_components\/finalize-recovered-button'/);
});
