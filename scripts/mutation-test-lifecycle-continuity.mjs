#!/usr/bin/env node
/**
 * Mutation harness for Active Agents lifecycle continuity.
 *
 * THE DEFECT (2026-08-21, preparation 5b3c1755-…). A large local-input run showed
 * "Preparing local input — 97% verified", then the card vanished, an unrelated
 * older failure floated to the top, and the same work returned minutes later as
 * "Selecting". The agent ran fine throughout; the feed simply erased it, because
 * every readable response replaced the whole card collection.
 *
 * Each mutant here is a way that erasure — or a worse one — could come back:
 * replacement instead of folding, identity falling back to the workflow slug, a
 * hold that never ends, a terminal held open as a ghost, a Cancel fired at a
 * state we are not currently confirming, an unknown status treated as known.
 *
 * A SURVIVOR means the corresponding test is asserting less than it claims. It
 * is never waived.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
import { announceBaseline, materializeTree, runSuites } from './mutation-harness-support.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

const REDUCER = 'lib/live-lifecycle-continuity.ts';
const COMPONENT = 'app/(dashboard)/_components/running-agents.tsx';

/**
 * The rendered suite BUNDLES running-agents.tsx with esbuild from whichever tree
 * lib/test/render.ts sits in, so a mutation is only visible to it when the
 * component's whole import closure is on disk in the mutant tree. Hand-listing
 * that closure rots silently the moment anyone adds an import, so derive it with
 * the same esbuild configuration render.ts uses.
 */
function importClosure(entrySpecifier, resolveDir) {
  const result = buildSync({
    stdin: {
      contents: `import * as M from ${JSON.stringify(entrySpecifier)}; export default M;`,
      resolveDir,
      loader: 'tsx',
    },
    bundle: true,
    write: false,
    metafile: true,
    format: 'iife',
    platform: 'browser',
    absWorkingDir: root,
    target: 'es2022',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"development"' },
    loader: { '.css': 'empty' },
    alias: {
      'next/navigation': join(root, 'lib/test/stubs/next-navigation.ts'),
      'next/link': join(root, 'lib/test/stubs/next-link.tsx'),
      '@/lib/supabase/client': join(root, 'lib/test/stubs/supabase.ts'),
      '@/lib/api': join(root, 'lib/test/stubs/api.ts'),
    },
  });
  return Object.keys(result.metafile.inputs)
    .filter((f) => !f.includes('node_modules') && !f.startsWith('<'));
}

const FILES = [
  ...new Set([
    REDUCER,
    COMPONENT,
    'lib/live-lifecycle-continuity.test.ts',
    'app/(dashboard)/_components/running-agents-continuity.render.test.ts',
    'lib/test/render.ts',
    'lib/test/stubs/next-navigation.ts',
    'lib/test/stubs/next-link.tsx',
    'lib/test/stubs/supabase.ts',
    'lib/test/stubs/api.ts',
    // esbuild resolves `@/*` through tsconfig paths.
    'tsconfig.json',
    ...importClosure('./running-agents.tsx', join(root, 'app', '(dashboard)', '_components')),
  ]),
];

const SUITES = [
  // The rules.
  'lib/live-lifecycle-continuity.test.ts',
  // The wiring. The only suite that can tell whether a USER still sees the card,
  // as opposed to whether the source still spells the reducer's name.
  'app/(dashboard)/_components/running-agents-continuity.render.test.ts',
];

