// node --test "app/(dashboard)/_components/setup-tiers.test.ts"
//
// Guards for the three seams the 2026-07-18 review found. The dashboard half of
// the tier split shipped with NO tests at all; these cover the exact failures.
//
//   P0 — the Save gate demanded every declared field, so a user who answered all
//        required questions but left one preference blank could not save AT ALL,
//        leaving Run blocked on answers they had already given. Optional was
//        optional in the data and required in the UI.
//   P1 — requirement satisfaction ignored the per-agent grant, so a brand-new
//        agent read "everything's set up", the row collapsed, and the only way to
//        authorize it was hidden. That is the dead end PR #63 removed, rebuilt.
//   P1 — the Run gate must read required-only, or the tier split is cosmetic.
//
// Source-guard style (the repo's answer for un-importable .tsx server/client
// components) — anchored on render forms, never bare names, since prose matches
// first.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (f: string) => readFileSync(join(import.meta.dirname, f), 'utf8');

test('Save requires ONLY the required fields — a blank preference must not block saving', () => {
  const src = read('agent-setup-card.tsx');
  // The bug, verbatim: every() over the whole schema.
  assert.doesNotMatch(
    src,
    /const allFilled = setup\.schema\.every\(/,
    'gating Save on the FULL schema is what made optional preferences effectively required',
  );
  assert.match(src, /const requiredFields = setup\.schema\.filter\(\(f\) => !isOptional\(f\)\)/,
    'the card must separate the tiers');
  assert.match(src, /const allFilled = requiredFields\.every\(filled\)/,
    'Save unlocks on the REQUIRED fields alone');
  // A field carrying a default counts as optional here too, matching the backend
  // rule (normalizeConfigSchema): supplying a default implies optional.
  assert.match(src, /const isOptional = \(f: Field\) => !!f\.optional \|\| \(f\.default !== undefined/,
    'the client tier rule must match the server: a default implies optional');
});

test('preferences are visibly separated and individually escapable', () => {
  const src = read('agent-setup-card.tsx');
  assert.match(src, /Optional preferences/, 'the tiers must be visible, not just present in the data');
  assert.match(src, /These never block a run/, 'say so plainly — otherwise every field still reads as mandatory');
  // The two escapes, so a blank field is a decision rather than an unfinished form.
  assert.match(src, /Use default \(\{f\.default\}\)/, 'a defaulted preference needs a one-tap accept');
  assert.match(src, /Skipping is fine/, 'skipping must be stated as safe');
  assert.match(src, /\{isOptional\(f\) && !filled\(f\) && \(/, 'the affordances show only for an unanswered preference');
});

test('requirement satisfaction requires the PER-AGENT grant, not just a saved key', () => {
  const src = read('activation-requirements.tsx');
  // Both halves, in one predicate.
  assert.match(
    src,
    /const satisfied = \(s: \(typeof services\)\[number\]\) =>\s*\n?\s*!!s\.provider && s\.keyOnMachine && grants\?\.\[s\.provider\] === true;/,
    'satisfied MUST be keyOnMachine AND granted-for-this-agent — the server cannot see grants',
  );
  // The server's weaker field must not be mistaken for satisfaction anywhere.
  assert.doesNotMatch(src, /filter\(\(s\) => s\.satisfied\)/, 'there is no server-side `satisfied` to trust');
  // Unknown grant state must never collapse a row.
  assert.match(src, /\.catch\(\(\) => \{ if \(alive\) setGrants\(null\); \}\)/,
    'a failed grant read must leave the row actionable, not silently satisfied');
  assert.match(src, /if \(!b\?\.keysGrantedFor\) \{ setGrants\(null\); return; \}/,
    'no bridge (plain web) is also "unknown", never granted');
});

test('a saved-but-ungranted row stays actionable and stops selling a second key', () => {
  const src = read('activation-requirements.tsx');
  assert.match(src, /const needsGrantOnly = !!s\.provider && s\.keyOnMachine;/,
    'the grant-only state must be named');
  assert.match(src, /Key already saved on this Mac — allow this agent to use it\./,
    'tell the user it is an authorization, not a purchase');
  // The founder's original complaint: "key ready" next to "Get it ↗".
  assert.match(src, /\{!needsGrantOnly && \(\s*\n\s*<a href=\{s\.url\}/,
    'never offer "Get it" for a key that already exists');
  assert.match(src, /\{!needsGrantOnly && \(\s*\n\s*<span className="text-\[11px\] px-1\.5/,
    'never show a cost badge for a key that already exists');
  // And the key control is always rendered for a vault-backed provider, so the
  // grant path can never be hidden.
  assert.match(src, /\{s\.provider && <InlineAddKeyButton provider=\{s\.provider\} slug=\{slug\} \/>\}/,
    'the key/grant control must render for every vault-backed provider');
});

test('the Run gate reads required-only, or the whole split is cosmetic', () => {
  const src = read('agent-actions.tsx');
  assert.match(src, /const blocking = blockingQuestions \?\? pendingQuestions;/,
    'one derived gate value, with an older-backend fallback to the total');
  assert.match(src, /if \(blocking > 0\) \{ surfaceQuestions\(\); return; \}/, 'the click gate uses it');
  assert.doesNotMatch(src, /if \(pendingQuestions > 0\) \{ surfaceQuestions\(\)/,
    'gating on the TOTAL would let an optional preference block Run');
});

test('Overview reports readiness from the honest server claim', () => {
  const page = read('../workflows/[slug]/page.tsx');
  assert.match(page, /filter\(\(x\) => !x\.keyOnMachine\)/, 'the page reads keyOnMachine, not a satisfied flag');
  assert.match(page, /blockingQuestions=\{checklist\?\.blockingQuestions\}/, 'the gate is threaded to the actions');
  assert.doesNotMatch(page, /allSatisfied/, 'the server no longer claims satisfaction — nothing may read it');
});
