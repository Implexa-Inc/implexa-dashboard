#!/usr/bin/env node

import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const files = [
  'lib/generation-proposal-entry.ts', 'lib/generation-proposal-entry.test.ts',
  'lib/generation-proposal-actions.ts', 'lib/generation-proposal-actions.test.ts',
  'lib/generation-entry-eligibility.ts', 'lib/generation-entry-eligibility.test.ts',
  'lib/generation-proposal.ts', 'lib/generation-proposal.fixtures.ts',
  'lib/quality-mode.ts', 'lib/quality-mode.test.ts',
];
const tests = [
  'lib/generation-proposal-entry.test.ts',
  'lib/generation-proposal-actions.test.ts',
  'lib/generation-entry-eligibility.test.ts',
  'lib/quality-mode.test.ts',
];

const mutations = [
  ['proxy', 'multiple moments reach paid compiler', 'lib/generation-proposal-actions.ts',
    'if (!Array.isArray(b.moments) || b.moments.length !== 1)',
    'if (!Array.isArray(b.moments) || b.moments.length < 1)'],
  ['proxy', 'source run identity is optional', 'lib/generation-proposal-actions.ts',
    "  if (!sourceRunId) return 'A valid sourceRunId is required.';",
    "  if (false && !sourceRunId) return 'A valid sourceRunId is required.';"],
  ['preview-binding', 'source run response binding removed', 'lib/generation-proposal-entry.ts',
    '    && identity.source_run_id === expected.sourceRunId',
    '    && true'],
  ['preview-binding', 'prompt response binding removed', 'lib/generation-proposal-entry.ts',
    '      || task.promptText !== expectedVariants.get(task.variant)) return false;',
    '      || false) return false;'],
  ['preview-binding', 'timestamp end response binding removed', 'lib/generation-proposal-entry.ts',
    '      || task.window.endSeconds !== expected.moment.endSeconds',
    '      || false'],
  ['preview-binding', 'timestamp start response binding removed', 'lib/generation-proposal-entry.ts',
    '    if (task.window.startSeconds !== expected.moment.startSeconds',
    '    if (false'],
  ['preview-binding', 'explicit mode response binding removed', 'lib/generation-proposal-entry.ts',
    '    || compiled.qualityMode !== expected.qualityMode) return false;',
    '    || false) return false;'],
  ['comparison', 'partial mode comparison accepted', 'lib/generation-proposal-entry.ts',
    '  return fast && professional && production ? { fast, professional, production } : null;',
    '  return fast ? { fast, professional: professional || fast, production: production || fast } : null;'],
  ['comparison', 'production leg is not parsed', 'lib/generation-proposal-entry.ts',
    "  const production = parseGenerationPreviewResponse(bodies.production, { ...expected, qualityMode: 'production' });",
    '  const production = fast;'],
  ['create-binding', 'availability-derived lifecycle ignored', 'lib/generation-proposal-entry.ts',
    '  if (body.state !== expectedState) return null;',
    '  if (false && body.state !== expectedState) return null;'],
  ['create-binding', 'preexisting authorization accepted', 'lib/generation-proposal-entry.ts',
    '    || (identity.authorization_id ?? null) !== null',
    '    || false'],
  ['create-binding', 'preexisting authorization digest accepted', 'lib/generation-proposal-entry.ts',
    '    || (identity.authorization_digest ?? null) !== null',
    '    || false'],
  ['single-flight', 'create single-flight guard removed', 'lib/generation-proposal-entry.ts',
    "  if (flight.current || phase !== 'ready' || !hasPreviews || !selectedAvailable) return false;",
    "  if (false || phase !== 'ready' || !hasPreviews || !selectedAvailable) return false;"],
  ['eligibility', 'source MP4 gets paid entry affordance', 'lib/generation-entry-eligibility.ts',
    "  return artifact.role === 'final_output' &&",
    '  return'],
  ['eligibility', 'declared video is accepted by direct route', 'lib/generation-entry-eligibility.ts',
    "    return artifact.status === 'validated'",
    '    return true'],
  ['eligibility', 'artifact read failure becomes confident ineligibility', 'lib/generation-entry-eligibility.ts',
    "  if (readError || !Array.isArray(rows)) return 'unavailable';",
    "  if (!Array.isArray(rows)) return 'unavailable';"],
  ['selector-wiring', 'selector bypasses canonical Production gate', 'lib/quality-mode.ts',
    '    { selectable: isModeSelectable(mode, compiledByMode[mode]) },',
    '    { selectable: compiledByMode[mode]?.availability === true },'],

  // ── the repair reserve at the ENTRY boundary ──────────────────────────────
  // The reserve is 36 credits of the user's money, so it is bound to what they
  // typed exactly like the candidates are. These mutants restore the superseded
  // model in which Professional was two tasks bound by variant alone.
  ['preview-binding', 'OLD ASSUMPTION: candidate count fixed at the task count', 'lib/generation-proposal-entry.ts',
    '  if (compiled.candidateCount !== expectedVariants.size) return false;',
    '  if (compiled.tasks.length !== expectedVariants.size) return false;'],
  // NOTE: the entry-level `compiled.repairCount !== expectedRepairs.size` check
  // is deliberately NOT mutated here. The parser's Professional gate already
  // enforces one reserve per moment, so that mutant is EQUIVALENT and would
  // survive by construction. The redundancy is documented at the call site.
  ['preview-binding', 'repair prompt response binding removed', 'lib/generation-proposal-entry.ts',
    '      if (task.promptText !== expectedRepairs.get(task.repairOrdinal)) return false;',
    '      if (false) return false;'],
  // Mutating the moment binding for REPAIRS ONLY is equivalent: the parser's
  // per-moment rule (two candidates + one reserve) already refuses a reserve
  // filed under a moment of its own. What is genuinely load-bearing here is the
  // binding to the moment the USER typed, which the parser never sees — so that
  // is what this mutant removes.
  ['preview-binding', 'typed moment binding removed', 'lib/generation-proposal-entry.ts',
    '    if (task.momentId !== expected.moment.id) return false;',
    '    if (false) return false;'],
  // The final `size === 0` return is NOT mutated: both halves are equivalent.
  // Each expected task is deleted from its map as it matches, so a duplicate or
  // unmatched task already returns false inside the loop, and the counts were
  // checked before it. It is kept as the natural statement of "everything the
  // user typed was accounted for" — documented, not dressed up as enforcement.
];

let killed = 0;
for (const [boundary, name, file, from, to] of mutations) {
  const dir = mkdtempSync(join(tmpdir(), 'implexa-generation-entry-mutant-'));
  try {
    for (const source of files) {
      const target = join(dir, source); mkdirSync(dirname(target), { recursive: true });
      cpSync(join(root, source), target);
    }
    const target = join(dir, file);
    const source = readFileSync(target, 'utf8');
    if (!source.includes(from)) throw new Error(`Mutation anchor missing: ${name}`);
    writeFileSync(target, source.replace(from, to));
    const result = spawnSync(process.execPath, ['--test', ...tests.map((t) => join(dir, t))], {
      cwd: dir, encoding: 'utf8', env: process.env,
    });
    if (result.status === 0) throw new Error(`SURVIVED [${boundary}] ${name}`);
    killed += 1;
    console.log(`KILLED [${boundary}] ${name}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log(`Mutation result: ${killed}/${mutations.length} killed across 7 boundaries.`);