const mutations = [
  // ── the erasure itself ───────────────────────────────────────────────────
  {
    boundary: 'no-erasure', name: 'the feed replaces the whole collection again instead of folding', file: COMPONENT,
    from: '        const merged = fold({ kind: \'items\', items: normalized });\n        setCards(merged);',
    to: '        const merged = normalized as RenderedCard[];\n        setCards(merged);',
  },
  {
    boundary: 'no-erasure', name: 'an omitted nonterminal request is dropped rather than held', file: REDUCER,
    from: '    if (entry.terminal || (nowMs - entry.confirmedAt) >= CONTINUITY_GRACE_MS) {',
    to: '    if (true) {',
  },
  {
    boundary: 'no-erasure', name: 'a failed read deletes the last known cards', file: COMPONENT,
    from: '        const held = fold({ kind: \'unreadable\' });\n        if (!alive) return;\n        setFailed(true);\n        if (held.length) setCards(held);\n      }\n    }\n    load();',
    to: '        const held: RenderedCard[] = [];\n        if (!alive) return;\n        setFailed(true);\n        if (held.length) setCards(held);\n      }\n    }\n    load();',
  },
  {
    boundary: 'no-erasure', name: 'an unreadable response expires held cards as if it were an answer', file: REDUCER,
    from: "  if (!input || input.kind !== 'items' || !Array.isArray(input.items)) {",
    to: '  if (false) {',
  },

  // ── identity ─────────────────────────────────────────────────────────────
  {
    boundary: 'identity', name: 'identity falls back to the workflow slug', file: REDUCER,
    from: '  const runId = typeof card.runId === \'string\' && card.runId ? card.runId : null;\n  return runId;',
    to: '  const runId = typeof card.runId === \'string\' && card.runId ? card.runId : null;\n  return runId || (typeof card.skillSlug === \'string\' ? card.skillSlug : null);',
  },
  {
    boundary: 'identity', name: 'the DOM key falls back to the slug, so one card can inherit another', file: COMPONENT,
    from: '          const key = c.continuityKey;',
    to: '          const key = c.runId || c.requestId || c.skillSlug;',
  },
  {
    boundary: 'identity', name: 'runId is preferred over requestId, breaking continuity at the run handoff', file: REDUCER,
    from: '  const requestId = typeof card.requestId === \'string\' && card.requestId ? card.requestId : null;\n  if (requestId) return requestId;',
    to: '  const requestId = typeof card.requestId === \'string\' && card.requestId ? card.requestId : null;\n  if (typeof card.runId === \'string\' && card.runId) return card.runId;\n  if (requestId) return requestId;',
  },
  {
    boundary: 'identity', name: 'a duplicated identity within one response yields two cards', file: REDUCER,
    from: '    if (seen.has(key)) continue;    // one card per identity, whatever arrives',
    to: '    if (false) continue;',
  },
  {
    boundary: 'identity', name: 'a card that loses its requestId forks into a second card', file: REDUCER,
    from: '    if (runId && runIndex.has(runId)) key = runIndex.get(runId) as string;',
    to: '    if (false) key = runIndex.get(runId as string) as string;',
  },

  // ── the bound ────────────────────────────────────────────────────────────
  {
    boundary: 'bounded-hold', name: 'a held card renews its own confirmation, so the hold never ends', file: REDUCER,
    from: '    retainedKeys.push(key);',
    to: '    retainedKeys.push(key);\n    entry = { ...entry, confirmedAt: nowMs };',
    rewrite: (source) => source.replace('  for (const [key, entry] of previous) {', '  for (const [key, initialEntry] of previous) {\n    let entry = initialEntry;'),
  },
  {
    boundary: 'bounded-hold', name: 'the grace window is unbounded', file: REDUCER,
    from: 'export const CONTINUITY_GRACE_MS = 45_000;',
    to: 'export const CONTINUITY_GRACE_MS = Number.MAX_SAFE_INTEGER;',
  },
  {
    boundary: 'bounded-hold', name: 'a terminal state is held open as a ghost', file: REDUCER,
    from: '    if (entry.terminal || (nowMs - entry.confirmedAt) >= CONTINUITY_GRACE_MS) {',
    to: '    if ((nowMs - entry.confirmedAt) >= CONTINUITY_GRACE_MS) {',
  },
  {
    boundary: 'bounded-hold', name: 'terminality is read from the status word only, ignoring the backend flag', file: REDUCER,
    from: '    const terminal = item.isTerminal === true || isTerminalStatus(item.status);',
    to: '    const terminal = isTerminalStatus(item.status);',
  },

  // ── monotonicity ─────────────────────────────────────────────────────────
  {
    boundary: 'monotonic', name: 'a lower state repaints over a higher one, so the card flickers backwards', file: REDUCER,
    from: '    if (regressing && regressionCount <= REGRESSION_TOLERANCE_POLLS) {',
    to: '    if (false) {',
  },
  {
    boundary: 'monotonic', name: 'the higher state is held forever, so a real requeue can never be shown', file: REDUCER,
    from: 'export const REGRESSION_TOLERANCE_POLLS = 2;',
    to: 'export const REGRESSION_TOLERANCE_POLLS = Number.MAX_SAFE_INTEGER;',
  },
  {
    // THE ORIGINAL DEFECT IN THIS RULE. A hold measured in wall-clock from the
    // LAST poll self-refreshes at any cadence faster than the window, so it
    // never closes and every executor fallback freezes as "Running".
    boundary: 'monotonic', name: 'the hold goes back to wall-clock from the last poll, and self-refreshes', file: REDUCER,
    from: '    if (regressing && regressionCount <= REGRESSION_TOLERANCE_POLLS) {',
    to: '    if (regressing && (nowMs - prior.confirmedAt) < 20_000) {',
  },
  {
    boundary: 'monotonic', name: 'the disagreement counter resets while the backend keeps disagreeing', file: REDUCER,
    from: '    const regressionCount = regressing ? (prior as ContinuityEntry<T>).regressionCount + 1 : 0;',
    to: '    const regressionCount = regressing ? 1 : 0;',
  },
  {
    boundary: 'monotonic', name: 'a terminal is suppressed by the regression hold', file: REDUCER,
    from: '    const regressing = !!prior && !terminal && rank < prior.rank;',
    to: '    const regressing = !!prior && rank <= prior.rank;',
  },

  // ── cancellation ─────────────────────────────────────────────────────────
  {
    boundary: 'cancellation', name: 'a held or stale card still offers Cancel', file: REDUCER,
    from: "  if (card.freshness && card.freshness !== 'fresh') return null;",
    to: '  if (false) return null;',
  },
  {
    boundary: 'cancellation', name: 'an unknown lifecycle phase is treated as cancellable', file: REDUCER,
    from: '  if (statusRank(card.status) === null) return null;',
    to: '  if (false) return null;',
  },
  {
    boundary: 'cancellation', name: 'a phase the backend closed is still offered', file: REDUCER,
    from: '  if (card.cancelable === false) return null;',
    to: '  if (false) return null;',
  },
  {
    boundary: 'cancellation', name: 'a terminal card still offers Cancel', file: REDUCER,
    from: '  if (isTerminalStatus(card.status) || card.isTerminal === true) return null;',
    to: '  if (false) return null;',
  },
  // NOT MUTATED, deliberately: doCancel's own no-target guard is unreachable by
  // construction. The dialog withdraws the destructive action whenever no target
  // exists (`confirmHeld`), and doCancel is reached only from that button — so no
  // fixture can drive a targetless call, and a mutant for it could only ever be a
  // permanent survivor. The guard stays as insurance against a future caller; the
  // rules it consults are mutated individually above.
  {
    boundary: 'cancellation', name: 'the Cancel button ignores the shared authority rule', file: COMPONENT,
    from: '              {CANCELLABLE_STATUSES.has(c.status) && !c.runId && c.preparationCancelable !== false && cancellationTarget(c) && (',
    to: '              {CANCELLABLE_STATUSES.has(c.status) && !c.runId && c.preparationCancelable !== false && (',
  },
  {
    boundary: 'cancellation', name: 'Stop is offered on a card we are not currently confirming', file: COMPONENT,
    from: "              {c.status === 'running' && c.freshness === 'fresh' && (c.runId || c.requestId)",
    to: "              {c.status === 'running' && (c.runId || c.requestId)",
  },

  {
    boundary: 'cancellation', name: 'a cancel that lost the race hides the run that started anyway', file: COMPONENT,
    from: '    .filter((c) => !(c.requestId && !c.runId && cancelledReqIds.has(c.requestId)));',
    to: '    .filter((c) => !(c.requestId && cancelledReqIds.has(c.requestId)));',
  },

  {
    boundary: 'cancellation', name: 'a fallback_blocked request is offered for cancellation', file: REDUCER,
    from: "  // Terminal at the REQUEST layer: replaying a consequential step could\n"
      + "  // duplicate an external side effect, so the backend closes the request and\n"
      + "  // marks it terminal. It is a standing \"needs you\" alert, not live work, and\n"
      + "  // it is emphatically not cancellable.\n  'fallback_blocked',\n",
    to: '',
  },
  {
    boundary: 'cancellation', name: 'a running request with no bound run gets a Stop that issues no call', file: COMPONENT,
    from: '    const target = cancellationTarget(card);\n    if (!isRunningCancel(card) && !target) return;',
    to: '    const target = cancellationTarget(card) && card.runId ? cancellationTarget(card) : null;\n'
      + '    if (!isRunningCancel(card) && !target) return;',
  },

  {
    boundary: 'cancellation', name: 'the run-plane kill bypasses the freshness rule', file: COMPONENT,
    from: "  const isRunningCancel = (c: RenderedCard | null) =>\n"
      + "    !!c && c.status === 'running' && c.freshness === 'fresh' && !!(c.runId || c.requestId);",
    to: "  const isRunningCancel = (c: RenderedCard | null) =>\n"
      + "    !!c && c.status === 'running' && !!(c.runId || c.requestId);",
  },

  {
    boundary: 'honesty', name: 'a regression-held card claims to be freshly confirmed', file: REDUCER,
    from: "    ordered.push({ key, card, freshness: card === item ? 'fresh' : 'retained' });",
    to: "    ordered.push({ key, card, freshness: 'fresh' });",
  },

  {
    boundary: 'cancellation', name: 'a stale dialog key approximates a target instead of resolving to nothing', file: REDUCER,
    from: '  return cards.find((card) => card && card.continuityKey === key) ?? null;',
    to: '  return cards.find((card) => card && card.continuityKey === key) ?? cards[0] ?? null;',
  },
  {
    boundary: 'cancellation', name: 'the dialog key outlives the card it named', file: COMPONENT,
    from: '    if (confirmCancelKey && !confirmCancel) setConfirmCancelKey(null);',
    to: '    if (false) setConfirmCancelKey(null);',
  },

  {
    boundary: 'honesty', name: 'a held card is described as pre-execution and offered an inert kill', file: COMPONENT,
    from: '  const confirmHeld = !!confirmCancel\n    && !isRunningCancel(confirmCancel)\n    && !cancellationTarget(confirmCancel);',
    to: '  const confirmHeld = false;',
  },
  {
    boundary: 'honesty', name: 'the destructive button stays visible on a held card', file: COMPONENT,
    from: '          {!confirmHeld && (',
    to: '          {true && (',
  },

  // ── honesty ──────────────────────────────────────────────────────────────
  {
    boundary: 'honesty', name: 'a held card is presented as if it were current', file: COMPONENT,
    from: "                  {c.freshness !== 'fresh'\n                    ? <span className=\"text-ink-400\">{freshnessNotice(c.freshness)}</span>",
    to: '                  {false\n                    ? <span className="text-ink-400">{freshnessNotice(c.freshness)}</span>',
  },
  {
    boundary: 'honesty', name: 'a held card reports no notice at all', file: REDUCER,
    from: "  if (freshness === 'retained') return 'Updating status…';",
    to: "  if (freshness === 'retained') return null;",
  },
  {
    boundary: 'honesty', name: 'a stale card claims to be freshly confirmed', file: REDUCER,
    from: "      .map((entry) => ({ ...entry.card, continuityKey: entry.key, freshness: 'stale' as Freshness }));",
    to: "      .map((entry) => ({ ...entry.card, continuityKey: entry.key, freshness: 'fresh' as Freshness }));",
  },

  // ── fail closed ──────────────────────────────────────────────────────────
  {
    boundary: 'fail-closed', name: 'an unrankable status is admitted to the cache with an invented rank', file: REDUCER,
    from: '    if (key === null || rank === null) { untracked.push(item); continue; }',
    to: '    if (key === null) { untracked.push(item); continue; }',
  },
  {
    boundary: 'fail-closed', name: 'a malformed item is treated as a card', file: REDUCER,
    from: "    if (!item || typeof item !== 'object') continue;                 // fail closed",
    to: '    // fail open',
  },
  {
    boundary: 'fail-closed', name: 'an unknown status is given a rank rather than refused', file: REDUCER,
    from: '  return Object.prototype.hasOwnProperty.call(RANK, status) ? RANK[status] : null;',
    to: '  return Object.prototype.hasOwnProperty.call(RANK, status) ? RANK[status] : 0;',
  },

  // ── placement ────────────────────────────────────────────────────────────
  {
    boundary: 'placement', name: 'a held card jumps to the end of the list instead of holding its place', file: REDUCER,
    from: '    const at = Math.min(entry.index, ordered.length);',
    to: '    const at = ordered.length;',
  },
];

