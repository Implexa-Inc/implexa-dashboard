// node --test "app/(dashboard)/workflows/[slug]/fresh-read-order.test.ts"
// (Node 22.6+ strips the types natively)
//
// REGRESSION GUARD — the owner's own agent page must never show a stale cached
// copy right after the owner's own edit, and must never regrow the request
// waterfall the detail envelope removed.
//
// History (2026-07-18): the page tried the 600s-cached PUBLIC catalog read
// before the owner-scoped fresh read; a founder's just-landed revise stayed
// invisible for up to 10 minutes. The fix was owner-fresh-first probing. The
// envelope migration (2026-08) then collapsed the whole probe chain into ONE
// authenticated, never-cached read: GET /api/v2/me/agents/:slug/detail
// (lib/agent-detail.ts, cache: 'no-store'), whose backend resolver applies the
// same owner-first source preference — so freshness-after-edit is now a
// property of the single read, and the stale-cache ordering bug has no code
// path to come back through. This guard pins BOTH properties:
//   1. the page reads through getAgentDetail (fresh, owner-scoped), never
//      through the cached public getWorkflow / the removed probe chain;
//   2. the roster-wide reads (getMyAgents for one grade, getConnectionStatus
//      for one agent's warnings) stay gone.
//
// This page is a .tsx server component (cannot be imported here — Node's
// built-in TS support strips types but never transforms JSX), so this pins the
// SOURCE structure directly — this codebase's established pattern (see
// runs/[id]/continue-affordance.test.ts, _components/agent-actions-external-poll.test.ts).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const page = readFileSync(join(import.meta.dirname, 'page.tsx'), 'utf8');
const envelopeLib = readFileSync(join(import.meta.dirname, '../../../../lib/agent-detail.ts'), 'utf8');

test('the page reads through the ONE owner-scoped envelope (getAgentDetail), not the legacy probe chain', () => {
  assert.match(page, /getAgentDetail\(params\.slug, session\.access_token/,
    'the envelope read must be the workflow source and must reuse the page\'s one session token');
  assert.doesNotMatch(page, /\bgetMyWorkflow\(/,
    'the serial owner-probe chain must not come back — the envelope covers it');
  assert.doesNotMatch(page, /\bgetWorkflow\(/,
    'the 600s-cached public read must not come back on this page — it is exactly the 2026-07-18 staleness regression');
});

test('the envelope read itself is never cached (owner freshness after an edit)', () => {
  assert.match(envelopeLib, /cache: 'no-store'/,
    'getAgentDetail must stay no-store — a cached envelope resurrects the stale-after-revise bug');
});

test('roster-wide reads stay OFF this page (no /me/agents for one grade, no full-roster connections)', () => {
  assert.doesNotMatch(page, /\bgetMyAgents\(/,
    'the page must not fetch the whole roster to extract one agent\'s grade');
  assert.doesNotMatch(page, /getConnectionStatus\(/,
    'the page must not compute connection state for the complete roster; the envelope carries this agent\'s warnings');
});

test('the marketplace discovery probe runs in PARALLEL with the envelope, not as a serial hop in front of it', () => {
  const detailStart = page.indexOf('const detailPromise = getAgentDetail(');
  const resumeAwait = page.indexOf('await getAgentResume(');
  const detailAwait = page.indexOf('await detailPromise');
  assert.ok(detailStart !== -1 && resumeAwait !== -1 && detailAwait !== -1, 'both reads must still exist');
  assert.ok(detailStart < resumeAwait, 'the envelope fetch must START before the discovery probe is awaited');
  assert.ok(detailAwait > resumeAwait, 'the envelope is consumed after the marketplace early-return');
});

test('lifecycle truth is still derived ON the page from the raw envelope rows', () => {
  assert.match(page, /isRevisePending\(reqRows, newestVersionAt\(workflow\.versions\)\)/,
    'revise-pending must stay a page-side derivation over raw rows + version timestamps');
});
