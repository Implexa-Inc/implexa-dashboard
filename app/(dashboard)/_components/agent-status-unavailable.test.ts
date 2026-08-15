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
