// node --test "app/(dashboard)/_components/capability-gaps-notice.test.ts"
//
// The dashboard consumer for checklist.capabilityGaps (2026-07-22 review: the
// backend surfaced the field with no UI reading it). Source-guard style — the
// repo's answer for un-importable .tsx client/server components (they render
// forms, so we anchor on those, not bare names).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = import.meta.dirname;
const notice = readFileSync(join(dir, 'capability-gaps-notice.tsx'), 'utf8');
const card = readFileSync(join(dir, 'activation-card.tsx'), 'utf8');
const lib = readFileSync(join(dir, '..', '..', '..', 'lib', 'activation.ts'), 'utf8');

test('the notice renders nothing when there are no gaps (never an empty warning box)', () => {
  assert.match(notice, /if \(!list\.length\) return null;/, 'must short-circuit on an empty/absent list');
});

test('the notice separates required from recommended gaps, and only required withholds "ready to run"', () => {
  assert.match(notice, /g\.requiredness === 'required_to_deliver'/, 'must branch on requiredness, not treat all gaps alike');
  assert.match(notice, /won.t show as ready to run until then/, 'a required gap must explain WHY readiness is withheld');
  assert.match(notice, /Optional capability without a tool/, 'a recommended-only gap must read as informational, not a blocker');
});

test('the notice shows each capability label and its reason', () => {
  assert.match(notice, /g\.capabilityLabel/);
  assert.match(notice, /g\.reason &&/, 'the server-provided reason must render');
});

test('the activation card actually renders the notice, in the Setup/requirements area', () => {
  assert.match(card, /import CapabilityGapsNotice from '\.\/capability-gaps-notice';/);
  assert.match(card, /<CapabilityGapsNotice gaps=\{checklist\.capabilityGaps\} \/>/,
    'the card must pass the real checklist gaps to the notice, not a stub');
});

test('lib/activation parses capabilityGaps, filtering malformed entries, absent -> []', () => {
  assert.match(lib, /export type CapabilityGap = \{/, 'the type must exist for the notice to consume');
  assert.match(lib, /capabilityGaps\?: CapabilityGap\[\];/, 'the checklist type must carry it');
  assert.match(lib, /Array\.isArray\(b\.capabilityGaps\)/, 'must guard the array shape');
  assert.match(lib, /typeof \(g as CapabilityGap\)\.capability === 'string'/, 'must drop malformed gap entries');
  // Absent on an older backend must not throw or render — the `: []` fallback.
  assert.match(lib, /: \[\],/, 'absent capabilityGaps must fall back to an empty list');
});
