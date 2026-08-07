#!/usr/bin/env node
/**
 * Mutation harness for the queued-run wait notice.
 *
 * The retired copy told everyone with a long-queued run that it was "waiting for
 * an available Claude session", named a 5-hour cap nothing had measured, and said
 * the run would go "once Claude is free again" — while a healthy Codex sat idle
 * and Implexa's router was perfectly willing to use it. That is not a wording
 * nit: it sent the founder to wait out a window that had nothing to do with the
 * run, during the exact incident this PR fixes.
 *
 * Every mutant here is a way that dishonesty could come back — the stale sentence
 * restored, an engine named without a pin, a guess dressed as a declared block, or
 * the notice firing before we have anything to say. Each must be KILLED by a test.
 */

import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

const FILES = [
  'lib/queued-wait-copy.ts',
  'lib/queued-wait-copy.test.ts',
  'app/(dashboard)/_components/running-agents.tsx',
  'app/(dashboard)/_components/revise-request-lifecycle.test.ts',
];

const SUITES = [
  'lib/queued-wait-copy.test.ts',
  'app/(dashboard)/_components/revise-request-lifecycle.test.ts',
];

const COPY = 'lib/queued-wait-copy.ts';
const COMPONENT = 'app/(dashboard)/_components/running-agents.tsx';

const STALE_SENTENCE = 'Still waiting for an available Claude session on your Mac to pick this up. Most often that '
  + 'means Claude (or the Implexa app) isn’t open, your Mac slept, or you’ve hit your Claude 5-hour usage limit. '
  + 'It runs automatically once Claude is free again — nothing’s lost.';

const mutations = [
  // ── the stale Claude-only copy, restored ─────────────────────────────────
  {
    boundary: 'engine-honesty', name: 'the retired Claude-only sentence is restored in the helper', file: COPY,
    from: "    : 'Still queued. Implexa is picking an available engine on your Mac to run this.';",
    to: `    : ${JSON.stringify(STALE_SENTENCE)};`,
  },
  {
    boundary: 'engine-honesty', name: 'the component hard-codes the Claude-only paragraph again', file: COMPONENT,
    from: '                  <p className="text-[11px] font-medium text-sky-700 dark:text-sky-300 leading-snug">\n                    {queuedWait.headline}\n                  </p>',
    to: `                  <p className="text-[11px] font-medium text-sky-700 dark:text-sky-300 leading-snug">\n                    ${STALE_SENTENCE}\n                  </p>`,
  },
  {
    boundary: 'engine-honesty', name: 'the detail claims the run resumes when Claude frees up', file: COPY,
    from: "    : 'Any of your engines can take it — one being busy or at its usage limit does not block the others. It starts as soon as one picks it up, and nothing is lost. If it keeps waiting, check that the Implexa app is running and your Mac is awake.';",
    to: "    : 'It runs automatically once Claude is free again — nothing is lost.';",
  },

  // ── an engine named without a pin ────────────────────────────────────────
  {
    boundary: 'pin-honesty', name: 'an unpinned request is described as pinned to Claude', file: COPY,
    from: "  const pin = input.enginePreference === 'claude' || input.enginePreference === 'codex'\n    ? input.enginePreference\n    : null;",
    to: "  const pin = input.enginePreference === 'codex' ? 'codex' : 'claude';",
  },
  {
    boundary: 'pin-honesty', name: 'an unrecognised engine value is treated as a pin', file: COPY,
    from: "  const pin = input.enginePreference === 'claude' || input.enginePreference === 'codex'\n    ? input.enginePreference\n    : null;",
    to: '  const pin = (input.enginePreference as unknown as \'claude\' | \'codex\') || null;',
  },

  // ── a guess dressed as a declared block ──────────────────────────────────
  {
    boundary: 'declared-blocks', name: 'an undiagnosed run is given a fabricated block', file: COPY,
    from: "  const declared = typeof input.declaredBlock === 'string' && input.declaredBlock.trim()\n    ? input.declaredBlock.trim()\n    : null;",
    to: "  const declared = typeof input.declaredBlock === 'string' && input.declaredBlock.trim()\n    ? input.declaredBlock.trim()\n    : 'Your Claude session is at its 5-hour usage limit.';",
  },
  {
    boundary: 'declared-blocks', name: 'a blank declaration counts as a block', file: COPY,
    from: "  const declared = typeof input.declaredBlock === 'string' && input.declaredBlock.trim()",
    to: "  const declared = typeof input.declaredBlock === 'string'",
  },
  {
    boundary: 'declared-blocks', name: 'the component renders the block area unconditionally', file: COMPONENT,
    from: '                  {queuedWait.block && (',
    to: '                  {true && (',
  },

  // ── the notice fires when there is nothing to say ────────────────────────
  {
    boundary: 'timing', name: 'the notice appears the instant a run is queued', file: COPY,
    from: '  if (!Number.isFinite(elapsed) || elapsed <= QUEUED_WAIT_MS) return null;',
    to: '  if (!Number.isFinite(elapsed)) return null;',
  },
  {
    boundary: 'timing', name: 'an unparseable queue time still produces a notice', file: COPY,
    from: '  if (!Number.isFinite(elapsed) || elapsed <= QUEUED_WAIT_MS) return null;',
    to: '  if (elapsed <= QUEUED_WAIT_MS) return null;',
  },
  {
    boundary: 'timing', name: 'a running run is described as queued', file: COPY,
    from: "  if (!input || input.status !== 'queued') return null;",
    to: '  if (!input) return null;',
  },
  // ── request lifecycle projection ──────────────────────────────────────
  {
    boundary: 'request-lifecycle', name: 'the backend lifecycle projection is ignored again', file: COMPONENT,
    from: '        const normalized = items.map((card) => ({ ...card, status: statusFromLifecycle(card) }));',
    to: '        const normalized = items;',
  },
  {
    boundary: 'request-lifecycle', name: 'the persisted failure cause is dropped from the card', file: COMPONENT,
    from: "                {c.status === 'failed' && c.failureReason ? (",
    to: '                {false ? (',
  },
];

let killed = 0;

for (const mutation of mutations) {
  const dir = mkdtempSync(join(tmpdir(), 'implexa-queued-wait-mutant-'));
  try {
    for (const file of FILES) {
      const target = join(dir, file);
      mkdirSync(dirname(target), { recursive: true });
      cpSync(join(root, file), target);
    }
    const target = join(dir, mutation.file);
    const source = readFileSync(target, 'utf8');
    if (!source.includes(mutation.from)) throw new Error(`Mutation anchor missing: ${mutation.name} (${mutation.file})`);
    writeFileSync(target, source.replace(mutation.from, mutation.to));

    const result = spawnSync(
      process.execPath,
      ['--test', ...SUITES.map((suite) => join(dir, suite))],
      { cwd: dir, encoding: 'utf8', env: process.env },
    );
    // A SURVIVOR IS A HARD FAILURE — a mutation of this surface that no test
    // notices means the honesty it broke was never actually guarded.
    if (result.status === 0) {
      process.stderr.write(result.stdout.slice(-4000));
      process.stderr.write(result.stderr.slice(-2000));
      throw new Error(`SURVIVED [${mutation.boundary}] ${mutation.name}`);
    }
    killed += 1;
    console.log(`KILLED [${mutation.boundary}] ${mutation.name}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const boundaries = new Set(mutations.map((m) => m.boundary));
console.log(`\nMutation result: ${killed}/${mutations.length} killed across ${boundaries.size} boundaries.`);
