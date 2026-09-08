#!/usr/bin/env node
/**
 * Mutation test for the Training Review foundation (F0 items 5, 6 and 8).
 *
 * A green suite proves nothing on its own. Each mutation below RE-INTRODUCES one
 * specific way this foundation can silently break its own guarantees, into a throwaway
 * copy of the tree. If the suite still passes, the test claiming to prevent that
 * regression is decorative and is reported as SURVIVED rather than quietly trusted.
 *
 * Boundaries covered:
 *   authority-crossing  a training subject producing a run-review write
 *   subject-shape       a half-run/half-demonstration subject being accepted
 *   exhaustiveness      the default arm falling through to run review
 *   activation-guard    F0 asking for, or implying, an activation
 *   privacy-copy        the §2.4 promise reworded into something untrue
 *   lifecycle-collapse  the six §1.3 facts collapsing into one status
 *   inert-vs-active     an inert candidate rendering as an active learning
 *   insufficient-evidence  a weak proposal hidden, or accepted in one click
 *   evidence-binding    a merge dropping the source annotations it must carry
 *   unavailable         a failed read rendering as an empty record
 *   path-leak           a local filesystem path reaching the browser
 *
 * FULL-TREE COPY, node_modules symlinked. The rendered suites bundle the components
 * with esbuild from the mutant tree, so a partial file list would fail to build — and
 * a build failure scored as a kill is the exact lie `mutation-harness-support.mjs`
 * exists to prevent. The unmutated tree must run green before any mutant is judged.
 */

import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSuites } from './mutation-harness-support.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

const SUBJECT = 'lib/review-subject.ts';
const ACTIONS = 'lib/training-review-actions.ts';
const CLIENT = 'lib/training-review-client.ts';
const COPY = 'lib/training-review-copy.ts';
const LIFECYCLE = 'lib/training-review-lifecycle.ts';
const PROJECTION = 'lib/training-review-projection.ts';
const CARDS = 'lib/coach-decision-cards.ts';
const ADAPTER = 'app/(dashboard)/_components/review-subject-room.tsx';
const ROOM = 'app/(dashboard)/_components/training-review-room.tsx';
const CARD_UI = 'app/(dashboard)/_components/coach-decision-cards.tsx';
const PROJECTION_UI = 'app/(dashboard)/_components/training-authority-projection.tsx';

const tests = [
  'lib/review-subject.test.ts',
  'lib/training-review-actions.test.ts',
  'lib/training-review-client.test.ts',
  'lib/training-review-lifecycle.test.ts',
  'lib/training-review-projection.test.ts',
  'lib/coach-decision-cards.test.ts',
  'lib/training-review-copy.test.ts',
  'app/(dashboard)/_components/training-review-render.test.ts',
  'app/(dashboard)/_components/review-subject-adapter.test.ts',
];

const EXCLUDE = new Set(['node_modules', '.git', '.next', 'dist', '.vercel', '.claude']);

/**
 * RESOLVED, not assembled from `root`.
 *
 * This repository is often checked out as a git WORKTREE, which has no `node_modules`
 * of its own — Node walks up to the primary checkout's. `join(root, 'node_modules')`
 * would then be a dangling symlink in every mutant tree, jsdom/esbuild/typescript
 * would fail to import, and the harness would score that crash as a kill it never
 * earned. Resolving the package finds the directory that actually exists.
 */
const NODE_MODULES = resolve(
  createRequire(import.meta.url).resolve('typescript/package.json'), '..', '..',
);

function materialize(dir) {
  cpSync(root, dir, { recursive: true, filter: (src) => !EXCLUDE.has(basename(src)) });
  symlinkSync(NODE_MODULES, join(dir, 'node_modules'), 'junction');
}

