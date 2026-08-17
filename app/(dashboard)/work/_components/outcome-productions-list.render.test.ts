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

test('every production links to its own monitor', async () => {
  const rendered = await render('../work/_components/outcome-productions-list.tsx', {
    load: { status: 'ready', productions },
  });
  try {
    const hrefs = Array.from(rendered.document.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    for (const production of productions) {
      assert.ok(hrefs.includes(`/runs/productions/${production.id}`), production.id);
    }
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
