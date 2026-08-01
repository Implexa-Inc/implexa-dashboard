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
    boundary: 'mode-preview', name: 'Professional becomes approvable', file: 'lib/generation-proposal.ts',
    from: "  if (v.quality_mode === 'professional') {", to: "  if (false && v.quality_mode === 'professional') {",
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