const mutations = [
  // ── a training subject producing a run-review write ────────────────────────
  ['authority-crossing', 'the discriminant routes a demonstration to the run-review path', SUBJECT,
    "      return { authority: 'training_review', route: '/api/training-review', subject } as WritePathFor<S['kind']>;",
    "      return { authority: 'run_review', route: '/api/review', subject } as WritePathFor<S['kind']>;"],
  ['authority-crossing', 'sealing stops checking the action namespace', SUBJECT,
    '      if (!isTrainingReviewAction(action)) {',
    '      if (false) {'],
  ['authority-crossing', 'the training allowlist stops refusing run-review actions by name', ACTIONS,
    '  if ((RUN_REVIEW_ACTIONS as readonly string[]).includes(action)) {',
    '  if (false) {'],
  ['authority-crossing', 'the training base points at run review', ACTIONS,
    "export const TRAINING_BASE = '/api/v2/agents/training';",
    "export const TRAINING_BASE = '/api/v2/review';"],
  ['authority-crossing', 'the client posts a hand-built envelope instead of a sealed one', CLIENT,
    '  const envelope: TrainingReviewWrite = sealWrite(path, action, fields);',
    "  const envelope = { authority: 'training_review', route: '/api/review', action, payload: fields } as TrainingReviewWrite;"],

  // ── the subject shape itself ───────────────────────────────────────────────
  ['subject-shape', 'a half-run/half-demonstration subject is accepted', SUBJECT,
    "      if (keys !== 'kind|sourceId|trainingSessionId') return null;",
    '      if (false) return null;'],
  ['subject-shape', 'both rooms describe their subject with the same sentence', SUBJECT,
    "    case 'training_source': return 'Reviewing work you demonstrated';",
    "    case 'training_source': return 'Reviewing a result this agent produced';"],

  // ── exhaustiveness ─────────────────────────────────────────────────────────
  ['exhaustiveness', 'the default arm falls through to the run-review room', ADAPTER,
    "      return assertNever(props, 'ReviewSubjectRoom');",
    '      return <ReviewRoom {...((props as unknown) as ReviewRoomProps)} />;'],

  // ── nothing in F0 activates ────────────────────────────────────────────────
  ['activation-guard', 'the confirm body lets a caller ask for activation', ACTIONS,
    '          activate: false,',
    '          activate: b.activate === true,'],
  ['activation-guard', 'a card action is relabelled as an activation', CARD_UI,
    '                  Accept\n',
    '                  Activate\n'],

  // ── §2.4 privacy copy ──────────────────────────────────────────────────────
  ['privacy-copy', 'the §2.4 promise is reworded into an untrue, stronger claim', COPY,
    "  'The full recording stays on this Mac. Only the moments you select, their transcript, '\n  + 'and the evidence needed to verify the teaching are saved to your private Agent history.';",
    "  'Nothing you record ever leaves this Mac.';"],
  ['privacy-copy', 'the qualifier that keeps the promise honest is dropped from the room', ROOM,
    '      <p className="mt-1.5 text-[13px] text-ink-400">{PRIVACY_QUALIFIER}</p>\n',
    ''],
  ['privacy-copy', 'the custody line claims nothing is uploaded, full stop', COPY,
    "export const NO_RECORDING_UPLOAD_NOTICE =\n  'Implexa has not uploaded any recording.';",
    "export const NO_RECORDING_UPLOAD_NOTICE =\n  'Nothing is uploaded.';"],

  // ── §1.3: six facts, never one status ──────────────────────────────────────
  ['lifecycle-collapse', 'two facts share a label', LIFECYCLE,
    "    label: 'Accepted by you',",
    "    label: 'Verified by checks',"],
  ['lifecycle-collapse', 'an unread fact is worded as a NO', LIFECYCLE,
    "    case 'unknown': return FACT_UNKNOWN_SENTENCE;",
    "    case 'unknown': return COPY[fact.key].no;"],
  ['lifecycle-collapse', 'an unread fact is TONED as a NO', LIFECYCLE,
    "    case 'unknown': return 'unread';",
    "    case 'unknown': return 'not-yet';"],
  ['lifecycle-collapse', 'a missing fact defaults to NO instead of unknown', LIFECYCLE,
    "    return { key, status: 'unknown', at: null, detail: null };",
    "    return { key, status: 'no', at: null, detail: null };"],
  ['lifecycle-collapse', 'the projection renders only the first fact', PROJECTION_UI,
    '      {LIFECYCLE_FACT_KEYS.map((key) => {',
    '      {LIFECYCLE_FACT_KEYS.slice(0, 1).map((key) => {'],
  ['lifecycle-collapse', 'a per-row status attribute stops being emitted', PROJECTION_UI,
    'data-fact={key} data-fact-status={fact.status}',
    'data-fact={key} data-fact-status="yes"'],

  // ── inert candidate vs active learning ─────────────────────────────────────
  ['inert-vs-active', 'acceptance is read as activation', LIFECYCLE,
    '  switch (state.activated.status) {',
    '  switch (state.accepted.status) {'],
  ['inert-vs-active', 'the panel shows the active heading for an inert candidate', PROJECTION_UI,
    '        {active ? ACTIVE_LEARNING_HEADING : INERT_CANDIDATE_HEADING}',
    '        {ACTIVE_LEARNING_HEADING}'],
  ['inert-vs-active', 'the stance stops being declared on the panel', PROJECTION_UI,
    '      data-stance={stance}\n    >',
    '      data-stance="active_learning"\n    >'],

  // ── §3.4 insufficient_evidence ─────────────────────────────────────────────
  ['insufficient-evidence', 'a weak proposal can be accepted in one click', CARDS,
    '  if (card.insufficientEvidence) {',
    '  if (false) {'],
  ['insufficient-evidence', 'a scope-only edit launders the missing evidence away', CARDS,
    '      insufficientEvidence: c.insufficientEvidence && !supplied,',
    '      insufficientEvidence: false,'],
  ['insufficient-evidence', 'the weak proposal is hidden from the Coach', CARD_UI,
    '      {cards.map((card) => {',
    '      {cards.filter((card) => !card.insufficientEvidence).map((card) => {'],
  ['insufficient-evidence', 'the Accept button is enabled with no explanation', CARD_UI,
    '                  disabled={!!blocked || busy === card.id}',
    '                  disabled={busy === card.id}'],
  ['insufficient-evidence', 'the refusal reason disappears from the card', CARD_UI,
    '                {blocked && <span className="text-[12px] text-amber-300">{blocked}</span>}\n',
    ''],

  // ── §3.4 evidence binding ──────────────────────────────────────────────────
  ['evidence-binding', 'a merge drops the source annotations it must carry', CARDS,
    '          annotationIds: union(c.evidence.annotationIds, card.evidence.annotationIds),',
    '          annotationIds: c.evidence.annotationIds,'],
  ['evidence-binding', 'a merge hides that it absorbed an unjustified claim', CARDS,
    '        insufficientEvidence: c.insufficientEvidence || card.insufficientEvidence,',
    '        insufficientEvidence: c.insufficientEvidence,'],

  // ── unavailable is not empty ───────────────────────────────────────────────
  ['unavailable', 'a refused read degrades to a calm empty record', PROJECTION,
    "    return { live: false, reason: typeof body.error === 'string' && body.error.trim() ? body.error.trim() : 'refused' };",
    '    return { live: true, projection: { source: null, evidence: [], decisions: [], authorityState: unknownAuthorityState(), submission: null, contractSkew: null } };'],
  ['unavailable', 'custody defaults to "already uploaded" for a record we could not read', PROJECTION,
    "    custody: value.custody === 'evidence_selected' ? 'evidence_selected' : 'local_only',",
    "    custody: value.custody === 'local_only' ? 'local_only' : 'evidence_selected',"],

  // ── no path reaches the browser ────────────────────────────────────────────
  ['path-leak', 'a leaked local path is rendered as a machine label', PROJECTION,
    '  const value = str(v);\n  return value && !looksLikePath(value) ? value : null;',
    '  return str(v);'],
];

