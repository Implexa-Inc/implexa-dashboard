// node --test lib/attention.test.ts
//
// The Needs You surface integration.
//
// TWO FAILURE MODES ARE GUARDED HERE, and they are not equally obvious:
//
//   1. FALSE ALL-CLEAR. An unreachable endpoint must never read as "nothing needs
//      you". The backend goes to real trouble to avoid this (503 instead of an
//      empty list; per-source `partial`), and all of it is undone by a client that
//      degrades to a calm empty state the way getConnectionStatus does.
//
//   2. SILENT FUNCTIONALITY LOSS. Integrating the endpoint meant editing a loader
//      that also owns grants, sign-ins and missed schedules — none of which the
//      endpoint covers. A refactor that quietly drops one of those is invisible in
//      review and invisible at runtime until a user needs the thing that vanished.
//      The source guards below exist because that was the actual proposed design
//      (replace loadNeedsYou wholesale) before it was corrected.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { attentionWarning } from './attention.ts';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

// ── 1. The all-clear may only be claimed when the list is verified complete ──

test('an UNREACHABLE endpoint is not an empty list', () => {
  // live:false is the "we could not check" state. If this returns null the page
  // renders its celebratory ✓ over work the user cannot see.
  assert.ok(attentionWarning({ partial: true, truncated: false, live: false }),
    'an unreachable endpoint MUST produce a visible warning');
  assert.match(String(attentionWarning({ partial: true, truncated: false, live: false })), /incomplete/i);
});

test('partial and truncated each independently forbid an all-clear', () => {
  assert.ok(attentionWarning({ partial: true, truncated: false, live: true }), 'a failed source must warn');
  assert.ok(attentionWarning({ partial: false, truncated: true, live: true }), 'a truncated list must warn');
  assert.equal(attentionWarning({ partial: false, truncated: false, live: true }), null,
    'and a verified-complete list must NOT nag — a warning that always shows is ignored');
});

test('truncation is described as incompleteness, not as a technical detail', () => {
  const w = String(attentionWarning({ partial: false, truncated: true, live: true }));
  assert.match(w, /not complete|more items/i, 'the user needs to know the list is short, not what MAX_ITEMS is');
});

// ── 2. The client never degrades to a clean empty ────────────────────────────

test('getAttention returns partial=true on ANY failure path — never a calm empty', () => {
  const src = read('lib/attention.ts');
  // Every early-return that is not the happy path must go through UNAVAILABLE.
  const returns = src.match(/return\s+UNAVAILABLE/g) || [];
  assert.ok(returns.length >= 3,
    'the !res.ok, !body.ok and catch paths must ALL return the honest-unavailable value');
  assert.match(src, /partial:\s*true/, 'UNAVAILABLE must assert partial');
  // Scoped to getAttention's own body: attentionWarning returns null BY DESIGN
  // (null means "verified complete"), so a whole-file check here would be both
  // wrong and permanently red.
  const body = src.slice(src.indexOf('export async function getAttention'), src.indexOf('export function attentionWarning'));
  assert.ok(body.length > 200, 'the getAttention body must be found for this guard to mean anything');
  assert.doesNotMatch(body, /return\s+null/,
    'returning null from the FETCHER would let a caller treat "unknown" as "nothing" — the whole bug');
});

// ── 3. No silent functionality loss in the loader ────────────────────────────

test('the loader still owns grants, sign-ins and missed schedules', () => {
  // The endpoint covers NONE of these. Replacing the loader wholesale (the first
  // proposed design) would have deleted all three with no visible error.
  const src = read('lib/needs-you.ts');
  for (const [what, needle] of [
    ['key/permission grants', 'needsIntervention'],
    ['account sign-ins', "n.status !== 'unreachable'"],
    ['missed schedules', 'looksOverdue'],
    ['never-armed schedules', 'isNeverArmed'],
  ] as const) {
    assert.ok(src.includes(needle), `${what} must still be derived here — the endpoint does not cover it`);
  }
});

test('the STALL query stays until the backend actually emits stalls', () => {
  // The backend read model passes `stalls: []` deliberately (recovery, PR #52).
  // Dropping this read now would trade working stall visibility for nothing.
  const src = read('lib/needs-you.ts');
  assert.match(src, /run_state'?\s*,\s*'stalled'|eq\('run_state',\s*'stalled'\)/,
    'stalled runs must still be read directly while the unified feed returns none');
});