announceBaseline({
  label: 'lifecycle-continuity',
  root,
  files: FILES,
  dir: mkdtempSync(join(tmpdir(), 'implexa-lifecycle-baseline-')),
  suites: SUITES,
});

let killed = 0;
const survivors = [];

for (const mutation of mutations) {
  const dir = mkdtempSync(join(tmpdir(), 'implexa-lifecycle-mutant-'));
  try {
    materializeTree(root, FILES, dir);
    const target = join(dir, mutation.file);
    let source = readFileSync(target, 'utf8');
    if (mutation.rewrite) source = mutation.rewrite(source);
    if (!source.includes(mutation.from)) throw new Error(`Mutation anchor missing: ${mutation.name} (${mutation.file})`);
    const first = source.indexOf(mutation.from);
    if (source.indexOf(mutation.from, first + 1) >= 0 && !mutation.allowMultiple) {
      throw new Error(`Mutation anchor is ambiguous: ${mutation.name} (${mutation.file})`);
    }
    writeFileSync(target, source.replace(mutation.from, mutation.to));

    const result = runSuites(root, dir, SUITES);
    if (result.status === 0) {
      process.stderr.write(result.stdout.slice(-4000));
      survivors.push(`[${mutation.boundary}] ${mutation.name}`);
      console.log(`SURVIVED [${mutation.boundary}] ${mutation.name}`);
    } else {
      killed += 1;
      console.log(`KILLED [${mutation.boundary}] ${mutation.name}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (survivors.length) {
  process.stderr.write(`\n${survivors.length} mutation(s) survived:\n${survivors.map((s) => `  - ${s}`).join('\n')}\n`);
  process.exitCode = 1;
} else {
  console.log(`\nAll ${killed}/${mutations.length} lifecycle-continuity mutations killed.`);
}
