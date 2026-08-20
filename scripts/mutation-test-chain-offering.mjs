#!/usr/bin/env node
/**
 * Mutation harness for the chain offering surface.
 *
 * Boundaries:
 *   parser    — a permissive parser renders a chain the server did not
 *               publish: fabricated ceilings, a partial chain, invented
 *               component evidence, or a dropped disclosure.
 *   privacy   — an unauthorized viewer must get nonexistence, and no identity
 *               or creator material may render.
 *   consent   — acquisition pins the exact version + digest, cannot
 *               double-fire, and removal is confirmed and history-preserving.
 *   collapse  — evidence stays two-axis per component; no blending.
 *
 * Full-tree copy, node_modules symlinked, all-anchor pre-flight, green
 * baseline required before any mutation.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const suites = [
  'lib/agent-chain-offerings.test.ts',
  'app/(dashboard)/_components/chain-offering-resume.render.test.ts',
  'app/(dashboard)/_components/chain-offering-boundaries.test.ts',
];

const PARSER = 'lib/agent-chain-offerings.ts';
const RESUME = 'app/(dashboard)/_components/chain-offering-resume.tsx';

const mutants = [
  ['parser', 'an unsupported contract version is accepted', PARSER,
    "  if (value.contractVersion !== CHAIN_OFFERING_CONTRACT_VERSION) return unavailable('The chain offering uses an unsupported contract version.');",
    '  // version unchecked'],
  ['parser', 'a producer-impossible admission is accepted', PARSER,
    "  if (value.admission !== 'private_preview' && value.admission !== 'admitted') return unavailable('The chain offering could not be read.');",
    '  // admission vocabulary unchecked'],
  ['parser', 'the private-preview marker contradicts admission', PARSER,
    "  if (value.privatePreview !== (value.admission === 'private_preview')) return unavailable('The chain offering could not be read.');",
    '  // derived preview marker unchecked'],
  ['parser', 'a partial chain renders as whole', PARSER,
    "  if (!Array.isArray(value.orderedChain) || value.orderedChain.length !== 2) return unavailable('The chain offering could not be read.');",
    '  // chain length unchecked'],
  ['parser', 'a component with unreadable evidence keeps its node', PARSER,
    "  const evidence = parseEvidenceChannels(value.evidenceChannels);\n  if (evidence.status !== 'ready') return null;",
    "  const evidence = parseEvidenceChannels(value.evidenceChannels);\n  if (evidence.status !== 'ready') return { status: 'ready', channels: { builderTraining: { status: 'unknown' }, neutralBenchmark: { status: 'unknown' }, customerField: { status: 'unknown' }, personalFit: { status: 'unavailable' } } } as never && null;"],
  ['parser', 'fabricated zero-default over non-zero ceilings is believed', PARSER,
    '    || ceiling.zeroDefault !== (ceiling.maxProviderCalls === 0 && ceiling.maxSpendMinor === 0)) {',
    '    || false) {'],
  ['parser', 'the local-paths disclosure becomes optional', PARSER,
    "    || !requiredInput.disclosure.includes('Local paths are never sent to the server')) {",
    '    || false) {'],
  ['parser', 'the history-preservation language becomes optional', PARSER,
    "  if (typeof value.historyLanguage !== 'string' || !value.historyLanguage.includes('removes access, not history')) {",
    "  if (typeof value.historyLanguage !== 'string') {"],
  ['parser', 'a reordered chain is accepted', PARSER,
    "  if (value.role !== (ordinal === 0 ? 'generator' : 'primary')) return null;",
    '  // role order unchecked'],
  ['parser', 'one component playing both roles is accepted', PARSER,
    "  if (generator.version.id === primary.version.id) return unavailable('The chain offering could not be read.');",
    '  // duplicate component unchecked'],
  ['parser', 'an unknown quality mode is accepted', PARSER,
    "    || qualityModes.some((mode) => !['fast', 'balanced', 'best'].includes(String(mode)))",
    '    || false'],
  ['parser', 'an unknown engine is accepted', PARSER,
    "    || supportedEngines.some((engine) => !['claude', 'codex'].includes(String(engine)))",
    '    || false'],
  ['parser', 'an unsupported evidence contract is accepted', PARSER,
    "  if (value.evidenceContractVersion !== 'marketplace-evidence-channels.v1') return unavailable('The chain offering could not be read.');",
    '  // evidence contract unchecked'],
  ['consent', 'old acquisition authority moves to the latest version', PARSER,
    "    const isExact = raw.offeringVersionId.toLowerCase() === version.id.toLowerCase()\n      && raw.offeringDigest === version.digest;",
    '    const isExact = true;'],
  ['privacy', 'a leaked creator path is rendered', PARSER,
    "  if (LEAK_RE.test(JSON.stringify(offering))) return unavailable('The chain offering could not be read.');",
    '  // leak scan removed'],
  ['consent', 'acquisition drops the digest pin', RESUME,
    "{ offeringVersionId: offering.version.id, offeringDigest: offering.version.digest }",
    "{ offeringVersionId: offering.version.id }"],
  ['consent', 'a double click acquires twice', RESUME,
    '    if (inFlight.current) return;',
    '    if (false) return;'],
  ['consent', 'an old acquisition can start the latest composition', RESUME,
    "  const acquired = installed && offering.acquisition?.authority === 'exact';",
    '  const acquired = installed;'],
  ['consent', 'removal needs no confirmation', RESUME,
    'disabled={busy || !confirmUninstall}',
    'disabled={busy}'],
  ['collapse', 'the failure explanation disappears', RESUME,
    'If Step 1 does not succeed, Step 2 never runs and remaining reservations are released.',
    'Steps run in order.'],
  ['collapse', 'the no-blending language disappears', RESUME,
    'Evidence is counted separately per component and per source. Implexa does not combine them into a score, rating, or rank.',
    'Evidence is summarized for you.'],
  ['collapse', 'a withheld personal fit renders numbers', RESUME,
    "            {channel.status === 'unavailable' ? (",
    '            {false ? ('],
];

function run(cwd) {
  const env = { ...process.env, IMPLEXA_MUTANT_ROOT: cwd, IMPLEXA_SOURCE_ROOT: root, NODE_PATH: path.join(root, 'node_modules') };
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, ['scripts/run-selected-tests.mjs', ...suites], {
    cwd, encoding: 'utf8', timeout: 180_000, killSignal: 'SIGKILL', env,
  });
}

const stale = [];
for (const [boundary, name, file, from] of mutants) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const first = source.indexOf(from);
  const matches = first === -1 ? 0 : (source.indexOf(from, first + 1) === -1 ? 1 : 2);
  if (matches !== 1) stale.push(`  ${matches === 2 ? '2+' : matches} matches — [${boundary}] ${name} (${file})`);
}
if (stale.length) {
  console.error(`${stale.length} mutant anchor(s) no longer match their source exactly once:\n${stale.join('\n')}`);
  process.exit(1);
}
console.log(`pre-flight: all ${mutants.length} mutation anchors are unique`);

const baseline = run(root);
if (baseline.status !== 0) {
  console.error(`HARNESS BROKEN: the UNMUTATED suite fails.\n${baseline.stdout.slice(-3000)}\n${baseline.stderr.slice(-2000)}`);
  process.exit(1);
}
console.log('baseline green: chain offering suites pass unmutated');

let killed = 0;
for (const [boundary, name, file, from, to] of mutants) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'implexa-chain-offering-mutant-'));
  try {
    fs.cpSync(root, dir, { recursive: true, filter: (src) => !['node_modules', '.git', '.next', 'dist', '.vercel'].includes(path.basename(src)) });
    fs.symlinkSync(path.join(root, 'node_modules'), path.join(dir, 'node_modules'));
    const target = path.join(dir, file);
    const source = fs.readFileSync(target, 'utf8');
    fs.writeFileSync(target, source.replace(from, to));
    const result = run(dir);
    if (result.status === 0) { console.error(`SURVIVED [${boundary}] ${name}`); process.exitCode = 1; }
    else { killed += 1; console.log(`killed [${boundary}] ${name}`); }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
if (process.exitCode) process.exit(process.exitCode);
console.log(`Mutation result: ${killed}/${mutants.length} killed across ${new Set(mutants.map(([b]) => b)).size} boundaries.`);
