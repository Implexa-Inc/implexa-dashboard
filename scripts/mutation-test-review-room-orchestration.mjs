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
 *   duplicate-submission a double click or retry starting a second submission
 *   local-only-success   "queued" claimed without a durable continuation
 *   note-dropped         the revision note silently discarded, or collected with
 *                        nowhere to go
 *
 * NOT COVERED YET, and deliberately not faked: the END-TO-END note-dropped mutant —
 * a note that reaches the backend and is not persisted byte-identically. That mutant
 * needs Backend #160's field name, bounds, trimming and digest rules. Until it is
 * pinned, the note is not collected at all (NOTE_ENABLED = false) and the mutations
 * below prove exactly that: the composer cannot be enabled, and no note field can be
 * added to the wire, without a test failing.
 */

import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

const COMPONENT = 'app/(dashboard)/_components/review-room.tsx';
const CHRONO = 'lib/review-chronology.ts';
const FLOW = 'lib/review-submission-flow.ts';
const ROOM = 'lib/review-room-state.ts';
const ACTIONS = 'lib/review-actions.ts';

const files = [
  CHRONO, 'lib/review-chronology.test.ts', 'lib/review-multi-file-fixture.ts',
  FLOW, 'lib/review-submission-flow.test.ts',
  ROOM, 'lib/review-room-state.test.ts',
  ACTIONS, 'lib/review-room-layout.test.ts',
  COMPONENT,
];
const tests = [
  'lib/review-chronology.test.ts',
  'lib/review-submission-flow.test.ts',
  'lib/review-room-state.test.ts',
  'lib/review-room-layout.test.ts',
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
    '  } catch {\n    // The request never completed. Without this the rejection escapes the click\n    // handler entirely and `sending` is the last state the room ever sees.\n    outcome = { ok: false };\n  }',
    '  }'],
  ['stuck-in-flight', 'the outcome never reaches the caller', FLOW,
    '  onState(next);\n  return next;',
    '  return next;'],
  ['stuck-in-flight', 'the durable continuation from the response is discarded', FLOW,
    '    ? settleQueued(sending, { continuationId: outcome.requestId, issueCount: outcome.issueCount ?? null })',
    "    ? settleQueued(sending, { continuationId: '', issueCount: outcome.issueCount ?? null })"],
  ['stuck-in-flight', 'a settled submission is dragged back by a stale draft row', FLOW,
    "  if (local.phase === 'revision_queued') return local;",
    ''],
  ['stuck-in-flight', 'the orchestration is handed a state that hides what is in flight', COMPONENT,
    '      state: submission,',
    '      state: INITIAL_SUBMISSION_STATE,'],
  ['stuck-in-flight', 'the response’s continuation id is ignored', COMPONENT,
    '      const requestId = typeof body.requestId === \'string\' ? body.requestId.trim() : \'\';',
    "      const requestId = 'assumed';"],
  ['stuck-in-flight', 'a dead request reports no reason, so the room looks merely idle', COMPONENT,
    "      setError('We could not reach the review service. Nothing was sent — your feedback is still here.');",
    '      setError(null);'],
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

  // ── duplicate submission ──────────────────────────────────────────────────
  ['duplicate-submission', 'submitting can be entered from any phase', FLOW,
    "  if (state.phase !== 'preparing') return state;\n  return { ...state, phase: 'submitting', error: null };",
    "  return { ...state, phase: 'submitting', error: null };"],
  ['duplicate-submission', 're-entry is allowed, so a double click transmits twice', FLOW,
    '  const prepared = beginPreparing(state, draftIssueIds);\n  if (prepared.phase !== \'preparing\') return state;',
    '  const prepared = beginPreparing({ ...state, phase: \'draft\' }, draftIssueIds);\n  if (prepared.phase !== \'preparing\') return state;'],
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

  // ── the revision note ─────────────────────────────────────────────────────
  ['note-dropped', 'the composer disappears from the send path', FLOW,
    "    secondaryLabel: 'Keep reviewing',\n    secondaryEnabled: true,\n    showNote: true,",
    "    secondaryLabel: 'Keep reviewing',\n    secondaryEnabled: true,\n    showNote: false,"],
  ['note-dropped', 'the composer does not survive a failure', FLOW,
    "  const errorLine = state.phase === 'error' ? state.error : null;",
    "  const errorLine = state.phase === 'error' ? state.error : null;\n  if (state.phase === 'error') return { mode: 'send_changes', primaryLabel: `Send ${draftCount} ${changeWord(draftCount)} & start revision`, primaryEnabled: !busy, secondaryLabel: 'Keep reviewing', secondaryEnabled: true, showNote: false, noteEnabled: false, noteHint: null, frozenCount: null, statusLine: null, errorLine, continuationId: null, resubmissionDisabled: false };"],
  ['note-dropped', 'a note is collected before the submission can carry it', COMPONENT,
    '  const NOTE_ENABLED = false;',
    '  const NOTE_ENABLED = true;'],
  ['note-dropped', 'the composer is typable regardless of the contract', COMPONENT,
    'disabled={!submitView.noteEnabled}',
    'disabled={false}'],
  ['note-dropped', 'an unpinned note field is invented on the wire', ACTIONS,
    "method: 'POST', body: {} };",
    "method: 'POST', body: { note: b.note } };"],
  ['note-dropped', 'the composer stops saying the note supplements the issues', COMPONENT,
    "placeholder=\"Optional. Adds context to the issues above — it doesn't replace them.\"",
    'placeholder="Optional."'],
];

let killed = 0;
const survivors = [];
for (const [boundary, name, file, from, to] of mutations) {
  const dir = mkdtempSync(join(tmpdir(), 'implexa-review-orchestration-mutant-'));
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
console.log('NOT COVERED (needs Backend #160): end-to-end note persistence and byte-identical read-back.');
console.log('NOT COVERED (needs a DOM harness): the mounted component. Submission orchestration was');
console.log('  moved into submitRevision() so every outcome branch is executable here, and the');
console.log('  component is a thin delegator pinned by source assertions — but a mutation that makes');
console.log('  the click handler simply do nothing is only reachable from a rendered-and-clicked test.');
if (survivors.length) {
  console.error(`\n✖ ${survivors.length} mutation(s) survived — the tests naming them are decorative:`);
  for (const s of survivors) console.error(`   ${s}`);
  process.exit(1);
}
