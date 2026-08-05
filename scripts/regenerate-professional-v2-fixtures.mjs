#!/usr/bin/env node
/**
 * Generate lib/professional-v2.fixtures.ts from the REAL backend producer,
 * pinned to one exact commit.
 *
 * WHY THIS SHAPE
 *
 * Nothing in this file is hand-written wire text. Every document is produced by
 * calling the backend's own emitters — `generation-proposal.service.js`
 * preview/create/get and `professional-generation.js`
 * evaluateProfessionalAvailability — so the fixtures are the bytes a browser
 * actually receives, envelope included, not a transcription of a schema or a doc.
 * `preview` touches no database at all; `create` and `get` take an injectable
 * `db`, so the real code path runs against a fake table layer rather than a
 * hand-assembled envelope.
 *
 * Every BOUND is probed rather than transcribed: prompt ceiling, duration
 * bounds, moment count, variant range, ratio support and the derived-prompt
 * suffixes are discovered by asking the producer what it accepts. A bound that
 * moves in the backend moves here on the next regeneration instead of silently
 * disagreeing with the editor that enforces it.
 *
 * v1 documents are generated from the SAME pinned producer and are REAL:
 * Quick/fast, Professional v1 and Production, as previews, a create and a read.
 * The routing tests bind against these. Simplistic v1 stubs are what let routing
 * mutants survive before — a stub that omits `stages`/`density_policy`/`tasks`
 * is rejected by shape alone, so a parser that routed on shape instead of on the
 * explicit discriminator still looked correct.
 *
 * NOTHING SENSITIVE TRAVELS. Ids are fixed synthetic UUIDs, the source artifact
 * is a relative path, and no local filesystem path, provider key, JWT or signed
 * URL is read or emitted. Run:
 *
 *   IMPLEXA_BACKEND_DIR=/path/to/implexa-backend@5cad520 \
 *     node scripts/regenerate-professional-v2-fixtures.mjs [--check]
 */

import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXPECTED_BACKEND_HEAD = '5cad5203342068981ec9e739792db52379235089';

const dashboardRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const backendRoot = resolve(process.env.IMPLEXA_BACKEND_DIR || join(dashboardRoot, '..', 'implexa-backend'));
const actualHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: backendRoot, encoding: 'utf8' }).trim();
if (actualHead !== EXPECTED_BACKEND_HEAD) {
  throw new Error(
    `Refusing fixture generation: backend HEAD ${actualHead} != ${EXPECTED_BACKEND_HEAD}. `
    + `Point IMPLEXA_BACKEND_DIR at a checkout of that commit — the default ${backendRoot} `
    + 'may be on an unrelated branch.',
  );
}

const require = createRequire(import.meta.url);
const proposalSvc = require(join(backendRoot, 'src/services/generation-proposal.service.js'));
const compiler = require(join(backendRoot, 'src/lib/generation-quality-compiler.js'));
const controlV2 = require(join(backendRoot, 'src/lib/professional-generation-v2.js'));
const professional = require(join(backendRoot, 'src/lib/professional-generation.js'));
const pricing = require(join(backendRoot, 'src/lib/provider-pricing.js'));

const CONTROL_V2 = professional.CONTROL_CONTRACT_V2;
const CONTROL_V1 = professional.CONTROL_CONTRACT_V1;

// ── synthetic, non-sensitive identity ────────────────────────────────────────
const USER_ID = '3f1c0a2e-6d4b-4a1e-9c77-2b8f5a0d4e11';
const ORG_ID = '9a2d5c31-77e4-4b6a-8f10-c3d9e2b41a55';
const SOURCE_RUN_ID = '7c9e1b44-2f36-4d58-9a02-6e5b8c1d3f77';
const PROPOSAL_ID = 'd41f6a80-5b2c-4e19-8f36-1a7c9d0e2b43';
const AGENT_SUBJECT = 'daily-ig-reel';
const CREATED_AT = '2026-08-04T17:00:00.000Z';
const NOW_MS = Date.parse(CREATED_AT);

/**
 * The minimum table layer `create`/`get` touch, answering exactly what the real
 * schema answers. Chainable because the service composes `.eq().eq().maybeSingle()`.
 */
