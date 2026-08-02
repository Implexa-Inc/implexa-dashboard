#!/usr/bin/env node
/**
 * Mutation test for the Review Room timestamp-feedback surface.
 *
 * A green suite proves nothing on its own — the surface that shipped the bug had tests
 * too. Each mutation below RE-INTRODUCES a specific regression (the observed production
 * one, or the three adjacent ones it makes easy) into a throwaway copy of the tree. If
 * the suite still passes, the test claiming to prevent that regression is decorative
 * and is reported as SURVIVED rather than quietly trusted.
 *
 * Boundaries covered:
 *   stale-playhead   the offer/anchor reading a position other than the visible one
 *   frozen-anchor    a draft's position moving after the composer opened
 *   cross-artifact   feedback from one file matched or moved by another
 *   edit-as-create   an update that appends instead of replacing
 *   range            an end at or before the start being accepted
 *   immutability     submitted/accepted/dismissed work becoming editable
 *   artifact-switch  a composer or playhead surviving a file switch
 */

import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const COMPONENT = 'app/(dashboard)/_components/review-room.tsx';
const files = [
  'lib/review-timestamp-feedback.ts', 'lib/review-timestamp-feedback.test.ts',
  'lib/review-room-feedback-wiring.test.ts',
  'lib/review-anchor.ts', 'lib/review-actions.ts',
  COMPONENT,
];
const tests = [
  'lib/review-timestamp-feedback.test.ts',
  'lib/review-room-feedback-wiring.test.ts',
];

const mutations = [
  // ── the observed production bug ───────────────────────────────────────────
  ['stale-playhead', 'the offer is bound to a stale paused position again', COMPONENT,
    'addFeedbackLabel({ playheadMs, existingCount: hereIssues.length })',
    'addFeedbackLabel({ playheadMs: draft?.anchorMs ?? null, existingCount: hereIssues.length })'],
  ['stale-playhead', 'scrubbing no longer reports a position (pause-only binding)', COMPONENT,
    '          onSeeked={(e) => onPlayhead(mediaKey, (e.currentTarget as HTMLMediaElement).currentTime)}\n',
    ''],
  ['stale-playhead', 'the displayed second rounds instead of matching the player readout',
    'lib/review-timestamp-feedback.ts',
    '  return Math.floor(Math.max(0, ms) / 1000);',
    '  return Math.round(Math.max(0, ms) / 1000);'],

  // ── the frozen anchor ─────────────────────────────────────────────────────
  ['frozen-anchor', 'saving reads the player instead of the frozen draft', COMPONENT,
    'return buildMediaAnchor(sha, d.anchorMs / 1000, d.rangeEndMs === null ? null : d.rangeEndMs / 1000);',
    'return buildMediaAnchor(sha, (mediaRef.current?.currentTime ?? 0), d.rangeEndMs === null ? null : d.rangeEndMs / 1000);'],
  ['frozen-anchor', 'setting a range end drags the start along with it',
    'lib/review-timestamp-feedback.ts',
    '  return { draft: { ...draft, rangeEndMs: Math.max(0, Math.round(playheadMs as number)) }, error: null };',
    '  return { draft: { ...draft, anchorMs: Math.max(0, Math.round(playheadMs as number)) - 1, rangeEndMs: Math.max(0, Math.round(playheadMs as number)) }, error: null };'],
  ['frozen-anchor', 'a typed draft is silently re-anchored by the next Add click',
    'lib/review-timestamp-feedback.ts',
    '  return !draft || draft.body.trim() === \'\';',
    '  return true;'],

  // ── cross-artifact identity ───────────────────────────────────────────────
  ['cross-artifact', 'same-second matching ignores which file is selected',
    'lib/review-timestamp-feedback.ts',
    '    if (i.artifactId !== artifactId) return false;',
    '    if (false) return false;'],
  ['cross-artifact', 'a stray event from another file moves this playhead',
    'lib/review-timestamp-feedback.ts',
    '  if (!eventArtifactId || eventArtifactId !== selectedArtifactId) return null;',
    '  if (!eventArtifactId) return null;'],
  ['cross-artifact', "another file's draft is offered as editable over this one",
    'lib/review-timestamp-feedback.ts',
    '  const elsewhere = !!issue.artifactId && issue.artifactId !== selectedArtifactId;',
    '  const elsewhere = false;'],
  ['artifact-switch', 'an in-progress composer survives a file switch', COMPONENT,
    '    setPlayheadMs(null);\n    setDraft(null);',
    '    setPlayheadMs(null);'],

  // ── edit-as-create ────────────────────────────────────────────────────────
  ['edit-as-create', 'the update appends a duplicate instead of replacing', COMPONENT,
    '          return replaceIssue(prev, editingId, updated);',
    '          return [...prev, updated];'],
  ['edit-as-create', 'replaceIssue appends when the target is absent',
    'lib/review-timestamp-feedback.ts',
    '  return found ? next : issues;',
    '  return found ? next : [...issues, updated];'],
  ['edit-as-create', 'an edit is routed to create_issue',
    'lib/review-timestamp-feedback.ts',
    "  return draft.editingIssueId\n    ? { action: 'update_issue', issueId: draft.editingIssueId }\n    : { action: 'create_issue' };",
    "  return { action: 'create_issue' };"],
  ['edit-as-create', 'editing loses the issue\'s own anchor and takes the playhead',
    'lib/review-timestamp-feedback.ts',
    '    anchorMs: isMedia ? Math.max(0, Math.round(Number(anchor.timeStartMs) || 0)) : null,',
    '    anchorMs: null,'],

  // ── ranges and immutability ───────────────────────────────────────────────
  ['range', 'an end exactly at the start is accepted as a range',
    'lib/review-timestamp-feedback.ts',
    '  if (endMs <= startMs) return \'The end of the range must come after the start.\';',
    '  if (endMs < startMs) return \'The end of the range must come after the start.\';'],
  ['range', 'a refused end is stored anyway',
    'lib/review-timestamp-feedback.ts',
    '  if (err) return { draft, error: err };',
    '  if (err) return { draft: { ...draft, rangeEndMs: Math.round(playheadMs as number) }, error: err };'],
  ['immutability', 'submitted and accepted work becomes editable',
    'lib/review-timestamp-feedback.ts',
    "  return !!issue && issue.status === 'draft';",
    '  return !!issue;'],
];

