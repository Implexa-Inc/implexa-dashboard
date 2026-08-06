// node --test lib/run-input-surface-parity.test.ts
//
// THE BUG THIS PINS. <AgentActions/> is rendered on more than one surface. Only
// the agent detail page passed it workflowVersionId / inputContract /
// inputContractDigest; the activation card rendered the same "Run now" button
// without them. Those three are the only way the component learns the pinned
// version declares typed inputs. Without them it renders no "Run inputs" section
// and posts no envelope to POST /api/v2/me/run-requests, and the backend's
// resolveVersionedRunInputs refuses the run outright
// (`versioned_input_envelope_required`). The user got a refusal on a screen that
// offered no way to supply the inputs.
//
// So the defect was never in a rule — it was one JSX site being a strict subset
// of another. A unit test of the contract helpers (lib/workflow-input-contract.test.ts)
// cannot see that, and this repo has no DOM renderer, so the parity itself is
// pinned as source. Two rules the tests below follow, both learned the hard way:
//
//   1. A prop NAME being present proves nothing — `runInputs={null}` satisfies
//      any name-only check while reproducing the bug exactly. Every hop asserts
//      the VALUE is a real binding.
//   2. Nothing here may be the only thing standing between a new mount and the
//      bug: <ActivationCard/>'s runInputs prop is REQUIRED, so tsc rejects a
//      surface that omits it before these tests ever run.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openingElements, propValue } from './jsx-source.ts';
import { getWorkflowRunInputs, workflowRunInputs } from './workflow-catalog.ts';
import type { WorkflowDetail } from './workflow-catalog.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SKIP = new Set(['node_modules', '.next', '.git', 'dist', '.vercel', 'public']);

/**
 * The props a parent MUST supply for <AgentActions/> to be able to build the
 * versioned-input envelope. Derived from agent-actions.tsx itself:
 *   - inputContract      → orderedInputFields(...) → typedFields, which gates BOTH
 *                          the rendered "Run inputs" section and the envelope
 *   - workflowVersionId  → sent, and must equal the server-resolved version
 *   - inputContractDigest→ sent, and must equal the server-resolved digest
 * inputBindings / inputSessionId are the component's own state, not a parent's job.
 */
const ENVELOPE_PROPS = ['workflowVersionId', 'inputContract', 'inputContractDigest'] as const;

/** Values that type-check but carry nothing — the shape every mutation took. */
const EMPTY_BINDINGS = new Set(['null', 'undefined', '{}']);

function tsxFiles(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) tsxFiles(full, acc);
    else if (full.endsWith('.tsx')) acc.push(full);
  }
  return acc;
}

/**
 * Real render sites only. Prose mentions of a component (`<AgentActions />` in a
 * JSDoc header, of which this repo has several) never pass its required prop, so
 * requiring that prop separates rendering from talking about rendering without
 * needing to strip comments — which is unreliable around strings containing `//`.
 */
function renderSites(tag: string, requiredProp: string): Array<{ file: string; element: string }> {
  const sites: Array<{ file: string; element: string }> = [];
  for (const file of tsxFiles(ROOT)) {
    const source = readFileSync(file, 'utf8');
    if (!source.includes(`<${tag}`)) continue;
    for (const element of openingElements(source, tag)) {
      if (propValue(element, requiredProp) !== null) sites.push({ file: file.slice(ROOT.length), element });
    }
  }
  return sites;
}

// ── the parity guard ────────────────────────────────────────────────────────

test('REPRO: every surface that renders Run now hands it the full versioned-input envelope', () => {
  const sites = renderSites('AgentActions', 'slug');
  // Not a vacuous pass: the extractor must actually be finding sites. Three today
  // (agent detail header, agent detail setup panel, activation card); a new one is
  // welcome — it just has to carry the props.
  assert.ok(sites.length >= 3, `expected to find the known <AgentActions/> render sites, found ${sites.length}`);

  const broken = sites.flatMap((s) => ENVELOPE_PROPS.flatMap((p) => {
    const value = propValue(s.element, p);
    if (value === null) return [`${s.file}: missing ${p}`];
    // A hardcoded null type-checks and satisfies any name-only check, while
    // reproducing the original bug exactly. It is not a way to pass this.
    return EMPTY_BINDINGS.has(value) ? [`${s.file}: ${p} is hardcoded ${value}`] : [];
  }));

  assert.deepEqual(broken, [],
    'a <AgentActions/> without a real binding for these renders no "Run inputs" section and posts no '
    + 'envelope, so Run now is refused with versioned_input_envelope_required on any contract-bearing agent');
});