function fakeDb({ proposalRow = null } = {}) {
  const stored = { row: proposalRow };
  const answer = (table) => {
    if (table === 'users') return { data: { organization_id: ORG_ID }, error: null };
    if (table === 'skill_runs') return { data: { id: SOURCE_RUN_ID }, error: null };
    if (table === 'run_requests') return { data: null, error: null };
    if (table === 'run_artifacts') {
      return {
        data: [{
          id: 'b8a1d20c-4e73-4f19-9c8a-5d2e6f70b134',
          status: 'validated',
          role: 'final_output',
          relative_path: 'output/final-reel.mp4',
        }],
        error: null,
      };
    }
    if (table === 'generation_proposals') return { data: stored.row, error: null };
    if (table === 'run_capability_task_events') return { data: [], error: null };
    return { data: null, error: null };
  };
  return {
    from(table) {
      const chain = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        order: () => answer(table),
        limit: () => answer(table),
        maybeSingle: async () => answer(table),
        single: async () => answer(table),
        insert(row) {
          // The DB assigns id and created_at; the service reads them back off the
          // returned row, so pinning them here keeps the fixture deterministic
          // without changing a single line of the code path under test.
          stored.row = { ...row, id: PROPOSAL_ID, created_at: CREATED_AT };
          return chain;
        },
        then: undefined,
      };
      return chain;
    },
    rpc: async () => ({ data: null, error: { message: 'not_exercised' } }),
  };
}

const availability = (overrides) => ({
  available: false,
  unavailable_reason: 'missing_required_professional_execution_capabilities',
  required_missing_capabilities: [],
  contract_version: 'professional-execution-capability.v1',
  availability_contract_version: professional.PROFESSIONAL_AVAILABILITY_CONTRACT_VERSION,
  ...overrides,
});

/**
 * The production disposition TODAY: all three server flags unset/false, so the
 * gate fails on the server side before any machine is consulted. Produced by the
 * real evaluator rather than asserted.
 */
const FLAGS_FALSE_AVAILABILITY = professional.evaluateProfessionalAvailability({
  capability: null,
  observedAt: null,
  machineAuthenticated: false,
  machineHealthy: false,
  serverCapabilities: { control_plane_v1: false, judge_evidence_v2: false, segment_projection_v1: false },
  controlContractVersion: CONTROL_V2,
  now: NOW_MS,
});

/** Every gate satisfied, including the v2-only Desktop feature. */
const V2_READY_AVAILABILITY = professional.evaluateProfessionalAvailability({
  capability: {
    contract_version: 'professional-execution-capability.v1',
    worker_version: '0.3.1',
    features: [...professional.REQUIRED_DESKTOP_FEATURES_V2],
    checked_at: new Date(NOW_MS - 60_000).toISOString(),
    evidence_digest: 'a'.repeat(64),
  },
  observedAt: new Date(NOW_MS - 60_000).toISOString(),
  machineAuthenticated: true,
  machineHealthy: true,
  serverCapabilities: { control_plane_v1: true, judge_evidence_v2: true, segment_projection_v1: true },
  controlContractVersion: CONTROL_V2,
  now: NOW_MS,
});

/** A v1-capable machine, asked for v2: available for v1, unavailable for v2. */
const V1_ONLY_MACHINE_ON_V2_AVAILABILITY = professional.evaluateProfessionalAvailability({
  capability: {
    contract_version: 'professional-execution-capability.v1',
    worker_version: '0.3.1',
    features: [...professional.REQUIRED_DESKTOP_FEATURES],
    checked_at: new Date(NOW_MS - 60_000).toISOString(),
    evidence_digest: 'b'.repeat(64),
  },
  observedAt: new Date(NOW_MS - 60_000).toISOString(),
  machineAuthenticated: true,
  machineHealthy: true,
  serverCapabilities: { control_plane_v1: true, judge_evidence_v2: true, segment_projection_v1: true },
  controlContractVersion: CONTROL_V2,
  now: NOW_MS,
});

// ── producers ────────────────────────────────────────────────────────────────

const resolver = (result) => async () => result;

async function preview({ moments, qualityMode = 'professional', controlContractVersion, availabilityResult }) {
  const out = await proposalSvc.preview({
    capabilityKey: 'video.generate_broll',
    qualityMode,
    ...(controlContractVersion === undefined ? {} : { controlContractVersion }),
    agentSubject: AGENT_SUBJECT,
    sourceRunId: SOURCE_RUN_ID,
    sourceRequestId: null,
    moments,
  }, { resolveProfessionalAvailability: resolver(availabilityResult ?? availability()) });
  if (!out || out.ok !== true) throw new Error(`preview refused: ${JSON.stringify(out)}`);
  return out;
}

