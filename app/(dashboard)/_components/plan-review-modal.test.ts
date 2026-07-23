// node --test "app/(dashboard)/_components/plan-review-modal.test.ts"
//
// The plan-review step (2026-07-23) gates EVERY dashboard Create surface. These
// guard the load-bearing invariants that make it correct and non-annoying:
//   1. The build is enqueued ONLY after the user accepts (cancel creates nothing).
//   2. The one-click default path is the prominent CTA (no forced decisions).
//   3. The dashboard never chooses vendors — a tool change re-asks the server.
//   4. Every Create surface actually routes through the modal (not the old
//      direct POST).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = import.meta.dirname;
const modal = readFileSync(join(dir, 'plan-review-modal.tsx'), 'utf8');

test('the build is enqueued only on accept — cancel creates nothing', () => {
  // create() (the enqueue) is called from the accept button's onClick, never on mount.
  assert.match(modal, /onClick=\{create\}/, 'the accept button triggers the create');
  assert.match(modal, /createAgentBuild\(\{ intent, toolPreferences/, 'accept enqueues with the confirmed preferences');
  // Cancel calls the parent's onCancel and never createAgentBuild.
  assert.match(modal, /onClick=\{onCancel\}/, 'cancel just closes');
  // The only createAgentBuild call sits inside create(); loading the plan uses
  // fetchPlanPreview (zero-write), never createAgentBuild.
  assert.equal((modal.match(/createAgentBuild\(/g) || []).length, 1, 'exactly one enqueue path, and it is the accept button');
  assert.match(modal, /fetchPlanPreview\(intent/, 'the plan is loaded read-only, not created');
});

test('the one-click default is the prominent CTA — no forced per-capability decision', () => {
  assert.match(modal, /Create with recommended plan/, 'the default path is one click');
  assert.match(modal, /hasChanges \? 'Create this agent' : 'Create with recommended plan'/,
    'the CTA reads as a default until the user actually changes a tool');
});

test('the dashboard re-asks the server on a tool change — it never resolves vendors itself', () => {
  // A change records the pick and the effect reloads from the server; there is
  // no client-side stack resolution.
  // A change ONLY records the user's pick (setChosen); it computes no stack.
  assert.match(modal, /function changeTool\(capId: string, tool: ToolChoice\)\s*\{\s*\n\s*setChosen\(/,
    'a change just records the pick — no client-side stack resolution');
  assert.match(modal, /load\(toolPreferences\)/, 'the plan is reloaded from the server after a change');
  // The client's only plan sources are the two server helpers — it imports no
  // capability tables and calls no resolver.
  assert.match(modal, /from '@\/lib\/plan-review'/, 'plan logic comes only from the shared server-backed helpers');
});

test('a capability gap is shown explicitly, never a silent substitute', () => {
  assert.match(modal, /cap\.unresolved \?/, 'a gap renders its own branch');
  assert.match(modal, /No tool available/, 'the gap is stated in plain words');
});

test('a cross-capability tool choice is disclosed (backend treats prefs as cross-capability)', () => {
  // The row must say when its selected tool ALSO fills another capability, so a
  // change never silently moves a capability the user did not touch.
  assert.match(modal, /function alsoHandledLabels\(caps: PlanCapability\[\], cap: PlanCapability\)/,
    'a helper must compute the OTHER capabilities the selected tool covers');
  assert.match(modal, /c\.selectedToolId === cap\.selectedToolId/, 'shared by the same selected tool id');
  assert.match(modal, /also handles \{also\.join\(' and '\)\}/, 'and the row renders the disclosure');
});

const SURFACES = ['talk-to-implexa', 'create-fab', 'next-agent-cards', 'suggested-shelf'];
for (const name of SURFACES) {
  test(`Create surface "${name}" routes through the plan review (not a direct build POST)`, () => {
    const src = readFileSync(join(dir, `${name}.tsx`), 'utf8');
    assert.match(src, /PlanReviewModal/, `${name} must render the plan-review modal`);
    // The old pattern posted straight to /api/agents/create on submit. That call
    // now lives ONLY inside the modal (via createAgentBuild), never inline here.
    assert.doesNotMatch(src, /fetch\('\/api\/agents\/create'/, `${name} must not POST the build directly — the modal does, after accept`);
  });
}
