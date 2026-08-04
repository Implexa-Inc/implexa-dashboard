#!/usr/bin/env node

import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const files = [
  'lib/generation-proposal.ts',
  'lib/generation-proposal-state.ts',
  'lib/generation-proposal.fixtures.ts',
  'lib/generation-proposal.test.ts',
];

const mutations = [
  {
    boundary: 'mode-preview', name: 'Professional shape gate removed entirely', file: 'lib/generation-proposal.ts',
    from: "  if (v.quality_mode === 'professional') {", to: "  if (false && v.quality_mode === 'professional') {",
  },

  // ── THE REGRESSION THAT TOOK THIS SURFACE DOWN ────────────────────────────
  // Each mutant below restores one piece of the superseded two-task, never-
  // approvable model of Professional. Every one of them made the live quality
  // comparison refuse to render, so every one must be killed by a test rather
  // than only by review.
  {
    boundary: 'repair-reserve', name: 'OLD ASSUMPTION: every task must name a variant', file: 'lib/generation-proposal.ts',
    from: '  if (!isId(v.task_id) || !isId(v.moment_id)) return null;',
    to: '  if (!isId(v.task_id) || !isId(v.moment_id) || !isId(v.variant)) return null;',
  },
  {
    boundary: 'repair-reserve', name: 'OLD ASSUMPTION: Professional can never be approvable', file: 'lib/generation-proposal.ts',
    from: "    if (!availability && v.unavailable_reason !== 'missing_required_professional_execution_capabilities') return null;",
    to: "    if (availability || v.unavailable_reason !== 'missing_required_professional_execution_capabilities') return null;",
  },
  {
    boundary: 'repair-reserve', name: 'repair reserve not required once per moment', file: 'lib/generation-proposal.ts',
    from: '    for (const row of perMoment.values()) if (row.candidates !== 2 || row.repairs !== 1) return null;',
    to: '    for (const row of perMoment.values()) if (row.candidates !== 2) return null;',
  },
  {
    boundary: 'repair-reserve', name: 'a repair may arrive marked active', file: 'lib/generation-proposal.ts',
    from: '    if (v.active_by_default !== false) return null;',
    to: '    if (false && v.active_by_default !== false) return null;',
  },
  {
    boundary: 'repair-reserve', name: 'a repair may also claim to be a candidate', file: 'lib/generation-proposal.ts',
    from: '    if (v.variant !== undefined || v.timestamp !== undefined || v.candidate_ordinal !== undefined) return null;',
    to: '    if (false) return null;',
  },
  {
    boundary: 'repair-reserve', name: 'compiler-stated candidate/repair counts unchecked', file: 'lib/generation-proposal.ts',
    from: '    if (v.candidate_task_count !== candidates.length || v.repair_task_count !== repairs.length) return null;',
    to: '    if (false) return null;',
  },
  {
    boundary: 'repair-reserve', name: 'any mode may carry a repair reserve', file: 'lib/generation-proposal.ts',
    from: '  } else if (repairs.length !== 0) {',
    to: '  } else if (false) {',
  },
  {
    boundary: 'repair-reserve', name: 'unknown task kinds are guessed into a candidate', file: 'lib/generation-proposal.ts',
    from: "  if (kind !== undefined && kind !== 'candidate' && kind !== 'repair') return null;",
    to: "  if (false && kind !== undefined && kind !== 'candidate' && kind !== 'repair') return null;",
  },
  {
    boundary: 'mode-preview', name: 'Production accepts a rich task graph', file: 'lib/generation-proposal.ts',
    from: "  if (v.quality_mode === 'production') {", to: "  if (false && v.quality_mode === 'production') {",
  },
  {
    boundary: 'action-response', name: 'HTTP status ignored', file: 'lib/generation-proposal-state.ts',
    from: '  if (!responseOk || (asRecord && asRecord.ok !== true)) {', to: '  if (asRecord && asRecord.ok !== true) {',
  },
  {
    boundary: 'action-response', name: 'requested proposal identity ignored', file: 'lib/generation-proposal-state.ts',
    from: '  const vm = parseGenerationProposalResponse(body, expectedProposalId);', to: '  const vm = parseGenerationProposalResponse(body);',
  },
  {
    boundary: 'action-response', name: 'expected lifecycle ignored', file: 'lib/generation-proposal-state.ts',
    from: "  if (vm.lifecycle !== expectedLifecycle) return { outcome: 'unconfirmed' };", to: "  if (false && vm.lifecycle !== expectedLifecycle) return { outcome: 'unconfirmed' };",
  },
  {
    boundary: 'completed-evidence', name: 'completed bijection skipped', file: 'lib/generation-proposal.ts',
    from: "  if (progress === 'completed') {", to: "  if (false && progress === 'completed') {",
  },
  {
    boundary: 'completed-evidence', name: 'succeeded event artifact becomes optional', file: 'lib/generation-proposal.ts',
    from: "  } else if (v.status !== 'succeeded' || artifactSha256 === null) return null;", to: "  } else if (v.status !== 'succeeded') return null;",
  },
  {
    boundary: 'completed-evidence', name: 'event type allowlist removed', file: 'lib/generation-proposal.ts',
    from: "  if (v.event_type !== 'task_created' && v.event_type !== 'task_succeeded') return null;", to: "  if (false && v.event_type !== 'task_created' && v.event_type !== 'task_succeeded') return null;",
  },
];

let killed = 0;
for (const mutation of mutations) {
  const dir = mkdtempSync(join(tmpdir(), 'implexa-dashboard-generation-mutant-'));
  try {
    mkdirSync(join(dir, 'lib'));
    for (const file of files) cpSync(join(root, file), join(dir, file));
    const target = join(dir, mutation.file);
    const source = readFileSync(target, 'utf8');
    if (!source.includes(mutation.from)) throw new Error(`Mutation anchor missing: ${mutation.name}`);
    writeFileSync(target, source.replace(mutation.from, mutation.to));
    const result = spawnSync(process.execPath, ['--test', join(dir, 'lib/generation-proposal.test.ts')], {
      cwd: dir, encoding: 'utf8', env: process.env,
    });
    if (result.status === 0) {
      process.stderr.write(result.stdout);
      process.stderr.write(result.stderr);
      throw new Error(`SURVIVED [${mutation.boundary}] ${mutation.name}`);
    }
    killed += 1;
    console.log(`KILLED [${mutation.boundary}] ${mutation.name}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log(`Mutation result: ${killed}/${mutations.length} killed across 3 boundaries.`);