async function create({ moments, qualityMode = 'professional', controlContractVersion, availabilityResult }) {
  const out = await proposalSvc.create({
    capabilityKey: 'video.generate_broll',
    qualityMode,
    ...(controlContractVersion === undefined ? {} : { controlContractVersion }),
    agentSubject: AGENT_SUBJECT,
    sourceRunId: SOURCE_RUN_ID,
    sourceRequestId: null,
    moments,
    userId: USER_ID,
  }, {
    db: fakeDb(),
    now: () => NOW_MS,
    resolveProfessionalAvailability: resolver(availabilityResult ?? availability()),
  });
  if (!out || out.ok !== true) throw new Error(`create refused: ${JSON.stringify(out)}`);
  return out;
}

/** The persisted read, driven through the same `create` row the service wrote. */
async function read({ moments, qualityMode = 'professional', controlContractVersion, availabilityResult }) {
  const db = fakeDb();
  const created = await proposalSvc.create({
    capabilityKey: 'video.generate_broll',
    qualityMode,
    ...(controlContractVersion === undefined ? {} : { controlContractVersion }),
    agentSubject: AGENT_SUBJECT,
    sourceRunId: SOURCE_RUN_ID,
    sourceRequestId: null,
    moments,
    userId: USER_ID,
  }, { db, now: () => NOW_MS, resolveProfessionalAvailability: resolver(availabilityResult ?? availability()) });
  if (!created || created.ok !== true) throw new Error(`create refused: ${JSON.stringify(created)}`);
  // `get` projects `awaiting_approval` → `expired` against the WALL CLOCK, which
  // it does not take as a parameter. Pinning the clock for the duration of the
  // call is what makes this fixture deterministic: regenerated tomorrow it would
  // otherwise capture an expired proposal and the awaiting-approval read would
  // quietly stop existing.
  const realNow = Date.now;
  Date.now = () => NOW_MS;
  let out;
  try {
    out = await proposalSvc.get({ userId: USER_ID, proposalId: PROPOSAL_ID }, { db });
  } finally {
    Date.now = realNow;
  }
  if (!out || out.ok !== true) throw new Error(`get refused: ${JSON.stringify(out)}`);
  return out;
}

// ── probes: every bound discovered, none transcribed ──────────────────────────

const baseMoment = (over = {}) => ({
  id: 'hook', prompt: 'a slow aerial push over a bay bridge at sunrise',
  start_seconds: 0, end_seconds: 3, ratio: '720:1280',
  variants_requested: 2, judge_mode: 'ranked', max_repairs: 1, ...over,
});

/** Does the real v2 request path accept this moment set? */
function v2Accepts(moments) {
  const normalized = compiler.normalizeV2RequestMoments(moments);
  if (!normalized.ok) return false;
  const compiled = compiler.compileGenerationProposalV2(
    { capabilityKey: 'video.generate_broll', executionMode: 'professional', moments: normalized.moments },
    { professionalAvailability: { available: true, required_missing_capabilities: [] } },
  );
  return compiled.ok === true;
}

function highestAccepted(from, to, build) {
  let best = null;
  for (let n = from; n <= to; n += 1) if (v2Accepts(build(n))) best = n;
  return best;
}

const PROMPT_MAX_CHARS = (() => {
  // Binary search the longest source prompt the request path accepts for the
  // cheapest moment shape (1 variant, no repair — the largest room available).
  let low = 1;
  let high = 4000;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (v2Accepts([baseMoment({ prompt: 'x'.repeat(mid), variants_requested: 1, judge_mode: 'off', max_repairs: 0 })])) low = mid;
    else high = mid - 1;
  }
  return low;
})();

const MIN_DURATION_SECONDS = (() => {
  for (let tenths = 1; tenths <= 200; tenths += 1) {
    if (v2Accepts([baseMoment({ start_seconds: 0, end_seconds: tenths / 10 })])) return tenths / 10;
  }
  throw new Error('no accepted duration found');
})();

const MAX_DURATION_SECONDS = (() => {
  let best = MIN_DURATION_SECONDS;
  for (let tenths = 1; tenths <= 300; tenths += 1) {
    if (v2Accepts([baseMoment({ start_seconds: 0, end_seconds: tenths / 10 })])) best = tenths / 10;
  }
  return best;
})();

