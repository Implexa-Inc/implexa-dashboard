// node --test lib/navigation.test.ts
//
// The locked navigation model (DESIGN.md §4.1, §17), tested against the real
// exported data rather than a copy of it. The rendered counterparts live in
// test/shell-navigation.render.test.ts; these pin the model those renders read.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PRIMARY_NAV, SECONDARY_NAV, FORBIDDEN_PRIMARY_LABELS,
  ownsPath, isNavItemActive, activeNavItem,
  WORK_VIEWS, DEFAULT_WORK_VIEW, parseWorkView, workViewHref,
  LEGACY_ROUTE_REDIRECTS, legacyDestination,
  resolveDefaultLanding, isCreateFabSuppressed, anySignal,
  countNewerThan, mergeTimestamps, workSeenKey,
  DEFAULT_LANDING_ROUTE, postAuthDestination,
} from './navigation.ts';   // explicit extension: node:test resolves ESM, not bundler-style

test('primary navigation is exactly Agents, Work, Training — in that order', () => {
  assert.deepEqual(PRIMARY_NAV.map((i) => i.label), ['Agents', 'Work', 'Training']);
  assert.deepEqual(SECONDARY_NAV.map((i) => i.label), ['Settings']);
});

test('Home, Review, Marketplace and Discover are absent from primary navigation', () => {
  // The four entries the locked model removes or refuses. Home owned no unique
  // object; Review is a filter inside Work; Marketplace discovery lives inside
  // Agents and must not become a fourth domain.
  const labels = PRIMARY_NAV.map((i) => i.label);
  for (const banned of FORBIDDEN_PRIMARY_LABELS) {
    assert.ok(!labels.includes(banned), `"${banned}" must not be a primary navigation entry`);
  }
  const hrefs = [...PRIMARY_NAV, ...SECONDARY_NAV].map((i) => i.href);
  for (const banned of ['/overview', '/review', '/inbox', '/marketplace', '/discover', '/browse']) {
    assert.ok(!hrefs.includes(banned), `${banned} must not be a navigation destination`);
  }
});

test('ownsPath matches on a segment boundary, never a bare string prefix', () => {
  // THE TRAP: '/workflows'.startsWith('/work') is true. A naive prefix test lights
  // up BOTH Agents and Work on the Agents page, and it looks correct in review.
  assert.equal(ownsPath('/work', '/workflows'), false);
  assert.equal(ownsPath('/work', '/work'), true);
  assert.equal(ownsPath('/work', '/work/'), true);
  assert.equal(ownsPath('/work', '/work/anything'), true);
  assert.equal(ownsPath('/work', '/workspace'), false);
  assert.equal(ownsPath('/settings', '/settings/billing'), true);
});

test('exactly one domain claims any given path', () => {
  const paths = [
    '/workflows', '/workflows/my-agent', '/agents', '/browse', '/create',
    '/work', '/review', '/review/run-123', '/inbox', '/runs', '/runs/abc', '/overview',
    '/training', '/settings', '/settings/billing', '/install',
  ];
  for (const p of paths) {
    const claimants = [...PRIMARY_NAV, ...SECONDARY_NAV].filter((i) => isNavItemActive(i, p));
    assert.equal(claimants.length, 1, `${p} should be claimed by one domain, got ${claimants.map((c) => c.label).join(', ') || 'none'}`);
  }
});

test('deep links light up the domain that owns them', () => {
  // Being deep in a Review Room or on an agent page must not leave the shell
  // showing "nowhere".
  assert.equal(activeNavItem('/review/run-abc123')?.label, 'Work');
  assert.equal(activeNavItem('/inbox')?.label, 'Work');
  assert.equal(activeNavItem('/runs/9f2')?.label, 'Work');
  assert.equal(activeNavItem('/overview')?.label, 'Work');
  assert.equal(activeNavItem('/workflows/daily-brief')?.label, 'Agents');
  assert.equal(activeNavItem('/agents')?.label, 'Agents');
  assert.equal(activeNavItem('/training')?.label, 'Training');
  assert.equal(activeNavItem('/settings/api-keys')?.label, 'Settings');
  assert.equal(activeNavItem('/admin'), null, 'an unowned path claims no domain rather than guessing');
});

test('Work views are the three states Work owns, defaulting to Needs you', () => {
  assert.deepEqual([...WORK_VIEWS], ['needs', 'review', 'delivered']);
  assert.equal(DEFAULT_WORK_VIEW, 'needs');
  assert.equal(parseWorkView('review'), 'review');
  assert.equal(parseWorkView(['delivered']), 'delivered');
  // A junk or absent filter must not blank the page.
  assert.equal(parseWorkView(undefined), 'needs');
  assert.equal(parseWorkView('nonsense'), 'needs');
  assert.equal(workViewHref('needs'), '/work', 'the default view is the bare canonical URL');
  assert.equal(workViewHref('review'), '/work?view=review');
});

test('every legacy route resolves into a canonical domain', () => {
  const froms = LEGACY_ROUTE_REDIRECTS.map((r) => r.from);
  assert.ok(froms.includes('/review'), 'the Review queue must still resolve');
  assert.ok(froms.includes('/inbox'), 'Results must still resolve');
  for (const r of LEGACY_ROUTE_REDIRECTS) {
    const dest = r.to.split('?')[0];
    assert.ok(
      [...PRIMARY_NAV, ...SECONDARY_NAV].some((i) => isNavItemActive(i, dest)),
      `${r.from} redirects to ${r.to}, which no domain owns`,
    );
  }
});

