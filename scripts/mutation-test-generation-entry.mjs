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
    '      || task.window.startSeconds !== expected.moment.startSeconds',
    '      || false'],
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