const MAX_MOMENTS = highestAccepted(1, 24, (n) => Array.from({ length: n }, (unused, i) => baseMoment({
  id: `m${i}`, start_seconds: i * 3, end_seconds: i * 3 + 3,
  variants_requested: 1, judge_mode: 'off', max_repairs: 0,
})));

const MAX_VARIANTS_PER_MOMENT = highestAccepted(1, 12, (n) => [baseMoment({ variants_requested: n })]);
const MIN_VARIANTS_PER_MOMENT = (() => {
  for (let n = 0; n <= 12; n += 1) if (v2Accepts([baseMoment({ variants_requested: n })])) return n;
  throw new Error('no accepted variant count found');
})();
const MAX_REPAIRS_PER_MOMENT = highestAccepted(0, 6, (n) => [baseMoment({ max_repairs: n })]);

/** The task ceiling across the whole graph, found by widening a uniform plan. */
const MAX_TOTAL_TASKS = (() => {
  let best = 0;
  for (let count = 1; count <= MAX_MOMENTS; count += 1) {
    for (let variants = 1; variants <= MAX_VARIANTS_PER_MOMENT; variants += 1) {
      const moments = Array.from({ length: count }, (unused, i) => baseMoment({
        id: `m${i}`, start_seconds: i * 3, end_seconds: i * 3 + 3,
        variants_requested: variants, judge_mode: 'off', max_repairs: 0,
      }));
      if (v2Accepts(moments)) best = Math.max(best, count * variants);
    }
  }
  return best;
})();

const JUDGE_MODES = [...controlV2.JUDGE_MODES].filter((mode) => v2Accepts([baseMoment({
  judge_mode: mode, max_repairs: 0,
})]));

/** Repair is only legal under the judge modes that can actually release it. */
const JUDGE_MODES_ALLOWING_REPAIR = JUDGE_MODES.filter((mode) => v2Accepts([baseMoment({
  judge_mode: mode, max_repairs: 1,
})]));

/** Ratios the REQUEST path accepts — a subset of what the price catalog lists. */
const REQUEST_SUPPORTED_RATIOS = [
  ...new Set(pricing.listProviderCapabilities().flatMap((entry) => entry.supported_ratios)),
].filter((ratio) => v2Accepts([baseMoment({ ratio })])).sort();

const PROVIDER_CATALOG = pricing.listProviderCapabilities();

/**
 * The moment-id grammar, as VERDICTS rather than as a copied regex. The editor
 * mirrors the pattern; this table is what its test asserts against, so a pattern
 * that drifts from the producer fails a test instead of rejecting ids the
 * backend would have accepted (or, worse, passing ones it refuses).
 */
const MOMENT_ID_VERDICTS = [
  'hook', 'h', '0', 'a-b_c', 'moment-1', 'a'.repeat(40), 'a'.repeat(41),
  'Hook', '-hook', '_hook', 'hook!', 'hook.1', 'hook 1', '', 'ünïcode',
].map((id) => ({ id, accepted: v2Accepts([baseMoment({ id })]) }));

/**
 * The timeline rules the editor must refuse BEFORE submission, each recorded as
 * the producer's own verdict. Abutting is the one that must stay VALID — an
 * editor that treats "touching" as "overlapping" silently forbids the most
 * common real timeline.
 */