test('REPRO: every page that mounts the activation card resolves real run inputs for it', () => {
  const sites = renderSites('ActivationCard', 'checklist');
  assert.ok(sites.length >= 2, `expected the activation screen and the agent setup panel, found ${sites.length}`);

  const broken = sites.flatMap((s) => {
    const value = propValue(s.element, 'runInputs');
    // Omitting it entirely is caught by tsc (the prop is required, no default) —
    // asserted below. What tsc cannot see is a mount that satisfies the type with
    // a literal null: that compiles, and lands straight back in the original bug.
    if (value === null) return [`${s.file}: missing runInputs`];
    return EMPTY_BINDINGS.has(value) ? [`${s.file}: runInputs is hardcoded ${value}`] : [];
  });

  assert.deepEqual(broken, [], 'a card mounted without resolved run inputs falls back into the original bug');
});

test('the card cannot be mounted without run inputs at all — that is tsc’s job, not a test’s', () => {
  const card = readFileSync(join(ROOT, 'app/(dashboard)/_components/activation-card.tsx'), 'utf8');
  const props = card.slice(card.indexOf('export function ActivationCard('), card.indexOf('const setupSurface'));
  assert.match(props, /\n\s*runInputs: WorkflowRunInputs \| null;/,
    'runInputs must be REQUIRED — an optional prop lets a new surface omit it and silently re-create the bug');
  assert.doesNotMatch(props, /runInputs\s*=\s*(null|undefined|\{\})/,
    'a default value would re-open exactly the hole the required prop closes');
});

test('the card FORWARDS what it is given, rather than hardcoding the absent case', () => {
  const card = readFileSync(join(ROOT, 'app/(dashboard)/_components/activation-card.tsx'), 'utf8');
  const [element] = openingElements(card, 'AgentActions').filter((e) => propValue(e, 'slug') !== null);
  assert.ok(element, 'the activation card must still render <AgentActions/>');
  for (const prop of ENVELOPE_PROPS) {
    assert.equal(propValue(element, prop), `runInputs?.${prop} ?? null`,
      `${prop} must come from the runInputs the page resolved`);
  }
});

test('an UNREADABLE contract is rendered as unreadable, not passed off as "needs no inputs"', () => {
  // Both arrive at <AgentActions/> as the same three nulls, so this notice is the
  // only thing separating "we could not load it" from a confident "nothing needed".
  // Without it a transient read failure is the original bug again, narrower.
  const card = readFileSync(join(ROOT, 'app/(dashboard)/_components/activation-card.tsx'), 'utf8');
  const at = card.indexOf('{runInputs === null && (');
  assert.notEqual(at, -1, 'the read-failed case must have its own branch, distinct from a contract-free agent');
  // The branch must RENDER the explanation, not just exist — bounded to the branch
  // body so prose from a comment elsewhere in the file cannot satisfy it.
  const notice = card.slice(at, card.indexOf(')}', at));
  assert.match(notice, /couldn’t load/i, 'and it must say so to the user, in the card, before they click Run');
  assert.ok(at < card.indexOf('<AgentActions', at), 'the explanation must come before the button it explains');
});

