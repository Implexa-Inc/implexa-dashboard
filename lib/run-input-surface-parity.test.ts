// node --test lib/run-input-surface-parity.test.ts
//
// THE BUG THIS PINS. <AgentActions/> is rendered on more than one surface. Only
// the agent detail page passed it workflowVersionId / inputContract /
// inputContractDigest; the activation card rendered the same "Run now" button
// without them. Those three are not decoration — they are the ONLY way the
// component learns the pinned version declares typed inputs. Without them it
// renders no "Run inputs" section and posts no envelope to
// POST /api/v2/me/run-requests, and the backend's resolveVersionedRunInputs
// refuses the run outright (`versioned_input_envelope_required`). The user got a
// refusal on a screen that offered no way to supply the inputs.
//
// So the defect was never in a rule — it was one JSX site being a strict subset
// of another. A unit test of the contract helpers (lib/workflow-input-contract.test.ts)
// cannot see that, and this repo has no DOM renderer, so the parity itself is
// pinned as source: every real <AgentActions/> carries the full set, and every
// real <ActivationCard/> supplies the card the value it forwards. A NEW Run
// surface added later fails this test on the day it is written, not in production.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { workflowRunInputs } from './workflow-catalog.ts';
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
 * Every `<Tag …>` opening element in `source`, as raw text. Scans to the first
 * `>` outside any `{…}` expression, so `foo={a > b}` and nested JSX in a prop
 * don't truncate the element early.
 */
function openingElements(source: string, tag: string): string[] {
  const out: string[] = [];
  const open = `<${tag}`;
  for (let i = source.indexOf(open); i !== -1; i = source.indexOf(open, i + 1)) {
    // Reject `<AgentActionsSomethingElse` — the tag must end here.
    if (/[A-Za-z0-9_]/.test(source[i + open.length] ?? '')) continue;
    let depth = 0;
    let j = i + open.length;
    for (; j < source.length; j++) {
      const c = source[j];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) break;
    }
    out.push(source.slice(i, j + 1));
  }
  return out;
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
      if (element.includes(`${requiredProp}=`)) sites.push({ file: file.slice(ROOT.length), element });
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

  const incomplete = sites
    .map((s) => ({ ...s, missing: ENVELOPE_PROPS.filter((p) => !s.element.includes(`${p}=`)) }))
    .filter((s) => s.missing.length);

  assert.deepEqual(
    incomplete.map((s) => `${s.file}: missing ${s.missing.join(', ')}`),
    [],
    'a <AgentActions/> without these renders no "Run inputs" section and posts no envelope, '
    + 'so Run now is refused with versioned_input_envelope_required on any contract-bearing agent',
  );
});

test('the activation card is fed the run inputs by every page that mounts it', () => {
  const sites = renderSites('ActivationCard', 'checklist');
  assert.ok(sites.length >= 2, `expected the activation screen and the agent setup panel, found ${sites.length}`);

  const unfed = sites.filter((s) => !s.element.includes('runInputs=')).map((s) => s.file);
  assert.deepEqual(unfed, [], 'a card mounted without runInputs falls straight back into the original bug');
});

test('the card FORWARDS what it is given, rather than hardcoding the absent case', () => {
  // The parity test above only proves the prop names appear. Passing literal
  // nulls would satisfy it while reproducing the bug exactly, so pin the binding.
  const card = readFileSync(join(ROOT, 'app/(dashboard)/_components/activation-card.tsx'), 'utf8');
  const [element] = openingElements(card, 'AgentActions').filter((e) => e.includes('slug='));
  assert.ok(element, 'the activation card must still render <AgentActions/>');
  for (const prop of ENVELOPE_PROPS) {
    assert.match(
      element,
      new RegExp(`${prop}=\\{runInputs\\?\\.${prop} \\?\\? null\\}`),
      `${prop} must come from the runInputs the page resolved`,
    );
  }
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

const detail = (over: Partial<WorkflowDetail>) => ({
  workflow_version_id: '7a598979-1389-4fa8-a605-d137663999e6',
  input_contract: { version: 1 as const, fields: [] },
  input_contract_digest: 'a'.repeat(64),
  ...over,
} as WorkflowDetail);

test('workflowRunInputs renames the persisted columns to the props AgentActions takes', () => {
  assert.deepEqual(workflowRunInputs(detail({})), {
    workflowVersionId: '7a598979-1389-4fa8-a605-d137663999e6',
    inputContract: { version: 1, fields: [] },
    inputContractDigest: 'a'.repeat(64),
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