const TIMELINE_VERDICTS = [
  {
    label: 'ascending_gap',
    accepted: v2Accepts([
      baseMoment({ id: 'a', start_seconds: 0, end_seconds: 3 }),
      baseMoment({ id: 'b', start_seconds: 6, end_seconds: 9 }),
    ]),
  },
  {
    label: 'abutting',
    accepted: v2Accepts([
      baseMoment({ id: 'a', start_seconds: 0, end_seconds: 3 }),
      baseMoment({ id: 'b', start_seconds: 3, end_seconds: 6 }),
    ]),
  },
  {
    label: 'overlapping',
    accepted: v2Accepts([
      baseMoment({ id: 'a', start_seconds: 0, end_seconds: 4 }),
      baseMoment({ id: 'b', start_seconds: 3, end_seconds: 7 }),
    ]),
  },
  {
    label: 'out_of_order',
    accepted: v2Accepts([
      baseMoment({ id: 'a', start_seconds: 6, end_seconds: 9 }),
      baseMoment({ id: 'b', start_seconds: 0, end_seconds: 3 }),
    ]),
  },
  {
    label: 'duplicate_ids',
    accepted: v2Accepts([
      baseMoment({ id: 'a', start_seconds: 0, end_seconds: 3 }),
      baseMoment({ id: 'a', start_seconds: 3, end_seconds: 6 }),
    ]),
  },
  {
    label: 'repair_with_judge_off',
    accepted: v2Accepts([baseMoment({ judge_mode: 'off', max_repairs: 1 })]),
  },
  {
    label: 'repair_with_judge_ranked',
    accepted: v2Accepts([baseMoment({ judge_mode: 'ranked', max_repairs: 1 })]),
  },
  {
    label: 'blank_prompt',
    accepted: v2Accepts([baseMoment({ prompt: '   ' })]),
  },
  {
    label: 'sub_second_precision',
    accepted: v2Accepts([baseMoment({ start_seconds: 0.5, end_seconds: 3.25 })]),
  },
  {
    label: 'finer_than_millisecond',
    accepted: v2Accepts([baseMoment({ start_seconds: 0.00005, end_seconds: 3 })]),
  },
  {
    label: 'task_ceiling_exceeded',
    accepted: v2Accepts(Array.from({ length: 10 }, (unused, i) => baseMoment({
      id: `m${i}`, start_seconds: i * 3, end_seconds: i * 3 + 3,
      variants_requested: 4, judge_mode: 'ranked', max_repairs: 1,
    }))),
  },
  {
    label: 'task_ceiling_at_limit',
    accepted: v2Accepts(Array.from({ length: 8 }, (unused, i) => baseMoment({
      id: `m${i}`, start_seconds: i * 3, end_seconds: i * 3 + 3,
      variants_requested: 4, judge_mode: 'ranked', max_repairs: 1,
    }))),
  },
];

/**
 * The provider's ceiling applies to the DERIVED prompt, so the room left for the
 * source text depends on the moment's own variant and repair shape. Emitted as a
 * table straight from the producer's own helper.
 */
const MAX_SOURCE_PROMPT_CHARS = (() => {
  const identity = { ...compiler.PROVIDER_PIN };
  const table = {};
  for (let variants = MIN_VARIANTS_PER_MOMENT; variants <= MAX_VARIANTS_PER_MOMENT; variants += 1) {
    table[variants] = {};
    for (let repairs = 0; repairs <= MAX_REPAIRS_PER_MOMENT; repairs += 1) {
      table[variants][repairs] = controlV2.maxSourcePromptChars({
        providerIdentity: identity, variantsRequested: variants, maxRepairs: repairs,
      });
    }
  }
  return table;
})();

/**
 * The exact text the provider receives, minus the user's own words. Recovered by
 * compiling a sentinel prompt and stripping it back off — so the editor can bind
 * a returned proposal to what the user actually typed without re-implementing
 * the producer's prompt construction.
 */
const DERIVED_PROMPT_SUFFIXES = (() => {
  const SENTINEL = 'zqsentinelpromptzq';
  const candidate = {};
  let repair = null;
  for (let variants = MIN_VARIANTS_PER_MOMENT; variants <= MAX_VARIANTS_PER_MOMENT; variants += 1) {
    const graph = controlV2.buildProfessionalControlGraphV2({
      executionMode: 'professional',
      moments: [{
        id: 'hook', prompt: SENTINEL, start_ms: 0, end_ms: 3000, ratio: '720:1280',
        variants_requested: variants, judge_mode: 'ranked', max_repairs: 1,
        provider_identity: { ...compiler.PROVIDER_PIN }, reference_artifact_ids: [],
      }],
    });
    if (!graph) throw new Error(`suffix probe failed at ${variants} variants`);
    candidate[variants] = {};
    for (const task of graph.authorization_tasks) {
      if (!task.prompt_text.startsWith(SENTINEL)) throw new Error('derived prompt does not start with the source prompt');
      const suffix = task.prompt_text.slice(SENTINEL.length);
      if (task.task_kind === 'candidate') candidate[variants][task.candidate_ordinal] = suffix;
      else if (repair === null) repair = suffix;
      else if (repair !== suffix) throw new Error('repair suffix is not stable across variant counts');
    }
  }
  return { candidate, repair };
})();

// ── moment sets ──────────────────────────────────────────────────────────────

/** The single bounded moment a first Professional run realistically starts from. */
const singleMoment = [baseMoment({ id: 'hook', prompt: 'a slow aerial push over a bay bridge at sunrise' })];

/** Deterministic QA only: one take, no judging, therefore no repair reserve. */
const judgeOffMoment = [baseMoment({
  id: 'hook', prompt: 'a slow aerial push over a bay bridge at sunrise',
  variants_requested: 1, judge_mode: 'off', max_repairs: 0,
})];