test('the envelope AgentActions builds still needs exactly these three from its parent', () => {
  // If a fourth parent-supplied field joins the envelope, this fails and forces
  // the new prop into ENVELOPE_PROPS — which is what makes every surface above
  // get audited again, instead of one of them quietly falling behind.
  const actions = readFileSync(join(ROOT, 'app/(dashboard)/_components/agent-actions.tsx'), 'utf8');
  assert.match(
    actions,
    /\.\.\.\(typedFields\.length && workflowVersionId && inputContractDigest \? \{/,
    'the envelope is gated on the contract fields the parent supplies',
  );
  assert.match(actions, /const typedFields = orderedInputFields\(inputContract\)/,
    'typedFields — the gate on both the rendered inputs form and the envelope — comes from the inputContract prop');
});

// ── the derivation ──────────────────────────────────────────────────────────

const VERSION = '7a598979-1389-4fa8-a605-d137663999e6';
const DIGEST = 'f009f714'.padEnd(64, '0');

const detail = (over: Partial<WorkflowDetail> = {}) => ({
  workflow_version_id: VERSION,
  input_contract: { version: 1 as const, fields: [] },
  input_contract_digest: DIGEST,
  ...over,
} as WorkflowDetail);

test('workflowRunInputs renames the persisted columns to the props AgentActions takes', () => {
  assert.deepEqual(workflowRunInputs(detail()), {
    workflowVersionId: VERSION,
    inputContract: { version: 1, fields: [] },
    inputContractDigest: DIGEST,
  });
});

test('a workflow that genuinely declares no inputs resolves to nulls, not to undefined props', () => {
  // undefined would silently take <AgentActions/>'s own `= null` defaults, which is
  // the same end state — but only by luck. Pin the explicit value.
  assert.deepEqual(
    workflowRunInputs(detail({ workflow_version_id: null, input_contract: null, input_contract_digest: null })),
    { workflowVersionId: null, inputContract: null, inputContractDigest: null },
  );
});

// ── the read chain ──────────────────────────────────────────────────────────
//
// Injected readers, because the branch that matters most — every read missing
// resolving to null rather than to a record of nulls — is the one whose collapse
// re-creates the bug, and it is unreachable over the real network path.

function readers(...results: Array<WorkflowDetail | null>) {
  const asked: string[] = [];
  const next = () => results[asked.length - 1] ?? null;
  return {
    asked,
    mine: async (slug: string, source: string) => { asked.push(`mine:${slug}:${source}`); return next(); },
    shared: async (slug: string, source: string) => { asked.push(`shared:${slug}:${source}`); return next(); },
  };
}

test('the owner read answers first, and nothing else is asked', async () => {
  const r = readers(detail());
  assert.deepEqual(await getWorkflowRunInputs('yt-overlay', 'generated', r), {
    workflowVersionId: VERSION, inputContract: { version: 1, fields: [] }, inputContractDigest: DIGEST,
  });
  assert.deepEqual(r.asked, ['mine:yt-overlay:generated'],
    'the cached public read must not be consulted once the fresh owner read has answered');
});

test('a web-seed caller is normalised to the owned source before the owner read', async () => {
  const r = readers(detail());
  await getWorkflowRunInputs('yt-overlay', 'web-seed', r);
  assert.deepEqual(r.asked, ['mine:yt-overlay:generated']);
});

test('an owner miss falls through community, then the shared catalog', async () => {
  const r = readers(null, null, detail());
  assert.ok(await getWorkflowRunInputs('yt-overlay', 'generated', r));
  assert.deepEqual(r.asked, ['mine:yt-overlay:generated', 'mine:yt-overlay:community', 'shared:yt-overlay:generated'],
    'dropping a hop silently narrows which agents can Run at all from the activation screen');
});

test('REPRO (read failure): every read missing is null — NOT a record of nulls', async () => {
  // The whole point of the type. A record of nulls is indistinguishable from a
  // contract-free agent, so collapsing these makes an unavailable read render as
  // "this agent needs no inputs" and Run now refuse with backend jargon.
  const r = readers(null, null, null);
  assert.equal(await getWorkflowRunInputs('yt-overlay', 'generated', r), null);
  assert.equal(r.asked.length, 3, 'and it must actually have tried every read before giving up');
});

test('a readable workflow that declares no contract is NOT the same as an unreadable one', async () => {
  const r = readers(detail({ workflow_version_id: null, input_contract: null, input_contract_digest: null }));
  assert.deepEqual(await getWorkflowRunInputs('plain-agent', 'generated', r),
    { workflowVersionId: null, inputContract: null, inputContractDigest: null },
    'this one resolved — it just has nothing to ask for, and Run now is right to proceed');
});

test('the production readers are the default, so no caller has to know the chain', () => {
  const catalog = readFileSync(join(ROOT, 'lib/workflow-catalog.ts'), 'utf8');
  assert.match(catalog, /readers: WorkflowReaders = \{ mine: getMyWorkflow, shared: getWorkflow \}/,
    'the injected seam exists for tests; production must still get the real owner-first chain by default');
});