// ── Baseline ──────────────────────────────────────────────────────────────────────

const label = 'training-review';
{
  const dir = mkdtempSync(join(tmpdir(), 'implexa-training-review-baseline-'));
  try {
    materialize(dir);
    const result = runSuites(root, dir, tests);
    if (result.status !== 0) {
      process.stderr.write(result.stdout.slice(-8000));
      process.stderr.write(result.stderr.slice(-3000));
      throw new Error(
        `HARNESS BROKEN [${label}]: the UNMUTATED suite exits ${result.status}. Nothing below `
        + 'this line would have been a real kill — every mutant would have "died" of the same '
        + 'failure. Fix the tree, then re-run.',
      );
    }
    const tests_ = result.stdout.match(/^ℹ tests (\d+)$/m) || result.stdout.match(/^# tests (\d+)$/m);
    const pass = result.stdout.match(/^ℹ pass (\d+)$/m) || result.stdout.match(/^# pass (\d+)$/m);
    console.log(`BASELINE [${label}] unmutated suite green — ${pass?.[1]}/${tests_?.[1]} tests pass.\n`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

let killed = 0;
const survivors = [];
for (const [boundary, name, file, from, to] of mutations) {
  const dir = mkdtempSync(join(tmpdir(), 'implexa-training-review-mutant-'));
  try {
    materialize(dir);
    const target = join(dir, file);
    const source = readFileSync(target, 'utf8');
    // A mutation whose anchor text has drifted is not a passing mutation — it is a
    // mutation that never happened, and reporting it as killed would be the same lie
    // the whole harness exists to catch.
    if (!source.includes(from)) throw new Error(`Mutation anchor missing: [${boundary}] ${name} (${file})`);
    writeFileSync(target, source.replace(from, to));
    const result = runSuites(root, dir, tests);
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
