import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// Mutation tests for the Review Room continuation recovery surface.
//
// Each mutant reintroduces one part of the 2026-08-11 UX failure — three
// different situations rendered as one dead-end sentence, no action, and no way
// to tell "wait" from "do this specific thing" — or the optimistic-state bug a
// well-meaning refactor would introduce next: painting Queued from the click
// rather than from the answer.
//
// The DOM tests are the real assertion surface here. A source regex would pass a
// panel that computed the right state and rendered the wrong control, which is
// exactly the class of defect this lane exists to end.
//
// Mutants are applied to a full copy of the repo (node_modules symlinked back),
// so source bytes are never modified in place.

const root = path.resolve(import.meta.dirname, '..');
const HELPER = 'lib/run-request-refusal.ts';
const PANEL = 'app/(dashboard)/_components/review-continuation-recovery.tsx';
const BOX = 'app/(dashboard)/_components/run-continue-box.tsx';
const ACTIONS = 'app/(dashboard)/_components/run-actions.tsx';
const TESTS = [
  '--test',
  '--experimental-strip-types',
  'lib/run-request-refusal.test.ts',
  'app/(dashboard)/_components/review-continuation-recovery-render.test.ts',
];

const mutants = [
  ['delivery: old completed response is accepted without proof', PANEL,
    'const verified = result.deliveryVerified === true && !!result.runId && !!result.artifactId;',
    'const verified = true;'],
  ['delivery: rendering trusts legacy completion', PANEL,
    "setState(result.state === 'completed' && !verified ? 'settling' : result.state);",
    'setState(result.state);'],
  ['delivery: unverified completion notifies parent', PANEL,
    "if (result.state === 'completed' && verified) {",
    "if (result.state === 'completed') {"],
  ['delivery: settling offers a retry', PANEL,
    "      {resolved === 'retryable' && (",
    "      {(resolved === 'retryable' || resolved === 'settling') && ("],
  // ── the three states collapse back into one dead end ─────────────────────
  ['typed-state: "unable to verify" is reclassified as "still running"', HELPER,
    "  review_continuation_live_state_unknown: {\n    kind: 'unverifiable',",
    "  review_continuation_live_state_unknown: {\n    kind: 'still_running',"],
  ['typed-state: the state_unknown copy stops naming the action', HELPER,
    "    message: 'Implexa cannot yet verify that the previous revision process ended, so nothing was queued. '\n      + 'Fully quit and reopen the executor — that lets Implexa confirm the old process is gone — then retry.',",
    "    message: 'Implexa cannot safely verify that the previous revision process ended. This revision was not queued.',"],
  ['typed-state: a live attempt becomes recoverable, so a retry is offered mid-run', HELPER,
    "    recoverable: known.kind === 'unverifiable' && !!parsed.requestId,",
    '    recoverable: !!parsed.requestId,'],
  ['typed-state: recovery is offered without an address', HELPER,
    "    recoverable: known.kind === 'unverifiable' && !!parsed.requestId,",
    "    recoverable: known.kind === 'unverifiable',"],
  ['typed-state: an unrecognised reason is paraphrased into product copy', HELPER,
    "      message: 'Implexa could not queue this revision. Nothing was started.',",
    '      message: `Implexa could not queue this revision: ${parsed.reason}`,'],
  ['typed-state: the reason is read from the untrusted message instead of the body', HELPER,
    "  const reason = typeof raw.reason === 'string' ? raw.reason : '';",
    "  const reason = '';"],

  // ── optimistic state rollback ────────────────────────────────────────────
  ['optimistic-state: Queued is painted from the CLICK instead of the answer', PANEL,
    '    setBusy(true);\n    setError(null);\n    try {',
    '    setBusy(true);\n    setError(null);\n    setQueued(true);\n    try {'],
  ['optimistic-state: a refused retry keeps the queued state it should roll back', PANEL,
    "      const classified = classifyRunRequestRefusal(e);\n      setError(classified ? classified.message : 'Implexa could not queue this revision. Nothing was started.');",
    '      const classified = classifyRunRequestRefusal(e);\n      setQueued(true);\n      void classified;'],
  ['optimistic-state: the composer marks itself done before the backend answers', BOX,
    "      await callBackend('/api/v2/me/run-requests', {",
    "      setDone(true);\n      await callBackend('/api/v2/me/run-requests', {"],

  // ── the action itself ────────────────────────────────────────────────────
  ['recovery-action: a live attempt is offered a retry button', PANEL,
    "      {resolved === 'unverifiable' && (",
    "      {(resolved === 'unverifiable' || resolved === 'running') && ("],
  ['recovery-action: the restart instruction is dropped', PANEL,
    '              Fully quit <span className="text-ink-100">{executorLabel}</span> and open it again.',
    '              Wait a moment and try again.'],
  ['recovery-action: the retry addresses a different request than the one refused', PANEL,
    '        `/api/v2/me/run-requests/${encodeURIComponent(requestId)}/recover-review-continuation`,',
    "        '/api/v2/me/run-requests/00000000-0000-4000-8000-000000000000/recover-review-continuation',"],
  ['recovery-action: the note is dropped, so the user must re-enter their review', PANEL,
    '{ jwt: session?.access_token, method: \'POST\', body: { note: note || undefined } },',
    "{ jwt: session?.access_token, method: 'POST', body: {} },"],
  ['recovery-action: an unreadable state is guessed instead of rendering nothing', PANEL,
    "      setState((prev) => prev ?? (refusalKind === 'unverifiable' ? 'unverifiable' : null));",
    "      setState('retryable');"],

  // ── the surfaces stop routing to it ──────────────────────────────────────
  ['surface: the continue box stops routing a recoverable refusal to the action', BOX,
    '      if (classified?.recoverable) { setRefusal(classified); setMsg(\'\'); return; }',
    '      if (false) { setRefusal(classified); return; }'],
  ['surface: the held-run actions stop routing a recoverable refusal to the action', ACTIONS,
    '      if (classified?.recoverable) { setRefusal(classified); setErr(null); setBusy(null); return; }',
    '      if (false) { setRefusal(classified); setBusy(null); return; }'],
  ['surface: the continue box wipes the note on refusal', BOX,
    '      const classified = classifyRunRequestRefusal(e);',
    '      const classified = classifyRunRequestRefusal(e);\n      setNote(\'\');'],
];

