// Advisories reaching the dashboard AT ALL.
//
// The backend emitted them and the dashboard had no field, no mapper, no renderer, and
// dropped 'agent_browser' to null — so "visible, non-blocking" reached nothing. These
// pin the whole path rather than the shape of one function.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(process.cwd());
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('agent_browser is a real profile, not silently discarded', () => {
  // Converting it to null threw away exactly the provenance the backend added.
  const src = read('lib/connections.ts');
  assert.match(src, /export type ConnProfile = 'dedicated' \| 'main' \| 'agent_browser';/);
  assert.match(src, /new Set\(\['dedicated', 'main', 'agent_browser'\]\)/);
});

test('the envelope carries advisories and the response is mapped', () => {
  const src = read('lib/connections.ts');
  assert.match(src, /advisories: ConnectionAdvisory\[\];/, 'the type must have the field');
  assert.match(src, /mapAdvisories\(body\?\.advisories\)/, 'the response must actually be read');
  assert.match(src, /return \{ connections, agents, warnings, advisories, live: true \}/);
});

test('an advisory with no agent or no explanation is dropped, not shown vaguely', () => {
  const src = read('lib/connections.ts');
  const fn = src.slice(src.indexOf('function mapAdvisories'), src.indexOf('export function advisoriesForAgent'));
  assert.match(fn, /if \(!slug \|\| !detail\) return null;/,
    'an advisory that cannot be rendered honestly must not be rendered at all');
});

test('there is a renderer, and it is NOT styled as a failure', () => {
  // These accounts work. Dressing the weaker proof as a broken connection would send
  // the user to fix something that is not broken.
  const src = read('app/(dashboard)/_components/connection-attention-banner.tsx');
  assert.match(src, /export function ConnectionAdvisoryNote/);
  const fn = src.slice(src.indexOf('export function ConnectionAdvisoryNote'));
  assert.match(fn, /amber/, 'advisory styling must differ from the rose warning banner');
  assert.doesNotMatch(fn, /border-rose-500/, 'it must not reuse the failure treatment');
  assert.match(fn, /not the browser your agents\s*\n?\s*drive|browser your agents/,
    'it must say WHERE the check ran, which is the whole point');
});

test('the renderer is actually mounted on the accounts page', () => {
  // A component nobody renders is the same as no component — the previous round of
  // this work shipped exactly that.
  const page = read('app/(dashboard)/settings/connections/page.tsx');
  assert.match(page, /import \{ ConnectionAdvisoryNote \}/);
  assert.match(page, /<ConnectionAdvisoryNote advisories=\{status\.advisories\}/);
});

test('agent_browser is LABELLED as itself, not as main Chrome', () => {
  // A two-way isPrimary check displayed the strongest evidence — proof from the browser
  // agents actually drive — as "main · backup", the weakest.
  const page = read('app/(dashboard)/settings/connections/page.tsx');
  assert.match(page, /const PROFILE_TAG: Record<NonNullable<ConnectionAccount\['profile'\]>/,
    'exhaustive by value, so a new home cannot inherit someone else’s label');
  assert.match(page, /agent_browser: \{/);
  assert.match(page, /label: 'agents’ browser'/);
  assert.doesNotMatch(page, /const isPrimary = profile === 'dedicated';/,
    'the two-way check is what produced the mislabel');
});

// ── the three advisory cases (reviewed defect) ──────────────────────────────

test('advisory copy distinguishes workspace-only, stale-pin and mixed', () => {
  // The heading hardcoded "not yet checked in your agents' browser" for every advisory.
  // For a stale-pin advisory that is false: it WAS checked in an agents' browser, just
  // not the one selected now.
  const src = read('app/(dashboard)/_components/connection-attention-banner.tsx');
  assert.match(src, /const onlyStale = reasons\.size === 1 && reasons\.has\('verified_in_a_different_agent_browser'\)/);
  assert.match(src, /checked in a different agents’ browser than the one currently selected/);
  assert.match(src, /checked in the workspace browser, not yet in the browser your agents use/);
  assert.match(src, /signed in, but their proof does not match the browser your agents currently use/,
    'a mixed set must get neutral copy rather than one story that is wrong for the rest');
  // The old unconditional heading must be gone.
  assert.doesNotMatch(src, /\? `\$\{advisories\.length\} account\$\{advisories\.length === 1 \? '' : 's'\} not yet checked/);
});