/**
 * A realistic multi-moment timeline: mixed variant counts, one judge-off moment
 * with no reserve, and an ABUTTING pair (12 ends exactly where 12 begins) so the
 * boundary case the editor must keep valid is a real fixture, not an assertion.
 */
const multiMoments = [
  baseMoment({ id: 'hook', prompt: 'a slow aerial push over a bay bridge at sunrise', start_seconds: 0, end_seconds: 3, variants_requested: 2, judge_mode: 'ranked', max_repairs: 1 }),
  baseMoment({ id: 'build', prompt: 'terminal output scrolling, shallow depth of field', start_seconds: 8, end_seconds: 12, variants_requested: 1, judge_mode: 'off', max_repairs: 0 }),
  baseMoment({ id: 'abut', prompt: 'hand lifting a phone into frame, soft window light', start_seconds: 12, end_seconds: 16, variants_requested: 3, judge_mode: 'ranked', max_repairs: 1 }),
  baseMoment({ id: 'close', prompt: 'wide skyline at dusk, slow drift right', start_seconds: 24, end_seconds: 34, variants_requested: 4, judge_mode: 'ranked', max_repairs: 1 }),
];

/** The v1 moment shapes, in the exact request form the v1 path takes. */
const v1SingleMoment = [{
  id: 'hook', prompt: 'a camera moving over bay area bridge',
  start_seconds: 0, end_seconds: 3, ratio: '720:1280',
}];
const v1MultiMoments = [
  { id: 'hook', prompt: 'Founder opens laptop in dim room, screen glow on face', start_seconds: 0, end_seconds: 5, ratio: '720:1280' },
  { id: 'build', prompt: 'Terminal scrolling with agent build output, close-up', start_seconds: 12, end_seconds: 17, ratio: '720:1280' },
];

// ── assemble ─────────────────────────────────────────────────────────────────

/** A fixture that quietly drifts off the authorized ceiling is worse than none. */
function assertV2Shape(envelope, { moments, expectAvailable }) {
  const doc = envelope.proposal;
  if (doc.control_contract_version !== CONTROL_V2) throw new Error('v2 fixture lost its discriminator');
  if (doc.availability !== expectAvailable) throw new Error(`v2 fixture availability drifted: ${doc.availability}`);
  const graph = doc.professional_control;
  if (graph.moments.length !== moments.length) throw new Error('v2 fixture moment count drifted');
  const expectedTasks = moments.reduce((sum, m) => sum + m.variants_requested + m.max_repairs, 0);
  if (doc.task_count !== expectedTasks || graph.authorization_tasks.length !== expectedTasks) {
    throw new Error(`v2 fixture task count drifted: ${doc.task_count} != ${expectedTasks}`);
  }
  if (doc.initial_credits + doc.repair_reserve_credits !== doc.maximum_credits) {
    throw new Error('v2 fixture cost does not decompose');
  }
  return envelope;
}

function assertV1Shape(envelope, { qualityMode }) {
  const doc = envelope.proposal;
  if ('control_contract_version' in doc) {
    throw new Error('a v1 fixture must NOT carry the discriminator — routing tests depend on its genuine absence');
  }
  if (doc.quality_mode !== qualityMode) throw new Error('v1 fixture mode drifted');
  if (!Array.isArray(doc.tasks) || !Array.isArray(doc.stages) || !doc.density_policy) {
    throw new Error('v1 fixture is not the real producer shape');
  }
  return envelope;
}

const AVAILABLE = availability({ available: true, unavailable_reason: null, required_missing_capabilities: [] });

const readAwaiting = await read({
  moments: multiMoments, controlContractVersion: CONTROL_V2, availabilityResult: AVAILABLE,
});

