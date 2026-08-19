#!/usr/bin/env node
/**
 * Mutation harness for the canonical four-channel agent resume.
 *
 * The boundaries graded here are the ones the contract exists to hold:
 *   parser      — a permissive parser turns "the server did not tell us" into
 *                 "this agent has no evidence", which is a claim nobody made.
 *   collapse    — either axis flattening into the other loses the whole point
 *                 of publishing provenance separately from evidence type.
 *   privacy     — personal fit is the viewer's own slice and must never read as
 *                 shared, public, or another organization's.
 *   version     — evidence belongs to one exact immutable version.
 *   fabrication — no count, score, rating or rank may be invented anywhere.
 *
 * Each mutant runs in a full-tree copy with node_modules symlinked. Anchors are
 * validated up front, the unmutated suites must be green first, and every
 * mutant must make at least one suite red.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const suites = [
  'lib/agent-evidence-channels.test.ts',
  // The shared cross-repo corpus. The backend runs the mirror of this suite
  // against the same file, so a rule on only one side is a failing test.
  'lib/agent-evidence-channel-refusals.test.ts',
  'app/(dashboard)/_components/agent-resume-evidence-channels-render.test.ts',
  'app/(dashboard)/_components/agent-resume-render.test.ts',
  'app/(dashboard)/_components/agent-marketplace-boundaries.test.ts',
];

const PARSER = 'lib/agent-evidence-channels.ts';
const RESUME = 'app/(dashboard)/_components/agent-resume.tsx';
const CORPUS = ['lib/agent-evidence-channel-refusals.test.ts'];

const mutants = [
  // ---- parser permissiveness ----------------------------------------------
  ['parser', 'an unsupported contract version is accepted', PARSER,
    "  if (value.contractVersion !== EVIDENCE_CHANNELS_CONTRACT_VERSION) {\n    return { status: 'unavailable', reason: 'Channel evidence uses an unsupported contract version.' };\n  }",
    '  if (false) { /* version unchecked */ }'],
  ['parser', 'an unexpected top-level key is ignored instead of refused', PARSER,
    "  if (!isPlainObject(value) || !keysAre(value, ['contractVersion', 'channels'])) {",
    '  if (!isPlainObject(value)) {'],
  ['parser', 'a missing or invented channel is tolerated', PARSER,
    '  if (!isPlainObject(value.channels) || !keysAre(value.channels, EVIDENCE_CHANNEL_KEYS)) {',
    '  if (!isPlainObject(value.channels)) {'],
  ['parser', 'an absent projection is reported as merely unreadable', PARSER,
    "  if (value === undefined || value === null) {\n    return { status: 'unavailable', reason: 'This agent version did not publish channel evidence.' };\n  }",
    '  if (false) { /* absent is not distinguished */ }'],
  ['parser', 'one bad channel yields a partial projection', PARSER,
    "    if (!parsed) return { status: 'unavailable', reason: 'Channel evidence could not be read.' };",
    '    if (!parsed) continue;'],
  ['parser', 'an unbounded timestamp is published', PARSER,
    '  if (value.latestEvidenceAt !== null && !isCanonicalUtcDay(value.latestEvidenceAt)) return null;',
    '  if (false) return null;'],
  ['parser', 'a channel shape with unexpected keys is accepted', PARSER,
    '  if (!keysAre(value, CHANNEL_ENTRY_KEYS)) return null;',
    '  if (false) return null;'],

  // ---- marketplace-evidence-channels.v1 semantics --------------------------
  ['semantics', 'a certification claim V1 cannot make is accepted', PARSER,
    "  if (evidence.certification.status !== 'unknown' || evidence.certification.count !== 0) return null;",
    '  if (false) return null;'],
  ['semantics', 'a measured neutral benchmark is accepted', PARSER,
    "    if (value.status !== 'unknown' || exactVersionRunCount !== 0 || value.latestEvidenceAt !== null) return null;",
    '    if (false) return null;'],
  ['semantics', 'an unknown channel may hold measured evidence', PARSER,
    "  if (value.status === 'unknown') {\n    if (measurable.some((typeKey) => evidence[typeKey].status !== 'unknown')) return null;\n  } else if (measurable.some((typeKey) => evidence[typeKey].status === 'unknown')) return null;",
    '  if (false) return null;'],
  ['semantics', 'a single evidence type may be withheld', PARSER,
    "  if (value.status === 'unavailable') return null;", '  if (false) return null;'],
  ['semantics', 'a date that only looks like a day is published', PARSER,
    '  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;', '  return true;'],
  ['semantics', 'a normalized-but-noncanonical date is accepted', PARSER,
    'new Date(parsed).toISOString() === value;', 'true;'],

  // ---- ONE MUTANT PER GUARD, GRADED AGAINST THE CORPUS ALONE ---------------
  // The isolation proof, and the reason "one changed path" was not enough.
  // Deleting a single guard must make that guard's corpus cases PARSE, turning
  // the corpus suite red. A SURVIVOR means the rule has no isolated case — some
  // neighbouring invariant masks it — and the corpus claimed coverage it did
  // not have.

  ['corpus', 'isolates top-level-shape', PARSER,
    "  if (!isPlainObject(value) || !keysAre(value, ['contractVersion', 'channels'])) {",
    "  if (false) {", CORPUS],
  ['corpus', 'isolates contract-version', PARSER,
    "  if (value.contractVersion !== EVIDENCE_CHANNELS_CONTRACT_VERSION) {",
    "  if (false) {", CORPUS],
  ['corpus', 'isolates channels-whitelist', PARSER,
    "  if (!isPlainObject(value.channels) || !keysAre(value.channels, EVIDENCE_CHANNEL_KEYS)) {",
    "  if (false) {", CORPUS],
  ['corpus', 'isolates withheld-form-status', PARSER,
    "    return key === 'personalFit' && value.status === 'unavailable' ? { status: 'unavailable' } : null;",
    "    return key === 'personalFit' ? { status: 'unavailable' } : null;", CORPUS],
  ['corpus', 'isolates withheld-personal-fit-only', PARSER,
    "    return key === 'personalFit' && value.status === 'unavailable' ? { status: 'unavailable' } : null;",
    "    return value.status === 'unavailable' ? { status: 'unavailable' } : null;", CORPUS],
  ['corpus', 'isolates channel-shape', PARSER,
    "  if (!keysAre(value, CHANNEL_ENTRY_KEYS)) return null;",
    "  if (false) return null;", CORPUS],
  ['corpus', 'isolates channel-status-vocabulary', PARSER,
    "  if (value.status === 'unavailable' || !CHANNEL_STATUSES.includes(value.status as EvidenceStatus)) return null;",
    "  if (value.status === 'unavailable') return null;", CORPUS],
  ['corpus', 'isolates answered-channel-unavailable', PARSER,
    "  if (value.status === 'unavailable' || !CHANNEL_STATUSES.includes(value.status as EvidenceStatus)) return null;",
    "  if (!CHANNEL_STATUSES.includes(value.status as EvidenceStatus)) return null;", CORPUS],
  ['corpus', 'isolates run-count-bounded', PARSER,
    "  const exactVersionRunCount = boundedCount(value.exactVersionRunCount);\n  if (exactVersionRunCount === null) return null;",
    "  const exactVersionRunCount = Number(value.exactVersionRunCount);", CORPUS],
  ['corpus', 'isolates timestamp-canonical-day', PARSER,
    "  if (value.latestEvidenceAt !== null && !isCanonicalUtcDay(value.latestEvidenceAt)) return null;",
    "  if (false) return null;", CORPUS],
  ['corpus', 'isolates evidence-keys-whitelist', PARSER,
    "  if (!isPlainObject(value.evidence) || !keysAre(value.evidence, EVIDENCE_TYPE_KEYS)) return null;",
    "  if (!isPlainObject(value.evidence)) return null;", CORPUS],
  ['corpus', 'isolates evidence-entry-shape', PARSER,
    "  if (!isPlainObject(value) || !keysAre(value, EVIDENCE_TYPE_ENTRY_KEYS)) return null;",
    "  if (!isPlainObject(value)) return null;", CORPUS],
  ['corpus', 'isolates evidence-status-vocabulary', PARSER,
    "  if (!CHANNEL_STATUSES.includes(value.status as EvidenceStatus)) return null;",
    "  if (false) return null;", CORPUS],
  ['corpus', 'isolates evidence-count-bounded', PARSER,
    "  const count = boundedCount(value.count);\n  if (count === null) return null;",
    "  const count = Number(value.count);", CORPUS],
  ['corpus', 'isolates evidence-type-withheld', PARSER,
    "  if (value.status === 'unavailable') return null;",
    "  if (false) return null;", CORPUS],
  ['corpus', 'isolates evidence-type-coherence', PARSER,
    "  if (value.status === 'evidence_available' && count === 0) return null;\n  if (value.status !== 'evidence_available' && count !== 0) return null;",
    "  if (false) return null;", CORPUS],
  ['corpus', 'isolates count-within-runs', PARSER,
    "  if (favorable > 0 && favorable > exactVersionRunCount) return null;",
    "  if (false) return null;", CORPUS],
  ['corpus', 'isolates channel-coherence', PARSER,
    "  if ((value.status === 'evidence_available') !== anyFavorable) return null;",
    "  if (false) return null;", CORPUS],
  ['corpus', 'isolates certification-authority', PARSER,
    "  if (evidence.certification.status !== 'unknown' || evidence.certification.count !== 0) return null;",
    "  if (false) return null;", CORPUS],
  ['corpus', 'isolates neutral-benchmark-authority', PARSER,
    "  if (key === 'neutralBenchmark') {",
    "  if (false) {", CORPUS],
  ['corpus', 'isolates unknown-channel-coherence', PARSER,
    "    if (measurable.some((typeKey) => evidence[typeKey].status !== 'unknown')) return null;",
    "    if (false) return null;", CORPUS],
  ['corpus', 'isolates measured-channel-coherence', PARSER,
    "  } else if (measurable.some((typeKey) => evidence[typeKey].status === 'unknown')) return null;",
    "  } else if (false) return null;", CORPUS],

  // ---- fabricated counts ---------------------------------------------------
  ['fabrication', 'a negative or fractional count is accepted', PARSER,
    '  return typeof value === \'number\' && Number.isSafeInteger(value) && value >= 0 ? value : null;',
    "  return typeof value === 'number' ? value : null;"],
  ['fabrication', 'more favorable runs than runs is published', PARSER,
    '  if (favorable > 0 && favorable > exactVersionRunCount) return null;',
    '  if (favorable > 0 && false) return null;'],
  ['fabrication', 'a status that contradicts its own counts is accepted', PARSER,
    "  if ((value.status === 'evidence_available') !== anyFavorable) return null;",
    '  if (false) return null;'],
  ['fabrication', 'an evidence type may claim evidence while counting zero', PARSER,
    "  if (value.status === 'evidence_available' && count === 0) return null;\n  if (value.status !== 'evidence_available' && count !== 0) return null;",
    '  if (false) return null;'],
  ['fabrication', 'a zero count renders as positive evidence', RESUME,
    "  if (entry.status === 'evidence_available' && Number(entry.count) > 0) return `${entry.count} run${entry.count === 1 ? '' : 's'}`;",
    "  if (entry.status === 'evidence_available' && Number(entry.count) >= 0) return `${entry.count} run${entry.count === 1 ? '' : 's'}`;"],

  // ---- channel collapse ----------------------------------------------------
  ['collapse', 'the provenance axis collapses to one card', RESUME,
    '{EVIDENCE_CHANNEL_KEYS.map((key) => {', '{EVIDENCE_CHANNEL_KEYS.slice(0, 1).map((key) => {'],
  ['collapse', 'the evidence-type axis collapses inside a card', RESUME,
    '{EVIDENCE_TYPE_KEYS.map((typeKey) => (', '{EVIDENCE_TYPE_KEYS.slice(0, 1).map((typeKey) => ('],
  ['collapse', 'unknown is described as a measured zero', RESUME,
    "  return entry.status === 'unknown' ? 'not measured' : 'none yet';", "  return 'none yet';"],
  ['collapse', 'an unmeasured benchmark reports a run count', RESUME,
    "{channel.status === 'unknown' ? 'Not measured' : `${channel.exactVersionRunCount} exact-version run${channel.exactVersionRunCount === 1 ? '' : 's'}`}",
    '{`${channel.exactVersionRunCount} exact-version run${channel.exactVersionRunCount === 1 ? \'\' : \'s\'}`}'],
  ['collapse', 'the no-blending disclaimer is dropped', RESUME,
    'Implexa does not combine them into a score, rating, or rank.', 'Evidence is summarized for you.'],

  // ---- personal-fit privacy ------------------------------------------------
  ['privacy', 'a withheld personal fit is rendered as measured zero', RESUME,
    "                  {channel.status === 'unavailable' ? (", '                  {false ? ('],
  ['privacy', 'personal fit is described as shared rather than private', RESUME,
    'Private to you — the builder and other buyers never see it.',
    'Shared with everyone who views this agent.'],
  ['privacy', 'a public channel may be withheld like personal fit', PARSER,
    "    return key === 'personalFit' && value.status === 'unavailable' ? { status: 'unavailable' } : null;",
    "    return value.status === 'unavailable' ? { status: 'unavailable' } : null;"],

  // ---- version mixing ------------------------------------------------------
  ['version', 'an unreadable projection renders cards anyway', RESUME,
    "          {evidenceChannels.status === 'ready' ? (", '          {true ? ('],
  ['version', 'the resume reads channels from somewhere other than this agent', RESUME,
    '  const evidenceChannels = parseEvidenceChannels(agent.evidenceChannels);',
    '  const evidenceChannels = parseEvidenceChannels(agent.trust);'],
];

