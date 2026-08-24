// node --test "app/(dashboard)/work/_components/outcome-productions-list.render.test.ts"
//
// The way back to a production that is already running. Before this list
// existed, /runs/productions/[id] was reachable only from the redirect that
// created it: navigating away stranded the work, its budget, and its one stop
// control behind a URL the user no longer had.

import test from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../../../../lib/test/render.ts';
import { parseProductionListResponse } from '../../../../lib/outcome-production.ts';
import fixture from '../../../../test-fixtures/generated/outcome-orchestration.json' with { type: 'json' };

const productions = parseProductionListResponse(fixture.responses.list)!;

test('every material production links to its own monitor while an older duplicate draft is hidden', async () => {
  const rendered = await render('../work/_components/outcome-productions-list.tsx', {
    load: { status: 'ready', productions },
  });
  try {
    const hrefs = Array.from(rendered.document.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    for (const production of productions.filter((item) => item.state !== 'planning')) {
      assert.ok(hrefs.includes(`/runs/productions/${production.id}`), production.id);
    }
    const olderDraft = productions.find((item) => item.state === 'planning')!;
    assert.equal(hrefs.includes(`/runs/productions/${olderDraft.id}`), false);
    assert.match(rendered.text(), /1 running/, 'unsettled work is counted, from the backend flag');
    assert.match(rendered.text(), /spent/);
  } finally { rendered.cleanup(); }
});

test('a ready production is never counted as running', async () => {
  const ready = { ...productions[0], id: productions[0].id, state: 'ready', settled: false };
  const rendered = await render('../work/_components/outcome-productions-list.tsx', {
    load: { status: 'ready', productions: [ready] },
  });
  try {
    assert.match(rendered.text(), /1 pending/);
    assert.doesNotMatch(rendered.text(), /1 running/);
    assert.ok(rendered.queryByText('Ready'), 'the row still states what it is');
  } finally { rendered.cleanup(); }
});

test('replans render as one newest unstarted draft instead of many versions', async () => {
  const base = {
    ...productions[0], state: 'ready', settled: false, children: [],
    progress: { completedNodes: 0, totalNodes: 2 },
    budget: { ...productions[0].budget, reservedCredits: 0, spentCredits: 0 },
  };
  const newest = { ...base, id: '10000000-0000-4000-8000-000000000001' };
  const older = { ...base, id: '10000000-0000-4000-8000-000000000002' };
  const legacyInstructionDraft = {
    ...base,
    id: '10000000-0000-4000-8000-000000000003',
    goal: `${base.goal} Run instructions for this production: make it cinematic.`,
  };
  const rendered = await render('../work/_components/outcome-productions-list.tsx', {
    load: { status: 'ready', productions: [newest, older, legacyInstructionDraft] },
  });
  try {
    const hrefs = Array.from(rendered.document.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    assert.deepEqual(hrefs, [`/runs/productions/${newest.id}`]);
    assert.match(rendered.text(), /1 pending/);
  } finally { rendered.cleanup(); }
});

test('same-outcome work is never collapsed after it starts, reserves, spends, or settles', async () => {
  const base = {
    ...productions[0], goal: 'Produce the same final video', children: [],
    progress: { completedNodes: 0, totalNodes: 2 },
  };
  const rows = [
    { ...base, id: '20000000-0000-4000-8000-000000000001', state: 'running', settled: false },
    { ...base, id: '20000000-0000-4000-8000-000000000002', state: 'ready', settled: false, budget: { ...base.budget, reservedCredits: 1 } },
    { ...base, id: '20000000-0000-4000-8000-000000000003', state: 'succeeded', settled: true },
  ];
  const rendered = await render('../work/_components/outcome-productions-list.tsx', {
    load: { status: 'ready', productions: rows },
  });
  try {
    assert.equal(rendered.document.querySelectorAll('a').length, rows.length);
  } finally { rendered.cleanup(); }
});

test('a deployment without the route renders nothing at all', async () => {
  const rendered = await render('../work/_components/outcome-productions-list.tsx', {
    load: { status: 'absent' },
  });
  try {
    assert.equal(rendered.text(), '', 'no warning about a capability the backend never offered');
  } finally { rendered.cleanup(); }
});

test('an unreadable list says so — it never renders as "you have none"', async () => {
  const rendered = await render('../work/_components/outcome-productions-list.tsx', {
    load: { status: 'unavailable', reason: 'The productions response did not match the contract.' },
  });
  try {
    assert.ok(rendered.document.querySelector('[role="status"][aria-label="Productions unavailable"]'));
    assert.match(rendered.text(), /not the same as having none/);
    assert.equal(rendered.document.querySelector('a'), null, 'nothing is claimed to link to');
  } finally { rendered.cleanup(); }
});

test('a genuinely empty list renders nothing at all', async () => {
  const rendered = await render('../work/_components/outcome-productions-list.tsx', {
    load: { status: 'ready', productions: [] },
  });
  try {
    assert.equal(rendered.text(), '');
  } finally { rendered.cleanup(); }
});
