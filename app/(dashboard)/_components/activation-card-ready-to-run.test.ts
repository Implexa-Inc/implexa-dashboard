// node --test "app/(dashboard)/_components/activation-card-ready-to-run.test.ts"
// (Node 22.6+ strips the types natively)
//
// REGRESSION GUARD (2026-07-22 review, P1) — an agent with a required
// capability gap (no viable tool for something the job cannot deliver
// without — see CapabilityGapsNotice) must never show the plain green
// "Active — runs hands-free" claim or "first run" CTA. `readyToRun` was
// already parsed onto the checklist (lib/activation.ts) but nothing read
// it: an agent could sit on a real gap and still render fully green.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(import.meta.dirname, 'activation-card.tsx'), 'utf8');

test('verifiedHandsFree requires capabilityReady, not just verification + computer use', () => {
  assert.match(
    src,
    /const capabilityReady = checklist\.readyToRun !== false;/,
    'capabilityReady must default open (undefined -> ready) so an older backend never regresses',
  );
  assert.match(
    src,
    /const verifiedHandsFree = isActive && verification\.verified && computerUseSatisfied && capabilityReady;/,
    'a required capability gap must block the hands-free claim exactly like an unverified Class-2 grant does',
  );
});

test('the "Active" badge downgrades to "needs a check" when a required capability is unmet', () => {
  const badgeIdx = src.indexOf('const badge = (checklist.state === ');
  assert.ok(badgeIdx !== -1, 'badge computation must still exist');
  const badgeLine = src.slice(badgeIdx, src.indexOf('\n', badgeIdx + 200));
  assert.match(
    badgeLine,
    /!verification\.verified \|\| !computerUseSatisfied \|\| !capabilityReady/,
    'the badge override condition must include capabilityReady alongside the existing verification/computer-use checks',
  );
});

test('the first-run CTA has a distinct branch for an unmet capability, not a silent fall-through to green', () => {
  // The original bug: verifiedHandsFree=false with no matching computerUseCheck/
  // browserCheck branch fell all the way to the final plain-green "Active. Take
  // it for its first run" span — exactly the state a capability gap produces
  // (it is neither a computer-use nor a browser check).
  const start = src.indexOf('{verifiedHandsFree ? (');
  assert.ok(start !== -1, 'the first-run CTA ternary chain must still exist');
  const end = src.indexOf('{showStallNudge && (', start);
  const block = src.slice(start, end);
  assert.match(
    block,
    /: !capabilityReady \? \(/,
    'a dedicated !capabilityReady branch must sit before the final plain-green fallback',
  );
  assert.match(
    block,
    /can&apos;t yet deliver part of its result/,
    'the capability-gap branch must say so, not reuse the computer-use/browser copy',
  );
  // The fallback branch must come AFTER the capabilityReady branch, so it is
  // truly the last resort (all other conditions checked first).
  const capIdx = block.indexOf('!capabilityReady ?');
  const fallbackIdx = block.indexOf("✓ Active. Take it for its first run:");
  assert.ok(capIdx !== -1 && fallbackIdx !== -1 && capIdx < fallbackIdx, 'the capability-gap branch must precede the plain-green fallback');
});
