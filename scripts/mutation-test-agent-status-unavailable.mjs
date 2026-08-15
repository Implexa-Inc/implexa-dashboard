#!/usr/bin/env node
/**
 * Mutation harness for "unavailable must not render as healthy" on the agent page.
 *
 * The agent-detail envelope reports which sections it could not read. Every one
 * of those sections has an empty value that looks exactly like a good result —
 * a null checklist, an empty warning list, no grade, an empty run list. The
 * page used to consume those values directly, so a failed read rendered as an
 * actionable Activate button, a silent all-clear on connections, and a
 * confident "No runs yet".
 *
 * Each mutation restores one of those fail-opens, or blunts the discrimination
 * that makes them detectable. A survivor means the corresponding test is
 * asserting less than it claims.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
import { announceBaseline, materializeTree, runSuites } from './mutation-harness-support.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

const READER = 'lib/agent-detail.ts';
const ACTIONS = 'app/(dashboard)/_components/agent-actions.tsx';
const PAGE = 'app/(dashboard)/workflows/[slug]/page.tsx';

/**
 * The rendered suite BUNDLES agent-actions.tsx with esbuild, from whichever
 * tree lib/test/render.ts sits in. So for a mutation to that component to be
 * visible to the rendered test, the mutant tree needs the component's entire
 * import closure on disk — Node's loader backfill does not help esbuild, which
 * resolves against the filesystem.
 *
 * Hand-listing that closure rots the moment anyone adds an import (and rots
 * SILENTLY: the baseline breaks, or worse, the harness quietly bundles the
 * repository's unmutated copy). So derive it, with the same esbuild config
 * render.ts uses.
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
    READER,
    ACTIONS,
    PAGE,
    'lib/agent-detail.test.ts',
    'app/(dashboard)/_components/agent-status-unavailable.test.ts',
    // The reader's own dependencies (workflow-catalog, activation-core,
    // inbox-items, run-state) are deliberately NOT copied: no mutation here
    // touches them, so the loader backfills them from the repository
    // unmutated. Copying a file into the mutant tree also drags in ITS relative
    // imports, so this list stays the set a mutation may actually change.
    'lib/test/render.ts',
    // esbuild resolves the `@/*` imports through tsconfig paths. Without this
    // the mutant tree cannot bundle anything that uses the alias — which is
    // most of the component graph.
    'tsconfig.json',
    // Everything the rendered component actually pulls in (esbuild bundles it
    // from whichever tree render.ts sits in, so it must all be on disk).
    ...importClosure('./agent-actions.tsx', join(root, 'app', '(dashboard)', '_components')),
    // …and the reader's own runtime closure. lib/agent-detail.test.ts runs on
    // Node's native type-stripping WITHOUT the two-rooted loader, so nothing
    // backfills its relative imports — they have to be here.
    ...importClosure('./agent-detail.ts', join(root, 'lib')),
  ]),
];

const SUITES = [
  'lib/agent-detail.test.ts',
  // The only suite that can tell whether a USER is actually prevented from
  // starting a run, as opposed to whether the source still spells the guard.
  'app/(dashboard)/_components/agent-status-unavailable.test.ts',
];

const mutations = [
  // ── the reader stops discriminating ──────────────────────────────────────
  {
    boundary: 'reader', name: 'every section reports as available', file: READER,
    from: '        isUnavailable: (section: AgentSection) => unavailableSet.has(section),',
    to: '        isUnavailable: (_section: AgentSection) => false,',
  },
  {
    boundary: 'reader', name: 'the unavailable list is dropped on the floor', file: READER,
    from: `    const unavailable: string[] = Array.isArray(body.unavailable)
      ? body.unavailable.filter((s: unknown): s is string => typeof s === 'string')
      : [];`,
    to: '    const unavailable: string[] = [];',
  },
  {
    boundary: 'reader', name: 'a section is reported unavailable only when its value is also empty',
    file: READER,
    // The exact confusion this whole change exists to remove: emptiness is not
    // unavailability. A degraded section that still carried a value would be
    // reported healthy.
    from: '        isUnavailable: (section: AgentSection) => unavailableSet.has(section),',
    to: '        isUnavailable: (section: AgentSection) => unavailableSet.has(section) && !body[section],',
  },

  // ── the page stops blocking ──────────────────────────────────────────────
  {
    boundary: 'page-gate', name: 'an unreadable checklist no longer blocks the run action', file: PAGE,
    from: '  const actionsBlocked = activationUnavailable || connectionsUnavailable;',
    to: '  const actionsBlocked = connectionsUnavailable;',
  },
  {
    boundary: 'page-gate', name: 'an unreadable connection registry no longer blocks the run action', file: PAGE,
    from: '  const actionsBlocked = activationUnavailable || connectionsUnavailable;',
    to: '  const actionsBlocked = activationUnavailable;',
  },
  {
    boundary: 'page-gate', name: 'nothing blocks the run action at all', file: PAGE,
    from: '  const actionsBlocked = activationUnavailable || connectionsUnavailable;',
    to: '  const actionsBlocked = false;',
  },
  {
    boundary: 'page-gate', name: 'only the header action is blocked — the Setup tab keeps a live Run button',
    file: PAGE,
    from: `            inFlight={inFlight}
            revisePending={revisePending}
            statusUnavailable={actionsBlocked}`,
    to: `            inFlight={inFlight}
            revisePending={revisePending}
            statusUnavailable={false}`,
  },

  // ── the empty state lies again ───────────────────────────────────────────
  {
    boundary: 'empty-state', name: 'an unread run history renders as "No runs yet"', file: PAGE,
    from: '  const runsPanel = () => runsUnavailable ? (',
    to: '  const runsPanel = () => false ? (',
  },

  // ── the button stops withholding ─────────────────────────────────────────
  {
    boundary: 'button', name: 'the blocked branch falls through to the normal actions', file: ACTIONS,
    from: '      {statusUnavailable ? (',
    to: '      {false ? (',
  },
  {
    boundary: 'button', name: 'the primary action is withheld but the watch path is not', file: ACTIONS,
    from: '      {isActive && !statusUnavailable && !revisePending && blocking === 0 && (state === \'idle\' || state === \'error\') && (',
    to: '      {isActive && !revisePending && blocking === 0 && (state === \'idle\' || state === \'error\') && (',
  },
];

announceBaseline({
  label: 'agent-status-unavailable',
  root,
  files: FILES,
  dir: mkdtempSync(join(tmpdir(), 'implexa-agent-status-baseline-')),
  suites: SUITES,
});

let killed = 0;

for (const mutation of mutations) {
  const dir = mkdtempSync(join(tmpdir(), 'implexa-agent-status-mutant-'));
  try {
    materializeTree(root, FILES, dir);
    const target = join(dir, mutation.file);
    const source = readFileSync(target, 'utf8');
    if (!source.includes(mutation.from)) throw new Error(`Mutation anchor missing: ${mutation.name} (${mutation.file})`);
    const first = source.indexOf(mutation.from);
    if (source.indexOf(mutation.from, first + 1) >= 0 && !mutation.allowMultiple) {
      throw new Error(`Mutation anchor is ambiguous: ${mutation.name} (${mutation.file})`);
    }
    writeFileSync(target, source.replace(mutation.from, mutation.to));

    const result = runSuites(root, dir, SUITES);
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

console.log(`\nAll ${killed}/${mutations.length} agent-status-unavailable mutations killed.`);