function run(cwd) {
  return spawnSync(process.execPath, TESTS, {
    cwd, encoding: 'utf8', env: { ...process.env, NODE_PATH: path.join(root, 'node_modules') },
  });
}

// NON-VACUOUS BASELINE. Without this a broken renderer would count every mutant
// as killed and report a confident, meaningless green.
const baseline = run(root);
if (baseline.status !== 0) {
  process.stderr.write(`HARNESS BROKEN: unmutated baseline failed\n${baseline.stdout}\n${baseline.stderr}`);
  process.exit(1);
}
process.stdout.write('baseline green: review continuation recovery\n');

let killed = 0;
for (const [name, file, from, to] of mutants) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'implexa-continuation-recovery-ui-'));
  try {
    fs.cpSync(root, dir, {
      recursive: true,
      filter: (src) => !['node_modules', '.git', '.next', 'dist', '.vercel'].includes(path.basename(src)),
    });
    fs.symlinkSync(path.join(root, 'node_modules'), path.join(dir, 'node_modules'));
    const target = path.join(dir, file);
    const source = fs.readFileSync(target, 'utf8');
    const first = source.indexOf(from);
    if (first < 0 || source.indexOf(from, first + 1) >= 0) {
      throw new Error(`${name}: anchor must exist exactly once in ${file}`);
    }
    fs.writeFileSync(target, source.replace(from, to));
    const result = run(dir);
    if (result.status === 0) {
      process.stderr.write(`SURVIVED: ${name}\n`);
      process.exitCode = 1;
    } else {
      killed += 1;
      process.stdout.write(`killed: ${name}\n`);
    }
  } catch (e) {
    process.stderr.write(`HARNESS ERROR: ${name}: ${e.message}\n`);
    process.exitCode = 1;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

process.stdout.write(`\n${killed}/${mutants.length} mutants killed\n`);
