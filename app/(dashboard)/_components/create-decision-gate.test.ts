// node --test "app/(dashboard)/_components/create-decision-gate.test.ts"
//
// The capability-aware Create gate (2026-07-23). The whole point of the fix is
// that Create STOPS always opening a modal — so these guard the mode routing
// that makes that true (source assertions, matching this repo's test style).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = import.meta.dirname;
const gate = readFileSync(join(dir, 'create-decision-gate.tsx'), 'utf8');

test('direct and disclose auto-enqueue WITHOUT opening the focused modal', () => {
  // decide is the ONLY mode that stops to ask; everything else builds immediately.
  assert.match(gate, /if \(p\.decisionMode === 'decide'\) \{ setPhase\('decide'\); return; \}/,
    'only decide opens the question');
  assert.match(gate, /await enqueue\(p\.decisionMode === 'disclose' \? \{ disclosures: p\.disclosures \} : \{\}\)/,
    'direct/disclose enqueue right away — direct silently, disclose with the confirmation');
  // The auto-enqueue is guarded to fire exactly once.
  assert.match(gate, /if \(settled\.current\) return;\s*\n\s*settled\.current = true;/,
    'the direct/disclose build must not double-fire');
});

test('a disclose confirmation is passed up to the surface, not dropped on unmount', () => {
  assert.match(gate, /onCreated\(opts\.disclosures \? \{ disclosures: opts\.disclosures \} : undefined\)/,
    'the compact confirmation rides onCreated so it survives this component unmounting');
});

test('decide maps each option kind to the RIGHT build input', () => {
  // source → the option id is a real tool/source id, rides as a confirmed pref.
  assert.match(gate, /if \(kind === 'source'\) \{[\s\S]*?enqueue\(\{ toolPreferences: \[opt\.id\] \}\)/,
    'a source choice becomes a confirmed toolPreference');
  // video_format → folded into the intent (a format is not a vendor).
  assert.match(gate, /opt\.id === 'faceless'/, 'the format choice branches on faceless');
  assert.match(gate, /enqueue\(\{ buildIntent: `\$\{intent\}\$\{suffix\}` \}\)/,
    'the format product choice is folded into the intent, not sent as a vendor');
});

test('only a decide selection becomes a confirmed toolPreference — direct/disclose send none', () => {
  // The auto-enqueue path passes no toolPreferences (advisory defaults stay advisory).
  assert.match(gate, /toolPreferences: opts\.toolPreferences \?\? \[\]/,
    'enqueue defaults to NO preferences; only an explicit decide choice sets them');
});

test('a capability gap offers "Build anyway", never a silent substitute', () => {
  assert.match(gate, /Build anyway/, 'the gap is honest — build with the gap flagged');
  assert.match(gate, /flag the gap instead of substituting/, 'and says so');
});

test('the gate reuses the shared server helpers — it never resolves vendors itself', () => {
  assert.match(gate, /from '@\/lib\/plan-review'/, 'plan logic comes only from the shared server-backed helpers');
  assert.match(gate, /fetchPlanPreview\(intent/, 'reads the plan');
  assert.match(gate, /createAgentBuild\(/, 'enqueues via the shared helper');
  // "Change tools" reuses the existing full editor rather than reimplementing it.
  assert.match(gate, /import PlanReviewModal from '\.\/plan-review-modal'/, 'the full editor is reused for "Change tools"');
  assert.match(gate, /setPhase\('advanced'\)/, 'and reached via the Change tools affordance');
});
