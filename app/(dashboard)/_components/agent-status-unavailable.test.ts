// node --test "app/(dashboard)/_components/agent-status-unavailable.test.ts"
//
// UNAVAILABLE MUST NOT RENDER AS HEALTHY.
//
// The agent-detail envelope reports the sections it could not read. Every one
// of those sections has an "empty" value that is indistinguishable from a good
// result — a null checklist, an empty warning list, no grade, an empty run
// list. Before this, the page consumed those values directly, so a failed read
// rendered as:
//   · an actionable "Activate" for an agent whose readiness nobody checked;
//   · no connection banner, i.e. "all your accounts are fine";
//   · "No runs yet", a factual claim about history we never read.
//
// The behavioural half of this lives in lib/agent-detail.test.ts (the reader)
// and the render harness below (the button). This file pins the wiring the
// server component performs, which a .tsx server component cannot be imported
// to exercise — the codebase's established pattern for that.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render } from '../../../lib/test/render.ts';

const dir = import.meta.dirname;
const page = readFileSync(join(dir, '..', 'workflows', '[slug]', 'page.tsx'), 'utf8');

test('a backend read failure is NOT rendered as a missing agent', () => {
  // 'unavailable' used to fall through to the schedule-only branch, which
  // calls notFound() for an agent with no schedule row — so a blip told the
  // owner their agent had been deleted. The explicit branch must come BEFORE
  // the `if (!workflow)` fallback, or it can never run.
  // Ordering is asserted over CODE, not prose: the comments here explain the
  // notFound() path they replaced, and matching those would compare an
  // explanation's position against real control flow.
  const code = page.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const unavailableAt = code.indexOf("detailResult.status === 'unavailable'");
  const fallbackAt = code.indexOf('if (!workflow) {');
  const notFoundAt = code.indexOf('notFound()');
  assert.ok(unavailableAt > -1, 'the page must handle the unavailable status explicitly');
  assert.ok(unavailableAt < fallbackAt, 'it must be handled BEFORE the schedule-only fallback');
  assert.ok(unavailableAt < notFoundAt, 'and before any notFound() path');
  assert.match(page, /Agent status unavailable/);
  assert.match(page, /does not mean the agent[\s\S]{0,40}is gone/,
    'the copy must say the read failed, not that the agent is missing');
});

test('an unreadable schedule list withholds the editor instead of showing "no schedule"', () => {
  // ScheduleManager REPLACES any existing routine on save, so rendering its
  // empty state over a failed read invites overwriting a cadence the user was
  // never shown.
  assert.match(page, /schedulesUnavailable \? \(/,
    'the Schedule card must branch on the unavailable flag');
  const guardAt = page.indexOf('schedulesUnavailable ? (');
  const managerAt = page.indexOf('<ScheduleManager');
  assert.ok(guardAt > -1 && guardAt < managerAt, 'the guard must gate the editor, not follow it');
  assert.match(page, /editing is disabled to[\s\S]{0,60}replacing a schedule you cannot see/);
});

test('the page branches on isUnavailable, never on a section value being empty', () => {
  assert.match(page, /const activationUnavailable = detail!\.isUnavailable\('activation'\)/);
  assert.match(page, /const connectionsUnavailable = detail!\.isUnavailable\('connections'\)/);
  assert.match(page, /const actionsBlocked = activationUnavailable \|\| connectionsUnavailable/,
    'the run action depends on readiness AND reachability; either being unread must withhold it');
});

test('both AgentActions instances are blocked, not just the header one', () => {
  const wired = page.match(/statusUnavailable=\{actionsBlocked\}/g) || [];
  assert.equal(wired.length, 2,
    'the Setup tab renders its own AgentActions — a Run button there is just as live as the header one');
});

test('the unavailable notice names each section and says running is paused', () => {
  assert.match(page, /Some status could not be loaded/);
  assert.match(page, /Setup and readiness status unavailable/);
  assert.match(page, /Connection status unavailable/);
  assert.match(page, /Running is paused until this loads/);
});

test('an unread run history does not render as the "No runs yet" empty state', () => {
  assert.match(page, /const runsPanel = \(\) => runsUnavailable \?/,
    'the unavailable branch must come BEFORE the length check, or empty wins');
  assert.match(page, /Run history unavailable/);
  assert.match(page, /This is not the same as having none/);
});

// ── the button itself, rendered ──────────────────────────────────────────────

test('RENDERED: statusUnavailable withholds the primary action entirely', async () => {
  const blocked = await render('agent-actions.tsx', {
    slug: 'daily-brief', name: 'Daily Brief', isActive: true, statusUnavailable: true,
  }, { bridge: null });
  try {
    assert.ok(blocked.queryByText('Status unavailable'), 'the button says what is wrong');
    assert.equal(blocked.queryByText('▶ Run now'), null, 'no Run now on an unverified basis');
    assert.equal(blocked.queryByText('Activate'), null, 'and no Activate either');
  } finally { blocked.cleanup(); }
});

test('RENDERED: the same agent WITHOUT the flag still offers Run now', async () => {
  // The negative control — proves the assertion above is about the flag and
  // not about the harness failing to render a button at all.
  const healthy = await render('agent-actions.tsx', {
    slug: 'daily-brief', name: 'Daily Brief', isActive: true, statusUnavailable: false,
  }, { bridge: null });
  try {
    assert.ok(healthy.queryByText('▶ Run now'));
    assert.equal(healthy.queryByText('Status unavailable'), null);
  } finally { healthy.cleanup(); }
});

test('RENDERED: a blocked agent also loses the secondary "watch it run" path', async () => {
  const blocked = await render('agent-actions.tsx', {
    slug: 'daily-brief', name: 'Daily Brief', isActive: true, statusUnavailable: true,
  }, { bridge: null });
  try {
    assert.equal(blocked.queryByText(/watch/i), null,
      'withholding only the primary button would leave a second live way to start the same run');
  } finally { blocked.cleanup(); }
});
