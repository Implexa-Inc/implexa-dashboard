// node --test "app/(dashboard)/workflows/[slug]/fresh-read-order.test.ts"
// (Node 22.6+ strips the types natively)
//
// REGRESSION GUARD — the owner's own agent page must never show a stale cached
// copy right after the owner's own edit.
//
// What broke (2026-07-18): founder used revise_workflow (via a "revise" run
// request) to add a Runway ML b-roll step to their own agent. It landed
// correctly in the database (confirmed directly) within seconds. But the agent's
// detail page — which the founder had open — kept showing the OLD step list.
//
// Root cause: `getWorkflow` (workflow-catalog.ts) is a PUBLIC catalog read,
// cached by Next.js's fetch Data Cache for 600 seconds (`callMcpTool(..., 600)`)
// — a deliberate, reasonable tradeoff for browsing someone ELSE's shared agent.
// `getMyWorkflow` is the owner-scoped, always-fresh twin (`cache: 'no-store'`).
// The page tried the CACHED public read FIRST and only fell back to the fresh
// owner-scoped read if the public read failed outright (`||` short-circuits on
// the first truthy result). This agent is `shared: true`, so the cached public
// read always succeeded — serving up to 10 minutes of staleness after every
// edit to a shared agent, exactly when freshness matters most (the owner just
// changed it and is looking at it).
//
// Fix: try the owner-scoped fresh read FIRST. It correctly returns null for an
// agent that isn't the caller's own, so this costs one cheap extra round-trip on
// the browse-someone-else's-public-agent path and never masks a real 404.
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

function readOrderBlock() {
  const start = page.indexOf('const source = searchParams.source');
  assert.ok(start !== -1, 'the source/workflow-resolution block must still exist');
  const end = page.indexOf('\n\n', page.indexOf('const workflow = w'));
  assert.ok(end !== -1, 'could not find the end of the workflow-resolution block');
  return page.slice(start, end);
}

test('getMyWorkflow (owner-scoped, always-fresh) is attempted BEFORE getWorkflow (public, 600s-cached)', () => {
  const block = readOrderBlock();
  const myIdx = block.indexOf('getMyWorkflow(');
  const publicIdx = block.indexOf('getWorkflow(');
  assert.ok(myIdx !== -1, 'getMyWorkflow must still be called in this block');
  assert.ok(publicIdx !== -1, 'getWorkflow must still be called in this block');
  assert.ok(
    myIdx < publicIdx,
    'getMyWorkflow must be tried before getWorkflow — trying the 600s-cached public read first is exactly the regression: it can serve a stale copy for up to 10 minutes right after the owner\'s own edit',
  );
});

test('the fresh read still falls back to the public catalog read (browsing someone else\'s shared agent still works)', () => {
  const block = readOrderBlock();
  assert.match(
    block,
    /const w = mine \|\| \(await getWorkflow\(/,
    'must still fall back to the public read when the agent is not the caller\'s own (mine is null)',
  );
  assert.match(
    block,
    /const workflow = w \|\| \(await getWorkflow\(/,
    'must still try the other known source before giving up entirely',
  );
});
