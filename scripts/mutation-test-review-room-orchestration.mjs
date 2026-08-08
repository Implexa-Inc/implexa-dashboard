#!/usr/bin/env node
/**
 * Mutation test for Review Room orchestration (#129) and the bounded rail (#130).
 *
 * A green suite proves nothing on its own — the surface that shipped both bugs had
 * tests too. Each mutation below RE-INTRODUCES a specific regression into a throwaway
 * copy of the tree. If the suite still passes, the test claiming to prevent that
 * regression is decorative and is reported as SURVIVED rather than quietly trusted.
 *
 * Boundaries covered:
 *   global-sort          issues ordered by timestamp across files, one shared clock
 *   filename-identity    grouping on the display name, so duplicate paths merge
 *   natural-order        Chapter10 sorting before Chapter2
 *   explicit-order       an artifact order the backend supplied being ignored
 *   stable-order         equal timestamps falling back to input (row) order
 *   internal-scrolling   the rail growing with issue count instead of scrolling
 *   sticky-actions       the submission footer being pushed off screen
 *   bounded-workspace    the workspace growing the page with every issue
 *   file-headers         a file group losing its heading or its count
 *   second-approval      the approval gate re-appearing over written feedback
 *   frozen-snapshot      the confirmed count drifting from the sent set
 *   duplicate-submission a click after a rendered success starting a second submission
 *   single-flight        a REAL double click — both handlers closing over the same
 *                        pre-render state — transmitting twice
 *   stuck-in-flight      any path that leaves the room on "Sending…" forever
 *   snapshot-honesty     the local freeze presented as though the server had bound it
 *   one-click            a click that promises to send and transmits nothing
 *   local-only-success   "queued" claimed without a durable continuation
 *   note-dropped         the revision note discarded, renamed, untrimmed, or sent
 *                        under a bound that has drifted from the backend's
 *   request-id-dropped   a success accepted without the continuation it must name
 *   issue-count-invented a count the server did not give, filled in locally
 *   credential-leak      a token, key or backend origin reaching the browser
 *   component-click      the real button disconnected from the real orchestration
 *
 * The wire contract is PINNED to
 * implexa-backend@b2b39b8d6858c60cb05f1e3c42f0781beb9add14. `review-submit-contract
 * .test.ts` re-reads the backend source at that SHA, so a mutation to our copy of the
 * field name or the bound is killed by disagreement with the server itself.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { announceBaseline, materializeTree, runSuites } from './mutation-harness-support.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

const COMPONENT = 'app/(dashboard)/_components/review-room.tsx';
const CHRONO = 'lib/review-chronology.ts';
const FLOW = 'lib/review-submission-flow.ts';
const ROOM = 'lib/review-room-state.ts';
const ACTIONS = 'lib/review-actions.ts';
const PROXY = 'app/api/review/route.ts';

const files = [
  CHRONO, 'lib/review-chronology.test.ts', 'lib/review-multi-file-fixture.ts',
  FLOW, 'lib/review-submission-flow.test.ts',
  ROOM, 'lib/review-room-state.test.ts',
  ACTIONS, 'lib/review-actions.test.ts',
  'lib/review-room-layout.test.ts',
  'lib/review-submit-contract.test.ts',
  'lib/review-room-credentials.test.ts',
  'lib/review-room-click.test.ts',
  'scripts/dom-test-loader.mjs', 'scripts/stubs/next-navigation.mjs',
  PROXY,
  COMPONENT,
];
const tests = [
  'lib/review-chronology.test.ts',
  'lib/review-submission-flow.test.ts',
  'lib/review-room-state.test.ts',
  'lib/review-room-layout.test.ts',
  'lib/review-actions.test.ts',
  'lib/review-submit-contract.test.ts',
  'lib/review-room-credentials.test.ts',
  // The rendered click test. Slower than the rest, and the only one that can kill a
  // mutation in the seam between the component and the helpers it calls.
  'lib/review-room-click.test.ts',
];

const mutations = [
  // ── the observed chronology bug ───────────────────────────────────────────
  ['global-sort', 'every issue falls into one bucket, sorted by a shared clock', CHRONO,
    "    const key = issue?.artifactId ? String(issue.artifactId) : WHOLE_RUN;",
    "    const key = WHOLE_RUN;"],
  ['global-sort', 'whole-run comments are interleaved with files instead of last', CHRONO,
    '  return wholeRun ? [...fileGroups, wholeRun] : fileGroups;',
    '  return wholeRun ? [wholeRun, ...fileGroups] : fileGroups;'],

  // ── identity ──────────────────────────────────────────────────────────────
  ['filename-identity', 'grouping keys on the display name, so duplicate paths merge', CHRONO,
    "    const key = issue?.artifactId ? String(issue.artifactId) : WHOLE_RUN;",
    "    const key = issue?.artifactId ? String(byId.get(String(issue.artifactId))?.relativePath ?? issue.artifactId) : WHOLE_RUN;"],
  ['filename-identity', 'issues about a file the packet lacks are silently dropped', CHRONO,
    '    const artifact = byId.get(key) ?? null;\n    fileGroups.push({',
    '    const artifact = byId.get(key) ?? null;\n    if (!artifact) continue;\n    fileGroups.push({'],

  // ── ordering ──────────────────────────────────────────────────────────────
  ['natural-order', 'digit runs compare as text, so Chapter10 precedes Chapter2', CHRONO,
    '      const av = Number(as);\n      const bv = Number(bs);\n      if (av !== bv) return av < bv ? -1 : 1;',
    '      if (as !== bs) return as < bs ? -1 : 1;'],
  ['explicit-order', 'an artifact order the backend supplied is ignored', CHRONO,
    "  const v = a?.ordinal;\n  return typeof v === 'number' && Number.isFinite(v) ? v : null;",
    '  return null;'],
  ['stable-order', 'equal timestamps fall back to database row order', CHRONO,
    '  return x.id < y.id ? -1 : x.id > y.id ? 1 : 0;',
    '  return 0;'],
  // NOTE: `const end = num(a.timeEndMs)` was tried here first and survived — with
  // Number(null) === 0 a point always lands below every range anyway, so that mutant
  // is EQUIVALENT rather than a missed test. This one inverts the rule for real.
  ['stable-order', 'a point comment sorts after ranges opening at the same instant', CHRONO,
    '    const end = a.timeEndMs === null || a.timeEndMs === undefined ? start : num(a.timeEndMs);',
    '    const end = a.timeEndMs === null || a.timeEndMs === undefined ? Number.MAX_SAFE_INTEGER : num(a.timeEndMs);'],

  // ── layout: the rail grows the page again ─────────────────────────────────
  ['bounded-workspace', 'the workspace is content-sized, so issues grow the page', COMPONENT,
    'lg:h-[calc(100vh-13rem)] lg:min-h-[34rem] ',
    ''],
  ['internal-scrolling', 'the issue list no longer scrolls inside the rail', COMPONENT,
    'className="min-h-0 flex-1 overflow-y-auto px-4 py-3"',
    'className="px-4 py-3"'],
  ['internal-scrolling', 'the rail refuses to shrink below its content', COMPONENT,
    '<aside className="flex max-h-[70vh] min-h-0 flex-col',
    '<aside className="flex max-h-[70vh] flex-col'],
  ['internal-scrolling', 'the rail header scrolls away with the list', COMPONENT,
    '<div className="shrink-0 border-b border-ink-800 px-4 py-3">',
    '<div className="border-b border-ink-800 px-4 py-3">'],
  ['sticky-actions', 'the submission footer is pushed off screen by a long list', COMPONENT,
    '<div className="sticky bottom-0 shrink-0 space-y-2 border-t border-ink-800 bg-ink-900 px-4 py-3">',
    '<div className="space-y-2 border-t border-ink-800 bg-ink-900 px-4 py-3">'],
  ['sticky-actions', 'the sticky footer becomes translucent and the list reads through it', COMPONENT,
    'sticky bottom-0 shrink-0 space-y-2 border-t border-ink-800 bg-ink-900 px-4 py-3',
    'sticky bottom-0 shrink-0 space-y-2 border-t border-ink-800 bg-ink-900/40 px-4 py-3'],

  // ── file headers ──────────────────────────────────────────────────────────
  ['file-headers', 'a file group stops printing its issue count', COMPONENT,
    '<span className="shrink-0 text-[11px] tabular-nums text-ink-500">{groupCountLabel(group.count)}</span>',
    ''],
  ['file-headers', 'file headings scroll away instead of sticking', COMPONENT,
    '<h3 className="sticky top-0 z-10 -mx-4 -mt-3 mb-2 flex',
    '<h3 className="z-10 -mx-4 -mt-3 mb-2 flex'],
  ['file-headers', 'the rail groups by something other than artifact identity', COMPONENT,
    "key={group.artifactId ?? 'whole-run'}",
    'key={group.displayName}'],

  // ── the second approval page ──────────────────────────────────────────────
  ['second-approval', 'the approval gate returns over written feedback', ROOM,
    '  if (isApprovalHold && draftCount === 0) {',
    '  if (isApprovalHold) {'],
  ['second-approval', 'the room offers the gate instead of its own primary action', COMPONENT,
    '          ) : acts.showApproveNextAction ? (',
    '          ) : (isApprovalHold || acts.showApproveNextAction) ? ('],

  // ── the frozen snapshot ───────────────────────────────────────────────────
  ['frozen-snapshot', 'the confirmed count follows live drafts instead of the snapshot', FLOW,
    '  const frozenCount = state.snapshot ? state.snapshot.issueCount : null;',
    '  const frozenCount = draftCount;'],
  ['frozen-snapshot', 'a second click re-freezes the snapshot under the reviewer', FLOW,
    "  if (state.phase !== 'draft' && state.phase !== 'error') return state;",
    '  if (false) return state;'],
  ['frozen-snapshot', 'the primary button stops naming the audited count', COMPONENT,
    '{submitView.primaryLabel}',
    '{acts.submitLabel}'],

  // ── stuck in flight ───────────────────────────────────────────────────────
  // Every mutation here is a way the room says "Sending…" forever.
  ['stuck-in-flight', 'a rejected request escapes the click instead of failing it', FLOW,
    '    let outcome: SubmitOutcome;\n    try {\n      outcome = await submit();\n    } catch {',
    '    let outcome: SubmitOutcome;\n    try {\n      outcome = await submit();\n    } catch (rethrown) {\n      throw rethrown;\n    } finally {'],
  ['stuck-in-flight', 'the outcome never reaches the caller', FLOW,
    '    onState(next);\n    return next;',
    '    return next;'],
  ['stuck-in-flight', 'the durable continuation from the response is discarded', FLOW,
    '        continuationId: outcome.requestId,',
    "        continuationId: '',"],
  ['stuck-in-flight', 'a settled submission is dragged back by a stale draft row', FLOW,
    "  if (local.phase === 'revision_queued') return local;",
    ''],
  ['stuck-in-flight', 'the orchestration is handed a state that hides what is in flight', COMPONENT,
    '      state: submission,',
    '      state: INITIAL_SUBMISSION_STATE,'],
  ['stuck-in-flight', 'a refusal is reported to the caller as a success', COMPONENT,
    '      if (!outcome.ok) {\n        setError(submitRefusalCopy(outcome));\n        return outcome;\n      }',
    '      if (!outcome.ok) {\n        setError(submitRefusalCopy(outcome));\n      }'],
  // REMOVED 2026-08-08 — 'a dead request reports no reason, so the room looks merely idle'.
  // It replaced the transport `setError(submitRefusalCopy(outcome))` with `setError(null)`
  // and expected the room to fall silent. It does not: the room renders
  // `{!error && submitView.errorLine}` (review-room.tsx:1164) precisely so exactly one
  // copy of the message shows, and with `error` cleared the flow's own
  // `failSubmission(sending, submitRefusalCopy(outcome))` supplies the identical string.
  // The DOM text is the same either way, so this described no regression — it survived
  // a green baseline for that reason, not for want of a test. Deleted rather than
  // propped up with an assertion about which of two elements holds the sentence.
  ['stuck-in-flight', 'a newer durable session is never adopted after a refresh', COMPONENT,
    '    setSession((current) => (!current || current.id === incoming.id ? incoming : current));',
    ''],

  // ── the snapshot is not a server contract ─────────────────────────────────
  ['snapshot-honesty', 'the queued copy repeats the local freeze over the server count', FLOW,
    '    const n = state.submittedCount ?? frozenCount ?? draftCount;',
    '    const n = frozenCount ?? draftCount;'],
  ['snapshot-honesty', 'a drift between the shown and submitted count is hidden', FLOW,
    '    const drifted = state.submittedCount !== null && frozenCount !== null && state.submittedCount !== frozenCount;',
    '    const drifted = false;'],
  ['snapshot-honesty', 'a malformed server count is trusted as authoritative', FLOW,
    '  const submittedCount = typeof n === \'number\' && Number.isInteger(n) && n >= 0 ? n : null;',
    '  const submittedCount = typeof n === \'number\' ? n : null;'],
  ['snapshot-honesty', 'issues stay editable while the server is snapshotting them', COMPONENT,
    '  const frozen = proxyPreview || submissionInFlight\n    || (!acts.canEditIssues',
    '  const frozen = proxyPreview\n    || (!acts.canEditIssues'],

  // ── one decisive click ────────────────────────────────────────────────────
  ['one-click', 'the first click transmits nothing and re-offers the same promise', FLOW,
    "      primaryLabel: submitting ? `Sending ${n} ${changeWord(n)}…` : `Preparing ${n} ${changeWord(n)}…`,\n      primaryEnabled: false,",
    "      primaryLabel: submitting ? `Sending ${n} ${changeWord(n)}…` : `Send ${n} ${changeWord(n)} & start revision`,\n      primaryEnabled: !submitting && !busy,"],
  ['one-click', 'Keep reviewing silently abandons a request already in flight', FLOW,
    "  if (state.phase !== 'error') return state;",
    "  if (state.phase !== 'error' && state.phase !== 'submitting') return state;"],

  // ── single flight ─────────────────────────────────────────────────────────
  // The phase guard alone does NOT stop a real double click: both handlers close over
  // the same pre-render state. Only the synchronous latch does.
  ['single-flight', 'the latch is gone, so two clicks in one tick both transmit', FLOW,
    '  if (flight.current) return state;\n  flight.current = true;',
    ''],
  ['single-flight', 'the latch is set only after the first await', FLOW,
    '  if (flight.current) return state;\n  flight.current = true;\n\n  try {',
    '  try {\n    flight.current = true;'],
  ['single-flight', 'the latch is never released, so a failed attempt cannot be retried', FLOW,
    '    flight.current = false;\n  }\n}',
    '  }\n}'],
  ['single-flight', 'each click gets its own latch, which guards nothing', COMPONENT,
    '      flight: submitFlightRef,',
    '      flight: { current: false },'],

  // ── duplicate submission ──────────────────────────────────────────────────
  ['duplicate-submission', 'submitting can be entered from any phase', FLOW,
    "  if (state.phase !== 'preparing') return state;\n  return { ...state, phase: 'submitting', error: null };",
    "  return { ...state, phase: 'submitting', error: null };"],
  ['duplicate-submission', 're-entry is allowed, so a click after success transmits again', FLOW,
    '    const prepared = beginPreparing(state, draftIssueIds);',
    "    const prepared = beginPreparing({ ...state, phase: 'draft' }, draftIssueIds);"],
  ['duplicate-submission', 'a queued session offers to send again', FLOW,
    "      primaryEnabled: false,\n      secondaryLabel: null,\n      secondaryEnabled: false,\n      showNote: false,\n      noteEnabled: false,\n      noteHint: null,\n      frozenCount,",
    "      primaryEnabled: true,\n      secondaryLabel: null,\n      secondaryEnabled: false,\n      showNote: false,\n      noteEnabled: false,\n      noteHint: null,\n      frozenCount,"],

  // ── local-only success ────────────────────────────────────────────────────
  ['local-only-success', 'queued is claimed without a durable continuation', FLOW,
    "  if (!id) return failSubmission(state, 'The revision was not confirmed. Nothing was sent.');",
    "  if (!id) return { ...state, phase: 'revision_queued', continuationId: null, error: null };"],
  ['local-only-success', 'a reload trusts local memory over the durable session row', FLOW,
    "  if (sessionState === 'submitted') {",
    "  if (false && sessionState === 'submitted') {"],
  ['local-only-success', 'the queued count is rebuilt from live drafts, not the durable ids', FLOW,
    '    const ids = Array.isArray(submittedIssueIds) ? submittedIssueIds.map(String).filter(Boolean) : [];',
    '    const ids = [];'],
  ['local-only-success', 'a failure discards the drafts it promised to preserve', FLOW,
    "    ...state,\n    phase: 'error',\n    continuationId: null,",
    "    ...state,\n    phase: 'error',\n    snapshot: null,\n    continuationId: null,"],

  // ── the pinned wire contract ──────────────────────────────────────────────
  // Field name, bound and trimming all read from implexa-backend@b2b39b8.
  ['note-dropped', 'the note is dropped from the request body entirely', ACTIONS,
    '        body: { revisionNote: note.length ? note : null },',
    '        body: {},'],
  ['note-dropped', 'the note travels under a field the backend does not read', ACTIONS,
    '        body: { revisionNote: note.length ? note : null },',
    '        body: { note: note.length ? note : null },'],
  ['note-dropped', 'the note is sent untrimmed, so stored and shown text differ', ACTIONS,
    "      const note = typeof raw === 'string' ? raw.trim() : '';",
    "      const note = typeof raw === 'string' ? raw : '';"],
  ['note-dropped', 'the client bound drifts above the backend bound', ACTIONS,
    'export const REVISION_NOTE_MAX = 2000;',
    'export const REVISION_NOTE_MAX = 4000;'],
  ['note-dropped', 'an over-long note is forwarded instead of refused', ACTIONS,
    '      if (note.length > REVISION_NOTE_MAX) {',
    '      if (false) {'],
  ['note-dropped', 'the composer text never reaches the request', COMPONENT,
    '        revisionNote,',
    "        revisionNote: '',"],
  ['note-dropped', 'onSubmit closes over the note as it was at mount', COMPONENT,
    '  }, [session, router, revisionNote]);',
    '  }, [session, router]);'],

  // ── the server's answer is the answer ─────────────────────────────────────
  ['request-id-dropped', 'a success with no continuation id is accepted', FLOW,
    "  const requestId = trimmed(b.requestId);\n  if (!requestId) {",
    '  const requestId = trimmed(b.requestId) || \'assumed\';\n  if (!requestId) {'],
  ['request-id-dropped', 'the parsed continuation id never reaches the state', COMPONENT,
    '      const outcome = parseSubmitResponse(body, { unavailable: status >= 500 });',
    '      const outcome = parseSubmitResponse({ ...body, requestId: undefined }, { unavailable: status >= 500 });'],
  ['issue-count-invented', 'a missing server count is filled in from nothing', FLOW,
    '  if (issueCount === null) {',
    '  if (false) {'],
  ['issue-count-invented', 'the idempotent fallback reads something other than the server ids', FLOW,
    '    ? submittedIds.length',
    '    ? 0'],
  ['issue-count-invented', 'a fractional or negative count is trusted', FLOW,
    "const isIntCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;",
    "const isIntCount = (v: unknown): v is number => typeof v === 'number';"],
  ['issue-count-invented', 'a refusal is read as a success', FLOW,
    '  if (b.ok !== true) {',
    '  if (false) {'],

  // ── credential boundary ───────────────────────────────────────────────────
  ['credential-leak', 'the proxy forwards a caller-supplied path', PROXY,
    '  const target = resolveReviewAction(action, body);',
    '  const target = (body.path ? { path: String(body.path), method: \'POST\', body: {} } : resolveReviewAction(action, body));'],
  ['credential-leak', 'the browser is handed the backend origin', COMPONENT,
    "  const res = await fetch('/api/review', {",
    "  const res = await fetch('https://core.implexa.ai/api/review', {"],

  // ── the rendered click ────────────────────────────────────────────────────
  ['component-click', 'the click handler is disconnected from the button', COMPONENT,
    '                onClick={onPrimary}',
    '                onClick={() => {}}'],
  ['component-click', 'the primary action never reaches the orchestration', COMPONENT,
    '    await submitRevision({',
    '    if (true) return;\n    await submitRevision({'],
  ['component-click', 'the queued state hides the server identity it was given', COMPONENT,
    '                    {submitView.continuationId}',
    "                    {''}"],

  // ── the revision note ─────────────────────────────────────────────────────
  ['note-dropped', 'the composer disappears from the send path', FLOW,
    "    secondaryLabel: 'Keep reviewing',\n    secondaryEnabled: true,\n    showNote: true,",
    "    secondaryLabel: 'Keep reviewing',\n    secondaryEnabled: true,\n    showNote: false,"],
  ['note-dropped', 'the composer does not survive a failure', FLOW,
    "  const errorLine = state.phase === 'error' ? state.error : null;",
    "  const errorLine = state.phase === 'error' ? state.error : null;\n  if (state.phase === 'error') return { mode: 'send_changes', primaryLabel: `Send ${draftCount} ${changeWord(draftCount)} & start revision`, primaryEnabled: !busy, secondaryLabel: 'Keep reviewing', secondaryEnabled: true, showNote: false, noteEnabled: false, noteHint: null, frozenCount: null, statusLine: null, errorLine, continuationId: null, resubmissionDisabled: false };"],
  ['note-dropped', 'the composer is silently disabled against a backend that accepts it', COMPONENT,
    '  const NOTE_ENABLED = true;',
    '  const NOTE_ENABLED = false;'],
  ['note-dropped', 'the composer is typable regardless of the contract', COMPONENT,
    'disabled={!submitView.noteEnabled}',
    'disabled={false}'],
  ['note-dropped', 'the counter measures untrimmed text, disagreeing with the server', COMPONENT,
    '${revisionNote.trim().length}/${REVISION_NOTE_MAX}',
    '${revisionNote.length}/${REVISION_NOTE_MAX}'],
  ['note-dropped', 'the composer stops saying the note supplements the issues', COMPONENT,
    "placeholder=\"Optional. Adds context to the issues above — it doesn't replace them.\"",
    'placeholder="Optional."'],
];

// THE SUITE MUST PASS BEFORE IT MAY JUDGE. Until 2026-08-08 the rendered click test
// could not resolve `jsdom` from a tree under $TMPDIR, so it threw on import, the run
// exited non-zero, and all 71 mutants were scored KILLED without a single rendered
// assertion executing. A non-zero baseline is HARNESS BROKEN and aborts here.
announceBaseline({
  label: 'review-room-orchestration',
  root,
  files,
  dir: mkdtempSync(join(tmpdir(), 'implexa-review-orchestration-baseline-')),
  suites: tests,
});

let killed = 0;
const survivors = [];
for (const [boundary, name, file, from, to] of mutations) {
  const dir = mkdtempSync(join(tmpdir(), 'implexa-review-orchestration-mutant-'));
  try {
    materializeTree(root, files, dir);
    const target = join(dir, file);
    const source = readFileSync(target, 'utf8');
    // A mutation whose anchor text has drifted is not a passing mutation — it is a
    // mutation that never happened, and reporting it as killed would be the same lie
    // the whole harness exists to catch.
    if (!source.includes(from)) throw new Error(`Mutation anchor missing: [${boundary}] ${name}`);
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
console.log('\nNOT COVERED, and stated rather than implied:');
console.log('  A LIVE round trip. The contract is pinned three ways — fixtures recorded from');
console.log('  b2b39b8, a parity test that re-reads the backend source at that SHA, and a rendered');
console.log('  click composed through the real allowlist — but nothing here POSTs to a running');
console.log('  backend and reads the stored note back. That is the recovery acceptance in');
console.log('  docs/review-room-draft-recovery.md, and it has not been run.');
if (survivors.length) {
  console.error(`\n✖ ${survivors.length} mutation(s) survived — the tests naming them are decorative:`);
  for (const s of survivors) console.error(`   ${s}`);
  process.exit(1);
}