const fixtures = [
  ['BACKEND_PIN', EXPECTED_BACKEND_HEAD],
  ['CONTROL_CONTRACT_V1', CONTROL_V1],
  ['CONTROL_CONTRACT_V2', CONTROL_V2],
  ['DESKTOP_CAPABILITY_VERSION', 'professional-execution-capability.v1'],
  ['COMPILER_VERSION', compiler.COMPILER_VERSION],
  ['CONTRACT_VERSION', compiler.CONTRACT_VERSION],
  ['CAPABILITY_KEY', compiler.CAPABILITY_KEY],
  ['PROVIDER_PIN', compiler.PROVIDER_PIN],
  ['PROVIDER_CATALOG', PROVIDER_CATALOG],
  ['REQUEST_SUPPORTED_RATIOS', REQUEST_SUPPORTED_RATIOS],
  ['PROBED_BOUNDS', {
    maxMoments: MAX_MOMENTS,
    minVariantsPerMoment: MIN_VARIANTS_PER_MOMENT,
    maxVariantsPerMoment: MAX_VARIANTS_PER_MOMENT,
    maxRepairsPerMoment: MAX_REPAIRS_PER_MOMENT,
    maxTotalTasks: MAX_TOTAL_TASKS,
    minDurationSeconds: MIN_DURATION_SECONDS,
    maxDurationSeconds: MAX_DURATION_SECONDS,
    promptMaxChars: PROMPT_MAX_CHARS,
    judgeModes: JUDGE_MODES,
    judgeModesAllowingRepair: JUDGE_MODES_ALLOWING_REPAIR,
  }],
  ['MAX_SOURCE_PROMPT_CHARS', MAX_SOURCE_PROMPT_CHARS],
  ['DERIVED_PROMPT_SUFFIXES', DERIVED_PROMPT_SUFFIXES],
  ['MOMENT_ID_VERDICTS', MOMENT_ID_VERDICTS],
  ['TIMELINE_VERDICTS', TIMELINE_VERDICTS],

  ['AVAILABILITY_FLAGS_FALSE', FLAGS_FALSE_AVAILABILITY],
  ['AVAILABILITY_V2_READY', V2_READY_AVAILABILITY],
  ['AVAILABILITY_V1_ONLY_MACHINE_ON_V2', V1_ONLY_MACHINE_ON_V2_AVAILABILITY],

  ['V2_PREVIEW_UNAVAILABLE', assertV2Shape(
    await preview({ moments: singleMoment, controlContractVersion: CONTROL_V2, availabilityResult: FLAGS_FALSE_AVAILABILITY }),
    { moments: singleMoment, expectAvailable: false },
  )],
  ['V2_PREVIEW_AVAILABLE', assertV2Shape(
    await preview({ moments: singleMoment, controlContractVersion: CONTROL_V2, availabilityResult: AVAILABLE }),
    { moments: singleMoment, expectAvailable: true },
  )],
  ['V2_PREVIEW_JUDGE_OFF', assertV2Shape(
    await preview({ moments: judgeOffMoment, controlContractVersion: CONTROL_V2, availabilityResult: AVAILABLE }),
    { moments: judgeOffMoment, expectAvailable: true },
  )],
  ['V2_PREVIEW_MULTI', assertV2Shape(
    await preview({ moments: multiMoments, controlContractVersion: CONTROL_V2, availabilityResult: AVAILABLE }),
    { moments: multiMoments, expectAvailable: true },
  )],
  ['V2_PREVIEW_MULTI_UNAVAILABLE', assertV2Shape(
    await preview({ moments: multiMoments, controlContractVersion: CONTROL_V2, availabilityResult: FLAGS_FALSE_AVAILABILITY }),
    { moments: multiMoments, expectAvailable: false },
  )],
  ['V2_CREATE_UNAVAILABLE', assertV2Shape(
    await create({ moments: singleMoment, controlContractVersion: CONTROL_V2, availabilityResult: FLAGS_FALSE_AVAILABILITY }),
    { moments: singleMoment, expectAvailable: false },
  )],
  ['V2_CREATE_AVAILABLE', assertV2Shape(
    await create({ moments: singleMoment, controlContractVersion: CONTROL_V2, availabilityResult: AVAILABLE }),
    { moments: singleMoment, expectAvailable: true },
  )],
  ['V2_GET_UNAVAILABLE', await read({
    moments: singleMoment, controlContractVersion: CONTROL_V2, availabilityResult: FLAGS_FALSE_AVAILABILITY,
  })],
  ['V2_GET_AWAITING_APPROVAL', (() => {
    const envelope = readAwaiting;
    if (envelope.lifecycle_state !== 'awaiting_approval' || envelope.progress_state !== 'awaiting_approval') {
      throw new Error(`the awaiting-approval read drifted to ${envelope.lifecycle_state}`);
    }
    return envelope;
  })()],
  ['READ_FIXTURE_CLOCK', CREATED_AT],

  ['V1_PREVIEW_FAST', assertV1Shape(
    await preview({ moments: v1SingleMoment, qualityMode: 'fast' }), { qualityMode: 'fast' },
  )],
  ['V1_PREVIEW_FAST_MULTI', assertV1Shape(
    await preview({ moments: v1MultiMoments, qualityMode: 'fast' }), { qualityMode: 'fast' },
  )],
  ['V1_PREVIEW_PROFESSIONAL_AVAILABLE', assertV1Shape(
    await preview({ moments: v1SingleMoment, qualityMode: 'professional', availabilityResult: AVAILABLE }),
    { qualityMode: 'professional' },
  )],
  ['V1_PREVIEW_PROFESSIONAL_UNAVAILABLE', assertV1Shape(
    await preview({ moments: v1SingleMoment, qualityMode: 'professional', availabilityResult: FLAGS_FALSE_AVAILABILITY }),
    { qualityMode: 'professional' },
  )],
  ['V1_PREVIEW_PRODUCTION', assertV1Shape(
    await preview({ moments: v1SingleMoment, qualityMode: 'production' }), { qualityMode: 'production' },
  )],
  ['V1_CREATE_FAST', assertV1Shape(
    await create({ moments: v1SingleMoment, qualityMode: 'fast' }), { qualityMode: 'fast' },
  )],
  ['V1_GET_FAST', await read({ moments: v1SingleMoment, qualityMode: 'fast' })],
  // The EXPLICIT v1 discriminator is a legal request value the backend accepts;
  // it compiles the v1 document, which still carries no discriminator of its own.
  ['V1_PREVIEW_FAST_EXPLICIT_V1_REQUEST', assertV1Shape(
    await preview({ moments: v1SingleMoment, qualityMode: 'fast', controlContractVersion: CONTROL_V1 }),
    { qualityMode: 'fast' },
  )],
];

