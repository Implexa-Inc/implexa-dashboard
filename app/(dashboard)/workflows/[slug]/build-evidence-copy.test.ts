// node --test "app/(dashboard)/workflows/[slug]/build-evidence-copy.test.ts"
//
// REGRESSION GUARD — generated agents must not imply their steps came from
// "verified skills" unless we have real run evidence. The proof source for
// agent building is run_outcome_ledger, not the mere existence of a bound skill.
//
// This page is a .tsx server component and StepRow is a JSX client component,
// so this pins source copy directly, matching the established source-guard
// pattern in this folder.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const page = readFileSync(join(import.meta.dirname, 'page.tsx'), 'utf8');
const stepRow = readFileSync(join(import.meta.dirname, '../../_components/step-row.tsx'), 'utf8');

test('workflow detail shows build evidence instead of claiming verified skills', () => {
  assert.match(page, /BUILD EVIDENCE/i, 'workflow detail must expose a Build evidence section');
  assert.match(page, /from proven runs/, 'step stats must say proven runs only when run proof exists');
  assert.match(page, /bound skills/, 'step stats must fall back to bound skills when proof does not exist');
  assert.doesNotMatch(
    page,
    /from verified skills/i,
    'a generated agent may have bound skills without real-run proof; do not label those as verified',
  );
});

test('step rows disclose whether each bound step has real run proof', () => {
  assert.match(stepRow, /Proven by/, 'bound steps with evidence must show a proof line');
  assert.match(stepRow, /No proven run history yet/, 'bound steps without evidence must be disclosed as unproven');
  assert.match(
    stepRow,
    /showBuildEvidence && bound/,
    'per-step proof copy must be gated by workflow-level build evidence; legacy agents have no per-step build evidence blob even when their Track Record is real',
  );
  assert.doesNotMatch(
    stepRow,
    /verified skill/i,
    'a bound step is reusable, but not automatically verified by real runs',
  );
});

test('workflow detail passes the build-evidence gate into StepRow', () => {
  assert.match(
    page,
    /showBuildEvidence=\{Boolean\(workflow\.build_evidence && workflow\.build_evidence\.status !== 'pending'\)\}/,
    'legacy agents without workflow.build_evidence must not render per-step "No proven run history yet" copy',
  );
});
