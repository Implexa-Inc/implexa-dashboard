#!/usr/bin/env node

import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXPECTED_BACKEND_HEAD = '19fc508091134b09a4a61799d411a18eccdef332';
const dashboardRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const backendRoot = resolve(process.env.IMPLEXA_BACKEND_DIR || join(dashboardRoot, '..', 'implexa-backend'));
const actualHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: backendRoot, encoding: 'utf8' }).trim();
if (actualHead !== EXPECTED_BACKEND_HEAD) {
  throw new Error(`Refusing fixture generation: backend HEAD ${actualHead} != ${EXPECTED_BACKEND_HEAD}`);
}

const require = createRequire(import.meta.url);
const { compileGenerationProposal } = require(join(backendRoot, 'src/lib/generation-quality-compiler.js'));
const moments = [
  { id: 'hook', prompt: 'Founder opens laptop in dim room, screen glow on face', start_seconds: 0, end_seconds: 5, ratio: '720:1280' },
  { id: 'build', prompt: 'Terminal scrolling with agent build output, close-up', start_seconds: 12, end_seconds: 17, ratio: '720:1280' },
  { id: 'result', prompt: 'Phone screen showing finished reel, hand scrolling', start_seconds: 30, end_seconds: 35, ratio: '720:1280' },
];

function compile(qualityMode) {
  const result = compileGenerationProposal({ capabilityKey: 'video.generate_broll', qualityMode, moments });
  if (!result?.ok || !result.proposal) throw new Error(`Compiler refused ${qualityMode}: ${result?.error || 'unknown_error'}`);
  return result.proposal;
}

const header = `/**
 * EXACT compiler fixtures generated from backend PR #130 head
 * ${EXPECTED_BACKEND_HEAD} (generation-quality.v1 / 2026-08-01).
 * Run with IMPLEXA_BACKEND_DIR=/path/to/implexa-backend npm run fixtures:generation.
 * The generator refuses any other backend HEAD.
 */\n\n`;
const blocks = [
  ['FAST_COMPILED', compile('fast')],
  ['PROFESSIONAL_COMPILED', compile('professional')],
  ['PRODUCTION_COMPILED', compile('production')],
].map(([name, value]) => `export const ${name} = ${JSON.stringify(value, null, 2)} as const;`).join('\n\n');
const output = `${header}${blocks}\n`;
const target = join(dashboardRoot, 'lib/generation-proposal.fixtures.ts');

if (process.argv.includes('--check')) {
  if (readFileSync(target, 'utf8') !== output) throw new Error('Generation proposal fixtures are stale.');
  console.log(`fixtures match backend ${EXPECTED_BACKEND_HEAD}`);
} else {
  writeFileSync(target, output);
  console.log(`regenerated ${target} from backend ${EXPECTED_BACKEND_HEAD}`);
}