test('the duplicated approval read is GONE — one read model, not two', () => {
  const src = read('lib/needs-you.ts');
  assert.doesNotMatch(src, /review_status['"]?\s*,\s*['"]pending/,
    'reading held runs here as well as from the endpoint recreates the drift the backend derives to avoid');
  assert.match(src, /getAttention\(\)/, 'held runs now come from the unified endpoint');
});

// ── 3b. partial ORs EVERY source, not only the endpoint ──────────────────────

test('every source failing silently feeds partial — not just /me/needs-you', () => {
  // Each of these four fails without throwing (null return / query error) and
  // each hides a whole class of work. If partial stays false while any is dark,
  // the surface renders a false all-clear over, e.g., a grant the user must give.
  const src = read('lib/needs-you.ts');
  assert.match(src, /if \(myAgents === null\) unavailableSources\.push/, 'agents-down (hides grants) must feed partial');
  assert.match(src, /if \(status === null\) unavailableSources\.push/, 'connections-down (hides sign-ins) must feed partial');
  assert.match(src, /if \(schedRes\.error\) unavailableSources\.push/, 'schedule error (hides missed/unarmed) must feed partial');
  assert.match(src, /if \(stallRes\.error\) unavailableSources\.push/, 'stall error (hides stalled runs) must feed partial');
  assert.match(src, /partial: attention\.partial \|\| unavailableSources\.length > 0/,
    'partial must OR the endpoint flag with the local sources, not read either alone');
  assert.doesNotMatch(src, /partial:\s*attention\.partial\s*,/,
    'reading only the endpoint back into partial is the exact silent-source bug');
});

test('the retained schedule/stall limits carry truncation — fetch limit+1, slice, flag overflow', () => {
  // Without this, the 101st schedule or 11th stall — which might itself be the
  // thing needing a human — silently disappears while the list looks complete.
  const src = read('lib/needs-you.ts');
  assert.match(src, /\.limit\(SCHED_LIMIT \+ 1\)/, 'must over-fetch schedules to detect a full page');
  assert.match(src, /\.limit\(STALL_LIMIT \+ 1\)/, 'must over-fetch stalls');
  assert.match(src, /schedTruncated = \(schedRes\.data\?\.length \|\| 0\) > SCHED_LIMIT/);
  assert.match(src, /stallTruncated = \(stallRes\.data\?\.length \|\| 0\) > STALL_LIMIT/);
  assert.match(src, /\.slice\(0, SCHED_LIMIT\)/, 'and slice for display, or the extra row renders');
  assert.match(src, /\.slice\(0, STALL_LIMIT\)/);
  assert.match(src, /truncated: attention\.truncated \|\| schedTruncated \|\| stallTruncated/,
    'the local overflows must reach the surface alongside the endpoint ceiling');
});

// ── 4. Every all-clear surface is gated ──────────────────────────────────────

test('EVERY "nothing needs you" surface is gated on partial and truncated', () => {
  for (const p of ['app/(dashboard)/connections/page.tsx', 'app/(dashboard)/overview/page.tsx']) {
    const src = read(p);
    const claim = /Nothing needs you/.test(src);
    assert.ok(claim, `${p} still makes an all-clear claim (update this test if that changed)`);
    assert.match(src, /!\w+\.partial\s*&&\s*!\w+\.truncated/,
      `${p} must suppress its all-clear when the list is not verified complete`);
  }
});

test('Home inbox all-clear also requires an EMPTY Set-up strip', () => {
  // The Home "Nothing needs you yet" sits directly below <NeedsYouStrip>. An
  // empty INBOX does not mean nothing needs you — the strip above can hold
  // grants, sign-ins, schedules, or Judge blocks. Gating only on items.length
  // makes the page contradict itself.
  const src = read('app/(dashboard)/overview/page.tsx');
  assert.match(src, /items\.length === 0 && needsYou\.homeCount === 0 && !needsYou\.partial && !needsYou\.truncated/,
    'the inbox all-clear must also require homeCount === 0');
});

test('the strip renders its warning even when it has NOTHING to list', () => {
  // The dangerous case: zero items AND an unread source. An early `if (count === 0)
  // return null` here would hand the page straight back to its all-clear branch.
  const src = read('app/(dashboard)/_components/needs-you-strip.tsx');
  assert.match(src, /count === 0 && !warning/,
    'an empty-but-incomplete list must still render the warning rather than vanishing');
});

// ── 5. Judge blocks are reachable from the page the user lands on ────────────

test('Judge blocks appear on HOME — Alerts cannot show them', () => {
  // RunningAgents alertsOnly polls /scheduled-skills/live, which has no notion of
  // a verdict. Without a home slot a blocked verdict is invisible on the landing
  // page, which defeats the release.
  const src = read('lib/needs-you.ts');
  assert.match(src, /homeAttention/, 'home needs its own attention subset');
  assert.match(src, /sourceType === 'judge_block'/, 'and it is the Judge blocks specifically');
  assert.match(src, /homeCount = [^;]*homeAttention\.length/,
    'a home item that is not counted does not render — the strip returns null on count 0');
});

test('total does not DOUBLE-COUNT Judge blocks', () => {
  // homeCount folds in homeAttention (Judge blocks). If total is computed as
  // homeCount + attentionItems.length, every Judge block is counted twice — it
  // renders once but inflates the badge and could hold /connections out of its
  // empty state over nothing.
  const src = read('lib/needs-you.ts');
  assert.doesNotMatch(src, /const total = homeCount \+ attentionItems\.length/,
    'total must be built from setupCount, not homeCount, or Judge blocks are counted twice');
  assert.match(src, /const total = setupCount \+ attentionItems\.length \+ stalled\.length/,
    'total = setup + all run-level attention (once each) + stalls');
  assert.match(src, /const homeCount = setupCount \+ homeAttention\.length/,
    'home = setup + Judge blocks only');
});

test('held runs are NOT double-listed on home', () => {
  // Alerts already owns them there. Two cards for one run makes the user reconcile
  // which to act on.
  const src = read('lib/needs-you.ts');
  const line = src.split('\n').find((l) => l.includes('homeAttention') && l.includes('filter')) || '';
  assert.doesNotMatch(line, /held_run/, 'home must not list held runs while Alerts still shows them');
});

test('a Judge block is not rendered as an approval', () => {
  // The old card said "your approval needed" / "Review & approve" for everything.
  // A block asking for information is not an approval, and resolves elsewhere.
  const src = read('app/(dashboard)/_components/needs-you-strip.tsx');
  assert.match(src, /primaryAction\.label/, 'the CTA must come from the typed action the source named');
  assert.doesNotMatch(src, /title=\{`\$\{a\.name\} — your approval needed`\}/,
    'the hardcoded approval copy must be gone');
});
