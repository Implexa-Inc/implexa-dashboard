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
 *   wire-conformance    the emitted request drifting off the backend's contract
 *   activation-guard    F0 asking for, or implying, an activation
 *   mint-deferred       a confirmed teaching rendering as though it were a learning
 *   privacy-copy        the §2.4 promise reworded into something untrue
 *   lifecycle-collapse  the six §1.3 facts collapsing into one status
 *   inert-vs-active     an inert candidate rendering as an active learning
 *   insufficient-evidence  a weak proposal hidden, or confirmed in one click
 *   evidence-consent    an unconsented excerpt rendering as one the Coach kept
 *   stale-recording     a recording that changed under the review going unannounced
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
const REFUSALS = 'lib/training-review-refusals.ts';
const ADAPTER = 'app/(dashboard)/_components/review-subject-room.tsx';
const ROOM = 'app/(dashboard)/_components/training-review-room.tsx';
const CARD_UI = 'app/(dashboard)/_components/coach-decision-cards.tsx';
const PROJECTION_UI = 'app/(dashboard)/_components/training-authority-projection.tsx';

const tests = [
  'lib/review-subject.test.ts',
  'lib/training-review-actions.test.ts',
  'lib/training-review-client.test.ts',
  'lib/training-review-contract.test.ts',
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
  ['authority-crossing', 'the coach base points at run review', ACTIONS,
    "export const COACH_BASE = '/api/v2/agent-coach';",
    "export const COACH_BASE = '/api/v2/review';"],
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
  ['subject-shape', 'a projection subject naming another session is accepted anyway', PROJECTION,
    '  if (session !== trainingSessionId) return null;',
    '  if (false) return null;'],

  // ── exhaustiveness ─────────────────────────────────────────────────────────
  ['exhaustiveness', 'the default arm falls through to the run-review room', ADAPTER,
    "      return assertNever(props, 'ReviewSubjectRoom');",
    '      return <ReviewRoom {...((props as unknown) as ReviewRoomProps)} />;'],

  // ── the emitted request must BE the backend's contract ─────────────────────
  ['wire-conformance', 'one emitted route drifts off the backend path', ACTIONS,
    "        path: `${COACH_BASE}/reviews/${reviewSessionId}/annotations`, method: 'POST',",
    "        path: `${COACH_BASE}/reviews/${reviewSessionId}/moments`, method: 'POST',"],
  ['wire-conformance', 'creating a review stops requiring an idempotency key', ACTIONS,
    '      if (key.length < IDEMPOTENCY_KEY_MIN) {',
    '      if (false) {'],
  ['wire-conformance', 'the Idempotency-Key header stops being sent', ACTIONS,
    '        headers: { [IDEMPOTENCY_HEADER]: key },\n',
    ''],
  ['wire-conformance', "createReview sends the envelope key instead of the server's `sessionId`", ACTIONS,
    '        body: { sessionId, sourceId },',
    '        body: { trainingSessionId: sessionId, sourceId },'],
  ['wire-conformance', 'a server-derived field is forwarded instead of refused', ACTIONS,
    '  for (const field of [...DERIVED_FIELDS, ...extra]) {',
    '  for (const field of []) {'],
  ['wire-conformance', 'the refusal vocabulary is quietly trimmed', REFUSALS,
    "  'derived_field_supplied',\n] as const;",
    '] as const;'],
  ['wire-conformance', 'a typed unavailable reason is read as a plain refusal', CLIENT,
    '  const unavailable = response.status >= 500 || body.unavailable === true || isUnavailableReason(body.reason);',
    '  const unavailable = response.status >= 500;'],
  ['wire-conformance', 'the projection is read from the wrong envelope key', PROJECTION,
    '  const rawReview = body.review;',
    '  const rawReview = body.projection;'],

  // ── nothing in F0 activates ────────────────────────────────────────────────
  ['activation-guard', "the decision vocabulary stops being pinned to the server's two values", ACTIONS,
    '      if (!(PROPOSAL_DECISIONS as readonly unknown[]).includes(decision)) {',
    '      if (false) {'],
  ['activation-guard', 'a decision is sent without the digest of the card shown', ACTIONS,
    "      if (!expectedProposalDigest) return 'Confirm the card you were shown: its digest is required.';",
    "      if (!expectedProposalDigest && false) return 'Confirm the card you were shown: its digest is required.';"],
  ['activation-guard', 'the room confirms against a digest it made up', ROOM,
    '      expectedProposalDigest: card.proposalDigest,',
    "      expectedProposalDigest: 'a'.repeat(64),"],
  ['activation-guard', 'a card action is relabelled as an activation', CARD_UI,
    '                  Confirm\n',
    '                  Activate\n'],
  ['activation-guard', 'a card claiming to be ACTIVE is rendered instead of dropped', CARDS,
    "  if (influenceState !== 'inert') return null;",
    '  if (false) return null;'],

  // ── mint_deferred: confirmed is NOT a learning ─────────────────────────────
  ['mint-deferred', 'a deferred mint is described as an activation to come', CARDS,
    "  confirmed_not_a_learning:\n    'Confirmed, not yet a learning. It changes nothing until a revision carries it out and a '\n    + 'verified result is accepted.',",
    "  confirmed_not_a_learning: 'Confirmed. It will be activated for future runs.',"],
  ['mint-deferred', 'a deferred mint is scored as a linked candidate', CARDS,
    "  return card.canonicalLinkState === 'linked_existing'\n    ? 'confirmed_linked_inert' : 'confirmed_not_a_learning';",
    "  return 'confirmed_linked_inert';"],
  ['mint-deferred', 'the standing sentence disappears from the card', CARD_UI,
    '            <p className="mt-1.5 text-[12px] text-ink-400" data-standing-sentence={standing}>\n              {standingSentence(card)}\n            </p>\n',
    ''],
  ['mint-deferred', 'the standing stops being declared on the card', CARD_UI,
    '            data-learning-standing={standing}\n',
    '            data-learning-standing="confirmed_linked_inert"\n'],
  ['mint-deferred', 'the ACCEPTED fact is moved by confirming a teaching', LIFECYCLE,
    "    accepted: fact('accepted', 'unknown', NOT_CARRIED_HERE.accepted ?? null),",
    "    accepted: fact('accepted', (input.decisions || []).some((d) => d && d.status === 'confirmed') ? 'yes' : 'unknown'),"],

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
    "    case 'unknown': return fact.detail ?? FACT_UNKNOWN_SENTENCE;",
    "    case 'unknown': return COPY[fact.key].no;"],
  ['lifecycle-collapse', 'a fact this stage does not carry is worded as its NO', LIFECYCLE,
    "  implemented: 'No revision has been made from this teaching yet, so there is nothing to report.',",
    "  implemented: 'No revision has carried this out yet.',"],
  ['lifecycle-collapse', 'an unread fact is TONED as a NO', LIFECYCLE,
    "    case 'unknown': return 'unread';",
    "    case 'unknown': return 'not-yet';"],
  ['lifecycle-collapse', 'a missing fact defaults to NO instead of unknown', LIFECYCLE,
    "    return { key, status: 'unknown', at: null, detail: null };",
    "    return { key, status: 'no', at: null, detail: null };"],
  ['lifecycle-collapse', 'an unreadable learning block defaults to "not activated"', LIFECYCLE,
    "    activated = fact('activated', 'unknown');",
    "    activated = fact('activated', 'no');"],
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
  ['inert-vs-active', 'a learning count the server never sent is invented', PROJECTION,
    '  if (activatedCount === null || versionsCreated === null) return null;',
    '  if (false) return null;'],

  // ── §3.4 insufficient_evidence ─────────────────────────────────────────────
  ['insufficient-evidence', 'a weak proposal can be confirmed in one click', CARDS,
    '  if (isInsufficientEvidence(card)) {',
    '  if (false) {'],
  ['insufficient-evidence', 'a card with no cited moment becomes confirmable', CARDS,
    '  if (!card.sourceAnnotationIds.length) {',
    '  if (false) {'],
  ['insufficient-evidence', 'the weak proposal is hidden from the Coach', CARD_UI,
    '      {cards.map((card) => {',
    '      {cards.filter((card) => !isInsufficientEvidence(card)).map((card) => {'],
  ['insufficient-evidence', 'the Confirm button is enabled with no explanation', CARD_UI,
    '                  disabled={!!blocked || busy === card.proposalId}',
    '                  disabled={busy === card.proposalId}'],
  ['insufficient-evidence', 'the refusal reason disappears from the card', CARD_UI,
    '                {blocked && <span className="text-[12px] text-amber-300">{blocked}</span>}\n',
    ''],

  // ── consent is a receipt, not a boolean ────────────────────────────────────
  ['evidence-consent', 'an excerpt with no consent receipt renders as one the Coach kept', PROJECTION,
    '    if (!consentReceiptDigest) continue;',
    '    if (false) continue;'],
  ['evidence-consent', 'evidence is sent without the consent receipt for that excerpt', ACTIONS,
    "      if (!consentReceiptDigest) return 'Keeping an excerpt needs your recorded consent for that exact excerpt.';",
    "      if (!consentReceiptDigest && false) return 'Keeping an excerpt needs your recorded consent for that exact excerpt.';"],

  // ── the recording changed under the review ─────────────────────────────────
  ['stale-recording', 'a stale recording is no longer announced', PROJECTION_UI,
    "      {source?.integrity === 'stale' && (",
    '      {false && ('],
  ['stale-recording', 'a superseded moment is reported as still live', PROJECTION,
    '      live: value.live === true,',
    '      live: true,'],

  // ── unavailable is not empty ───────────────────────────────────────────────
  ['unavailable', 'a refused read degrades to a calm empty record', PROJECTION,
    '    return { live: false, reason, unavailable: body.unavailable === true };',
    "    return { live: true, review: { projectionVersion: null, contractVersion: null, reviewSessionId: '', trainingSessionId: '', subject: null, status: 'open', statusReason: null, terminal: false, source: null, annotations: [], liveAnnotationCount: 0, submission: null, decisions: [], learning: null, permittedActions: [], authorityState: deriveAuthorityState({ source: null, learning: null }), contractSkew: null } };"],
  ['unavailable', 'custody defaults to "already uploaded" for a record we could not read', PROJECTION,
    "      custodyState: str(value.custodyState) ?? 'local_only',",
    "      custodyState: str(value.custodyState) ?? 'uploaded',"],
  ['unavailable', 'a terminal review is reported as still open', PROJECTION,
    '      terminal: review.terminal === true,',
    '      terminal: false,'],
  ['unavailable', 'an action the server never permitted is offered anyway', PROJECTION,
    "    if (typeof entry === 'string' && PERMITTED.has(entry) && !out.includes(entry as PermittedAction)) {",
    "    if (typeof entry === 'string') {"],

  // ── no path reaches the browser ────────────────────────────────────────────
  ['path-leak', 'a leaked local path is rendered instead of dropped', PROJECTION,
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
