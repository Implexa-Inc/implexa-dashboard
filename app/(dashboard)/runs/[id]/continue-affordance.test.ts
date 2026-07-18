// node --test "app/(dashboard)/runs/[id]/continue-affordance.test.ts"
// (Node 22.6+ strips the types natively)
//
// REGRESSION GUARD — "a finished run must never dead-end" (founder rule).
//
// What broke (2026-07-18): <RunActions> consolidated ~10 controls into one surface
// and its own comment says it "replaces … the always-open Continue box". But it is
// rendered ONLY when `held` (review_status pending|needs_input). So a cleanly
// finished run — Done + Verified, real deliverable — lost every path to iterate on
// its output. <RunContinueBox/> still documented case 3 ("iterate on a finished
// run's output") but was rendered nowhere except the inbox, and the inbox only
// lists runs needing attention, so a finished run appeared in neither surface.
// The founder hit this on a judge-verified video-assembly run: wanted to give
// feedback and continue, found nothing.
//
// This page is a .tsx server component, so it cannot be imported here (Node's
// built-in TS support strips types but never transforms JSX). Pinning the SOURCE
// structure is the same guard pattern this codebase already uses server-side
// (see implexa-backend/src/services/run-request.browser-verified.test.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const page = readFileSync(join(import.meta.dirname, 'page.tsx'), 'utf8');

test('the run page imports RunContinueBox — the universal continue affordance', () => {
  assert.match(
    page,
    /import RunContinueBox from '\.\.\/\.\.\/_components\/run-continue-box';/,
    'RunContinueBox must be imported — without it a finished run has no continue path',
  );
});

test('a NON-held run with a deliverable renders the continue box', () => {
  // The gating must be `!held && r.output_markdown` — NOT held-only (that was the
  // regression) and NOT unconditional (a failed run with no deliverable already has
  // "Run again" + <StuckRunButton>; stacking a second CTA there was never the ask).
  // Anchor on the RENDER form (`<RunContinueBox runId=`), never the bare tag name —
  // the surrounding comment mentions `<RunContinueBox/>` by name, and a plain
  // indexOf matches that prose first and silently asserts against the wrong span.
  const idx = page.indexOf('<RunContinueBox runId=');
  assert.ok(idx !== -1, 'RunContinueBox must be rendered on the run page');

  // Walk back to the conditional that guards this render.
  const before = page.slice(Math.max(0, idx - 400), idx);
  assert.match(
    before,
    /\{!held && r\.output_markdown && \(/,
    'the continue box must be gated on !held && r.output_markdown — a finished run with a deliverable',
  );
});

test('the held path still owns its own continue (no double CTA)', () => {
  // <RunActions> carries the held-run continue ("Answer & continue" / "Continue &
  // re-run"). It must stay held-gated so the two never stack on one run.
  const actionsIdx = page.indexOf('<RunActions');
  assert.ok(actionsIdx !== -1, 'RunActions must still render for held runs');
  const before = page.slice(Math.max(0, actionsIdx - 300), actionsIdx);
  assert.match(before, /\{held && \(/, 'RunActions must remain gated on `held`');

  // And the two conditions must be mutually exclusive by construction: one `held`,
  // one `!held`. If someone later drops the `!` this assertion is what catches it.
  const continueIdx = page.indexOf('<RunContinueBox runId=');
  assert.ok(actionsIdx < continueIdx, 'held actions render above the finished-run continue box');
});