let killed = 0;
const survivors = [];
for (const [boundary, name, file, from, to] of mutations) {
  const dir = mkdtempSync(join(tmpdir(), 'implexa-review-timestamp-mutant-'));
  try {
    for (const source of files) {
      const target = join(dir, source); mkdirSync(dirname(target), { recursive: true });
      cpSync(join(root, source), target);
    }
    const target = join(dir, file);
    const source = readFileSync(target, 'utf8');
    // A mutation whose anchor text has drifted is not a passing mutation — it is a
    // mutation that never happened, and reporting it as killed would be the same lie
    // the whole harness exists to catch.
    if (!source.includes(from)) throw new Error(`Mutation anchor missing: [${boundary}] ${name}`);
    writeFileSync(target, source.replace(from, to));
    const result = spawnSync(process.execPath, ['--test', ...tests.map((t) => join(dir, t))], {
      cwd: dir, encoding: 'utf8', env: process.env,
    });
    if (result.status === 0) {
      survivors.push(`[${boundary}] ${name}`);
      console.log(`SURVIVED [${boundary}] ${name}`);
    } else {
      killed += 1;
      console.log(`KILLED [${boundary}] ${name}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const boundaries = new Set(mutations.map(([b]) => b)).size;
console.log(`\nMutation result: ${killed}/${mutations.length} killed across ${boundaries} boundaries.`);
if (survivors.length) {
  console.error(`\n✖ ${survivors.length} mutation(s) survived — the tests naming them are decorative:`);
  for (const s of survivors) console.error(`   ${s}`);
  process.exit(1);
}
