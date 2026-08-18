// node --test "app/(dashboard)/_components/outcome-production-monitor.render.test.ts"
//
// The production monitor, rendered. The invariants under guard:
//   1. Parent first: the accountable production leads; child activity is an
//      expandable section beneath it — no child ever renders above the parent
//      and no "AI team" tableau exists.
//   2. Exactly ONE stop control, on the parent, only while the backend says
//      the production can still be cancelled, and always behind a confirm.
//   3. Blockers render as the backend's typed words in a status region.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { render, type Rendered } from '../../../lib/test/render.ts';
import { shouldPollProduction, type Production } from '../../../lib/outcome-production.ts';
import fixture from '../../../test-fixtures/generated/outcome-orchestration.json' with { type: 'json' };

function stubFetch(rendered: Rendered, reply: { status: number; body: unknown }) {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  (rendered.window as unknown as Record<string, unknown>).fetch = async (url: string, init: { body: string }) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return { ok: reply.status < 300, status: reply.status, json: async () => reply.body };
  };
  return calls;
}

test('the parent renders first, with budget, progress, and expandable child activity', async () => {
  const rendered = await render('outcome-production-monitor.tsx', { production: fixture.productions.running });
  try {
    const text = rendered.text();
    const parentAt = text.indexOf(fixture.productions.running.goal);
    const childAt = text.indexOf('Cinematic Shot Generator');
    assert.ok(parentAt >= 0 && childAt >= 0 && parentAt < childAt, 'the parent leads; children follow');

    assert.ok(rendered.queryByText(/1 of 2 steps complete/));
    assert.ok(rendered.queryByText(/spent/), 'spend renders verbatim from the backend budget');
    const details = rendered.document.querySelector('details');
    assert.ok(details, 'child activity is an expandable section');
    assert.ok(details!.querySelector('ol'), 'children live inside it');
    assert.ok(rendered.queryByText(/Activity \(2 steps\)/));
  } finally { rendered.cleanup(); }
});

test('one stop control, parent-scoped, confirm-gated, wired to the cancel action', async () => {
  const rendered = await render('outcome-production-monitor.tsx', { production: fixture.productions.running });
  try {
    const calls = stubFetch(rendered, { status: 200, body: { ok: true } });
    const stops = rendered.document.querySelectorAll('[aria-label="Stop this production"]');
    assert.equal(stops.length, 1, 'exactly one stop control — stopping is a parent decision');

    await rendered.click(stops[0]);
    const dialog = rendered.document.querySelector('[role="dialog"]');
    assert.ok(dialog, 'stop asks first');
    assert.equal(calls.length, 0, 'opening the confirm sends nothing');

    await rendered.click(rendered.getByText('Stop production'));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.action, 'cancel');
    assert.equal(calls[0].body.productionId, fixture.productions.running.id);
  } finally { rendered.cleanup(); }
});

test('declining the confirm sends nothing', async () => {
  const rendered = await render('outcome-production-monitor.tsx', { production: fixture.productions.running });
  try {
    const calls = stubFetch(rendered, { status: 200, body: { ok: true } });
    await rendered.click(rendered.document.querySelector('[aria-label="Stop this production"]')!);
    await rendered.click(rendered.getByText('Keep running'));
    assert.equal(calls.length, 0);
    assert.equal(rendered.document.querySelector('[role="dialog"]'), null);
  } finally { rendered.cleanup(); }
});

test('a settled production offers no stop control at all', async () => {
  for (const state of ['succeeded', 'cancelled'] as const) {
    const rendered = await render('outcome-production-monitor.tsx', { production: fixture.productions[state] });
    try {
      assert.equal(rendered.document.querySelector('[aria-label="Stop this production"]'), null, state);
    } finally { rendered.cleanup(); }
  }
});

test('a failed production surfaces its typed blockers and is no longer cancellable', async () => {
  const rendered = await render('outcome-production-monitor.tsx', { production: fixture.productions.failed });
  try {
    const region = rendered.document.querySelector('[role="status"][aria-label="Production error"]');
    assert.ok(region, 'blockers are an explicit status region');
    assert.match(region!.textContent || '', /failed verification/i);
    assert.match(region!.textContent || '', /Production error/);
    assert.equal(rendered.queryByText('Waiting on you'), null);
    assert.equal(rendered.document.querySelector('[aria-label="Stop this production"]'), null);
  } finally { rendered.cleanup(); }
});

test('a partial production says its nodes settled and never asks the user to repair terminal work', async () => {
  const rendered = await render('outcome-production-monitor.tsx', { production: fixture.productions.partial });
  try {
    assert.ok(rendered.queryByText('Production error'));
    assert.ok(rendered.queryByText('2 of 2 steps settled'));
    assert.equal(rendered.queryByText('Waiting on you'), null);
    assert.equal(rendered.queryByText('2 of 2 steps complete'), null);
  } finally { rendered.cleanup(); }
});

test('an unsettled actionable blocker still says Waiting on you', async () => {
  const production = {
    ...fixture.productions.running,
    blockers: [{ reasonCode: 'input_required', detail: 'Choose a presenter video.' }],
  };
  const rendered = await render('outcome-production-monitor.tsx', { production });
  try {
    assert.ok(rendered.queryByText('Waiting on you'));
    assert.equal(rendered.queryByText('Production error'), null);
  } finally { rendered.cleanup(); }
});

test('unsettled work keeps re-reading itself; settled work does not', () => {
  // A monitor that never re-reads shows a snapshot that quietly becomes a lie:
  // the parent keeps claiming "Running · 1 of 2 steps · $19.00" while children
  // finish and real money moves.
  for (const key of ['running', 'ready'] as const) {
    assert.equal(shouldPollProduction(fixture.productions[key] as unknown as Production), true, key);
  }
  for (const key of ['succeeded', 'partial', 'cancelled', 'failed'] as const) {
    assert.equal(shouldPollProduction(fixture.productions[key] as unknown as Production), false, key);
  }
});

test('an unsettled monitor wakes backend reconciliation before its next read', () => {
  const source = readFileSync(new URL('./outcome-production-monitor.tsx', import.meta.url), 'utf8');
  assert.match(source, /action:\s*'reconcile'/, 'polling must advance durable child state, not only refresh a stale projection');
  assert.match(source, /setInterval\([^]*reconcileAndRefresh/, 'reconciliation remains attached to the unsettled polling loop');
  assert.doesNotMatch(source, /setInterval\(\(\)\s*=>\s*router\.refresh\(\)/, 'read-only polling recreates the incident');
});

test('a failed production renders its blockers and no stop control', async () => {
  const rendered = await render('outcome-production-monitor.tsx', { production: fixture.productions.failed });
  try {
    assert.ok(rendered.queryByText(/No deliverable completed/));
    assert.equal(rendered.document.querySelector('[aria-label="Stop this production"]'), null);
  } finally { rendered.cleanup(); }
});

test('an unconfirmable stop says so instead of pretending it landed', async () => {
  const rendered = await render('outcome-production-monitor.tsx', { production: fixture.productions.running });
  try {
    stubFetch(rendered, { status: 503, body: { ok: false, error: 'unreachable' } });
    await rendered.click(rendered.document.querySelector('[aria-label="Stop this production"]')!);
    await rendered.click(rendered.getByText('Stop production'));
    assert.match(rendered.text(), /couldn’t confirm the stop/);
  } finally { rendered.cleanup(); }
});