function run(cwd, only = suites) {
  const env = { ...process.env, IMPLEXA_MUTANT_ROOT: cwd, IMPLEXA_SOURCE_ROOT: root, NODE_PATH: path.join(root, 'node_modules') };
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, ['scripts/run-selected-tests.mjs', ...only], {
    cwd, encoding: 'utf8', timeout: 180_000, killSignal: 'SIGKILL', env,
  });
}

// PRE-FLIGHT. A drifted anchor grades nothing while still reporting a kill, so
// name every one of them up front rather than one per full run.
const stale = [];
for (const [boundary, name, file, from] of mutants) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const first = source.indexOf(from);
  const matches = first === -1 ? 0 : (source.indexOf(from, first + 1) === -1 ? 1 : 2);
  if (matches !== 1) stale.push(`  ${matches === 2 ? '2+' : matches} matches — [${boundary}] ${name} (${file})`);
}
if (stale.length) {
  process.stderr.write(`${stale.length} mutant anchor(s) no longer match their source exactly once:\n${stale.join('\n')}\n`);
  process.exit(1);
}
process.stdout.write(`pre-flight: all ${mutants.length} mutation anchors are unique\n`);

const baseline = run(root);
if (baseline.status !== 0) {
  process.stderr.write(`HARNESS BROKEN: the UNMUTATED suite fails — nothing below could be a real kill.\n${baseline.stdout.slice(-4000)}\n${baseline.stderr.slice(-2000)}`);
  process.exit(1);
}
process.stdout.write('baseline green: agent resume evidence-channel suites pass unmutated\n');

let killed = 0;
for (const [boundary, name, file, from, to] of mutants) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'implexa-evidence-channels-mutant-'));
  try {
    fs.cpSync(root, dir, { recursive: true, filter: (src) => !['node_modules', '.git', '.next', 'dist', '.vercel'].includes(path.basename(src)) });
    fs.symlinkSync(path.join(root, 'node_modules'), path.join(dir, 'node_modules'));
    const target = path.join(dir, file);
    const source = fs.readFileSync(target, 'utf8');
    fs.writeFileSync(target, source.replace(from, to));
    const result = run(dir, boundary === 'corpus' ? CORPUS : suites);
    if (result.status === 0) { process.stderr.write(`SURVIVED [${boundary}] ${name}\n`); process.exitCode = 1; }
    else { killed += 1; process.stdout.write(`killed [${boundary}] ${name}\n`); }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const boundaries = new Set(mutants.map(([boundary]) => boundary)).size;
if (process.exitCode) process.exit(process.exitCode);
process.stdout.write(`Mutation result: ${killed}/${mutants.length} killed across ${boundaries} boundaries.\n`);
