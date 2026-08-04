#!/usr/bin/env node

import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXPECTED_BACKEND_HEAD = '7890af350ccfe9eaf4dd658c77342357e7653aab';
const dashboardRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const backendRoot = resolve(process.env.IMPLEXA_BACKEND_DIR || join(dashboardRoot, '..', 'implexa-backend'));
const actualHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: backendRoot, encoding: 'utf8' }).trim();
if (actualHead !== EXPECTED_BACKEND_HEAD) {
  throw new Error(
    `Refusing fixture generation: backend HEAD ${actualHead} != ${EXPECTED_BACKEND_HEAD}. `
    + `Point IMPLEXA_BACKEND_DIR at a checkout of that commit (e.g. the Wave 1 Session A `
    + `worktree) — the default ${backendRoot} may be on an unrelated branch.`,
  );
}

const require = createRequire(import.meta.url);
const { compileGenerationProposal } = require(join(backendRoot, 'src/lib/generation-quality-compiler.js'));
const moments = [
  { id: 'hook', prompt: 'Founder opens laptop in dim room, screen glow on face', start_seconds: 0, end_seconds: 5, ratio: '720:1280' },
  { id: 'build', prompt: 'Terminal scrolling with agent build output, close-up', start_seconds: 12, end_seconds: 17, ratio: '720:1280' },
  { id: 'result', prompt: 'Phone screen showing finished reel, hand scrolling', start_seconds: 30, end_seconds: 35, ratio: '720:1280' },
];

// The exact shape the browser entry point builds: ONE moment, a 3-second window.
// Professional compiles it to two candidates plus one inactive repair reserve —
// 12 credits/second x 3s x 3 tasks = 108, the live authorized ceiling.
const liveMoments = [
  { id: 'hook', prompt: 'a camera moving over bay area bridge', start_seconds: 0, end_seconds: 3, ratio: '720:1280' },
];

function compile(qualityMode, { available = false, momentSet = moments } = {}) {
  const result = compileGenerationProposal(
    { capabilityKey: 'video.generate_broll', qualityMode, moments: momentSet },
    // Professional availability is resolved per user from server flags AND a
    // machine attestation. Both dispositions are real responses, so both are
    // fixtures: the parser must accept an APPROVABLE Professional proposal, not
    // only the unavailable-with-graph preview it was first written against.
    available ? { professionalAvailability: { available: true, required_missing_capabilities: [] } } : undefined,
  );
  if (!result?.ok || !result.proposal) throw new Error(`Compiler refused ${qualityMode}: ${result?.error || 'unknown_error'}`);
  return result.proposal;
}

/** A fixture that silently drifts off the authorized ceiling is worse than none. */
function assertLiveShape(proposal) {
  const candidates = proposal.tasks.filter((task) => task.task_kind === 'candidate');
  const repairs = proposal.tasks.filter((task) => task.task_kind === 'repair');
  if (candidates.length !== 2 || repairs.length !== 1 || proposal.tasks.length !== 3) {
    throw new Error(`Live Professional shape must be 2 candidates + 1 repair, got ${JSON.stringify(proposal.tasks.map((t) => t.task_kind))}`);
  }
  if (repairs[0].active_by_default !== false) throw new Error('The repair task must be inactive by default.');
  if (proposal.availability !== true || proposal.unavailable_reason !== null) {
    throw new Error('The live Professional fixture must be the APPROVABLE disposition.');
  }
  if (proposal.maximum_credits !== 108) throw new Error(`Live Professional must be 108 credits, got ${proposal.maximum_credits}`);
  return proposal;
}

const header = `/**
 * EXACT compiler fixtures generated from backend main
 * ${EXPECTED_BACKEND_HEAD} (generation-quality.v1 / 2026-08-01).
 * Run with IMPLEXA_BACKEND_DIR=/path/to/implexa-backend npm run fixtures:generation.
 * The generator refuses any other backend HEAD.
 *
 * Professional compiles a bounded repair reserve into \`tasks\` alongside the two
 * candidates, so each moment carries THREE tasks. PROFESSIONAL_LIVE_COMPILED is
 * the single-moment 3-second shape the browser entry point actually builds, in
 * its approvable disposition, at the 108-credit ceiling.
 */\n\n`;
const blocks = [
  ['FAST_COMPILED', compile('fast')],
  ['PROFESSIONAL_COMPILED', compile('professional')],
  ['PROFESSIONAL_AVAILABLE_COMPILED', compile('professional', { available: true })],
  ['PRODUCTION_COMPILED', compile('production')],
  // The single-moment set the browser entry point actually builds. The entry
  // tests bind against these rather than slicing the multi-moment fixtures down
  // by hand — a hand-sliced Professional proposal drops the repair reserve and
  // is a document the compiler would never emit.
  ['FAST_LIVE_COMPILED', compile('fast', { momentSet: liveMoments })],
  ['PROFESSIONAL_LIVE_COMPILED', assertLiveShape(compile('professional', { available: true, momentSet: liveMoments }))],
  ['PROFESSIONAL_LIVE_UNAVAILABLE_COMPILED', compile('professional', { momentSet: liveMoments })],
  ['PRODUCTION_LIVE_COMPILED', compile('production', { momentSet: liveMoments })],
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
