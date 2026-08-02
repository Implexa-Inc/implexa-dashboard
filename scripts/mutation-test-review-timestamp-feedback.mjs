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
 *   frozen-file      a draft's FILE (id, digest, path, role) re-derived from the selector
 *   cross-artifact   feedback from one file matched or moved by another
 *   edit-as-create   an update that appends instead of replacing
 *   range            an end at or before the start being accepted, or a start that drifts
 *   discoverability  the range stopping being a visible, standalone choice
 *   guidance         source-file guidance disappearing, or being shown indiscriminately
 *   immutability     submitted/accepted/dismissed work becoming editable
 *   artifact-switch  a composer, playhead or half-made range surviving a file switch
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
    'pointCommentLabel({ playheadMs, existingCount: hereIssues.length })',
    'pointCommentLabel({ playheadMs: draft?.anchorMs ?? null, existingCount: hereIssues.length })'],
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
  ['frozen-anchor', 'a typed draft is silently re-anchored by the next Add click',
    'lib/review-timestamp-feedback.ts',
    '  return !draft || draft.body.trim() === \'\';',
    '  return true;'],

  // ── the frozen FILE ───────────────────────────────────────────────────────
  ['frozen-file', "the anchor digest is read from the selected artifact, not the draft", COMPONENT,
    '    const sha = d?.target.sha256;',
    '    const sha = artifact?.sha256;'],
  ['frozen-file', 'the issue is recorded against the selected file, not the frozen one', COMPONENT,
    "        action: 'create_issue', sessionId: sid, artifactId: d!.target.artifactId,",
    "        action: 'create_issue', sessionId: sid, artifactId: artifact?.id,"],
  ['frozen-file', 'the draft aliases the live target instead of copying it',
    'lib/review-timestamp-feedback.ts',
    '    target: { ...args.target },',
    '    target: args.target,'],
  ['frozen-file', 'an edit may be opened against a file the issue is not about',
    'lib/review-timestamp-feedback.ts',
    '  if ((issue.artifactId ?? null) !== (target.artifactId ?? null)) return null;',
    '  if (false) return null;'],
  ['frozen-file', 'the composer names the selected file rather than the frozen one', COMPONENT,
    '              {targetLine(draft.target)}',
    '              {targetLine(targetIdentity)}'],

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
  ['artifact-switch', 'an unfinished range survives a file switch', COMPONENT,
    '    setPendingRange(null);\n    setRangeError(null);\n\n    const base = decidePreview({',
    '    setRangeError(null);\n\n    const base = decidePreview({'],
  ['artifact-switch', 'a range no longer has to belong to the selected file',
    'lib/review-timestamp-feedback.ts',
    '  return !!range && range.target.artifactId === selectedArtifactId;',
    '  return !!range;'],

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

  // ── ranges ────────────────────────────────────────────────────────────────
  ['range', 'an end exactly at the start is accepted as a range',
    'lib/review-timestamp-feedback.ts',
    '  if (endMs <= startMs) return \'The end of the range must come after the start.\';',
    '  if (endMs < startMs) return \'The end of the range must come after the start.\';'],
  ['range', 'a refused end still hands back a draft to store',
    'lib/review-timestamp-feedback.ts',
    '  if (err) return { draft: null, error: err };',
    '  if (err) return { draft: { target: range.target, anchorMs: range.startMs, rangeEndMs: Math.round(Number(playheadMs)), selection: null, kind: DEFAULT_ISSUE_KIND, body: \'\', editingIssueId: null }, error: err };'],
  ['range', 'the range start follows the playhead instead of staying frozen',
    'lib/review-timestamp-feedback.ts',
    '      anchorMs: range.startMs,',
    '      anchorMs: Math.max(0, Math.round(playheadMs as number)) - 1,'],
  ['range', 'the end button stops following the playhead', COMPONENT,
    '              {rangeEndButtonLabel(playheadMs)}',
    '              {rangeEndButtonLabel(pendingRange.startMs)}'],

  // ── discoverability ───────────────────────────────────────────────────────
  ['discoverability', 'the range choice is hidden behind an open point comment', COMPONENT,
    '            {canOfferRange(playheadMs) && !pendingRange && (\n              <button\n                type="button"\n                onClick={startRange}',
    '            {false && canOfferRange(playheadMs) && !pendingRange && (\n              <button\n                type="button"\n                onClick={startRange}'],
  ['discoverability', 'the frozen start of a range is no longer shown', COMPONENT,
    '            <span className="font-mono text-sm text-sky-200">{rangeStartLabel(pendingRange)}</span>',
    '            <span className="font-mono text-sm text-sky-200" />'],
  ['discoverability', 'a range cannot be cancelled once begun', COMPONENT,
    '              {CANCEL_RANGE_LABEL}',
    '              {/* removed */}'],

  // ── source guidance ───────────────────────────────────────────────────────
  ['guidance', 'source files stop warning that feedback edits them',
    'lib/review-timestamp-feedback.ts',
    "  return target?.role === 'source' ? SOURCE_FILE_GUIDANCE : null;",
    '  return null;'],
  ['guidance', 'every artifact gets the source warning',
    'lib/review-timestamp-feedback.ts',
    "  return target?.role === 'source' ? SOURCE_FILE_GUIDANCE : null;",
    '  return SOURCE_FILE_GUIDANCE;'],
  ['guidance', 'reference-only intent is inferred rather than written by the reviewer',
    'lib/review-timestamp-feedback.ts',
    '  if (draft.body.includes(REFERENCE_ONLY_SENTENCE)) return draft;',
    '  if (false) return draft;'],

  // ── immutability ──────────────────────────────────────────────────────────
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