test('a legacy redirect CARRIES the incoming query string', () => {
  // The reason this helper exists: result notifications address /inbox?run=<id>.
  // Dropping `run` lands the user on a list instead of the result they clicked.
  assert.equal(
    legacyDestination('/work?view=delivered', { run: 'run_9f2a' }),
    '/work?run=run_9f2a&view=delivered',
  );
  assert.equal(
    legacyDestination('/work?view=review', new URLSearchParams('agent=daily-brief')),
    '/work?agent=daily-brief&view=review',
  );
  assert.equal(legacyDestination('/workflows', undefined), '/workflows');
  assert.equal(legacyDestination('/workflows', {}), '/workflows');
});

test('the redirect target wins when the incoming query collides with it', () => {
  // /inbox?view=something must still land on the Delivered view — the target's
  // own `view` is the destination's claim, not the caller's.
  assert.equal(
    legacyDestination('/work?view=delivered', { view: 'review' }),
    '/work?view=delivered',
  );
});

test('the default landing follows the locked priority order', () => {
  assert.equal(resolveDefaultLanding({ needsDecision: 'yes', inProgress: 'no' }), '/work');
  assert.equal(resolveDefaultLanding({ needsDecision: 'no', inProgress: 'yes' }), '/work');
  assert.equal(resolveDefaultLanding({ needsDecision: 'no', inProgress: 'no' }), '/workflows');
});

test('an UNREADABLE signal is not treated as "no"', () => {
  // "We could not see your queue" must never resolve to "nothing needs you,
  // here are some agents to browse". Agents is a CLAIM, and an unread source
  // cannot support it.
  assert.equal(resolveDefaultLanding({ needsDecision: 'unknown', inProgress: 'no' }), '/work');
  assert.equal(resolveDefaultLanding({ needsDecision: 'no', inProgress: 'unknown' }), '/work');
  assert.equal(resolveDefaultLanding({ needsDecision: 'unknown', inProgress: 'unknown' }), '/work');
});

test('anySignal ranks a known yes above an unknown, and unknown above no', () => {
  assert.equal(anySignal('no', 'unknown', 'yes'), 'yes');
  assert.equal(anySignal('no', 'unknown'), 'unknown');
  assert.equal(anySignal('no', 'no'), 'no');
  assert.equal(anySignal(), 'no', 'no signals at all is a definite no, not unknown');
});

// ── Post-auth landing ────────────────────────────────────────────────────────

test('an ordinary authenticated entry resolves the state-aware landing', () => {
  assert.equal(DEFAULT_LANDING_ROUTE, '/start');
  assert.equal(postAuthDestination(), '/start');
  assert.equal(postAuthDestination({}), '/start');
  assert.equal(postAuthDestination({ next: null, intent: null, adoptSlug: null }), '/start');
});

test('post-auth precedence: adopt beats intent beats next beats the default', () => {
  assert.equal(
    postAuthDestination({ adoptSlug: 'daily-brief', intent: 'x', next: '/settings' }),
    '/workflows/daily-brief',
  );
  assert.equal(postAuthDestination({ intent: 'ship it', next: '/settings' }), '/overview?intent=ship%20it');
  assert.equal(postAuthDestination({ next: '/settings/api-keys' }), '/settings/api-keys');
});

test('a carried build intent still reaches the ONE surface that consumes it', () => {
  // /overview is where GetStartedIntent turns the website hero prompt into a
  // build run-request. Removing Home from navigation must not strand first-run
  // onboarding, so this hand-off is preserved deliberately, not by accident.
  assert.equal(
    postAuthDestination({ intent: 'watch my competitors & brief me' }),
    '/overview?intent=watch%20my%20competitors%20%26%20brief%20me',
  );
});

// ── Badge scoping ────────────────────────────────────────────────────────────

test('the Work seen-marker is scoped per account', () => {
  // Two accounts on one device must not inherit each other's "last opened"
  // time; the second would silently start with the first one's work marked
  // seen. This device really does run more than one Implexa account.
  assert.equal(workSeenKey('user-a'), 'implexa.seen.work:user-a');
  assert.notEqual(workSeenKey('user-a'), workSeenKey('user-b'));
});

test('no account id means NO badge rather than a shared key', () => {
  for (const id of [null, undefined, '', '   ']) {
    assert.equal(workSeenKey(id), null, `"${String(id)}" must not fall back to a shared marker`);
  }
});

test('the Work badge counts a run ONCE even though two queries return it', () => {
  // resultRunsAt is "every run in the window"; needsItemsAt is "the stalled or
  // awaiting-decision subset" — read from the same table. Concatenating them
  // counts the overlap twice and the badge reads roughly double.
  const a = '2026-08-11T10:00:00Z';
  const b = '2026-08-11T11:00:00Z';
  assert.deepEqual(mergeTimestamps([a, b], [a]), [a, b]);
  assert.equal(countNewerThan(mergeTimestamps([a, b], [a, b]), Date.parse('2026-08-11T09:00:00Z')), 2);
});

test('countNewerThan ignores unparseable stamps and is timezone-format agnostic', () => {
  const seen = Date.parse('2026-08-11T09:00:00Z');
  assert.equal(countNewerThan(['2026-08-11T10:00:00+00:00', '2026-08-11T10:00:00Z'], seen), 2);
  assert.equal(countNewerThan(['not-a-date', ''], seen), 0);
  assert.equal(countNewerThan(['2026-08-11T08:00:00Z'], seen), 0, 'older than the marker is not new');
});

test('the global Create button is suppressed on Work and review surfaces only', () => {
  for (const p of ['/work', '/work?view=review', '/review', '/review/run-1', '/runs/abc']) {
    assert.equal(isCreateFabSuppressed(p.split('?')[0]), true, `${p} should suppress Create`);
  }
  for (const p of ['/workflows', '/workflows/x', '/training', '/settings', '/overview']) {
    assert.equal(isCreateFabSuppressed(p), false, `${p} should keep Create`);
  }
});