// A fixture carrying a local path, a token-shaped string or a URL would leak
// through every test log that prints it. Refuse to write one.
const serialized = JSON.stringify(fixtures);
for (const [label, pattern] of [
  ['an absolute filesystem path', /"\/(Users|home|private|var|tmp)\//],
  ['a bearer token', /Bearer\s/i],
  ['a JWT', /eyJ[A-Za-z0-9_-]{8,}/],
  ['a URL', /https?:\/\//],
]) {
  if (pattern.test(serialized)) throw new Error(`Refusing to write fixtures containing ${label}.`);
}

const header = `/**
 * GENERATED — do not edit by hand.
 *
 * Every document below is the REAL wire output of the Implexa backend producer
 * at commit ${EXPECTED_BACKEND_HEAD}: previews, creates and reads
 * driven through generation-proposal.service.js itself, and availability
 * verdicts from evaluateProfessionalAvailability. Bounds are PROBED from the
 * producer, never transcribed.
 *
 * Regenerate with:
 *   IMPLEXA_BACKEND_DIR=/path/to/implexa-backend \\
 *     node scripts/regenerate-professional-v2-fixtures.mjs
 * The generator refuses any other backend HEAD, and refuses to emit a document
 * containing a local path, a URL, a bearer token or a JWT.
 */\n\n`;

const body = fixtures
  .map(([name, value]) => `export const ${name} = ${JSON.stringify(value, null, 2)} as const;`)
  .join('\n\n');
const output = `${header}${body}\n`;
const target = join(dashboardRoot, 'lib/professional-v2.fixtures.ts');

if (process.argv.includes('--check')) {
  if (readFileSync(target, 'utf8') !== output) throw new Error('Professional v2 fixtures are stale.');
  console.log(`professional v2 fixtures match backend ${EXPECTED_BACKEND_HEAD}`);
} else {
  writeFileSync(target, output);
  console.log(`regenerated ${target} from backend ${EXPECTED_BACKEND_HEAD}`);
  console.log(JSON.stringify({
    maxMoments: MAX_MOMENTS,
    variants: [MIN_VARIANTS_PER_MOMENT, MAX_VARIANTS_PER_MOMENT],
    maxRepairsPerMoment: MAX_REPAIRS_PER_MOMENT,
    maxTotalTasks: MAX_TOTAL_TASKS,
    duration: [MIN_DURATION_SECONDS, MAX_DURATION_SECONDS],
    promptMaxChars: PROMPT_MAX_CHARS,
    judgeModes: JUDGE_MODES,
    judgeModesAllowingRepair: JUDGE_MODES_ALLOWING_REPAIR,
    ratios: REQUEST_SUPPORTED_RATIOS,
  }, null, 2));
}
