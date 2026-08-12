// node --test test/legacy-routes.render.test.ts
//
// The compatibility half of the navigation change, exercised by RUNNING the
// real route components rather than reading the redirect table.
//
// Removing Home and Review from navigation is only safe if every URL that used
// to point at them still resolves. The riskiest of those is not a nav click at
// all: result notification emails and desktop notifications address
// `/inbox?run=<id>`, and a redirect that drops `run` lands the reader on a list
// instead of the result they were told about.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import './support/tsx-register.mjs';
import { anchors, navByLabel, textOf } from './support/dom.mjs';

const React = (await import('react')).default;
const { renderToStaticMarkup } = await import('react-dom/server');

type PageFn = (props: { searchParams?: Record<string, string | string[] | undefined> }) => unknown;
const reviewPage = ((await import('@/app/(dashboard)/review/page.tsx')) as { default: PageFn }).default;
const inboxPage  = ((await import('@/app/(dashboard)/inbox/page.tsx')) as { default: PageFn }).default;
const agentsPage = ((await import('@/app/(dashboard)/agents/page.tsx')) as { default: PageFn }).default;
const tabsMod    = await import('@/app/(dashboard)/work/_components/work-filter-tabs.tsx') as unknown as { default: (p: unknown) => unknown };

/**
 * Run a redirect page and return where it sent the user.
 *
 * Next signals a redirect by throwing an error carrying a `digest`; the stub in
 * test/support reproduces that contract, so a page that silently rendered
 * instead of redirecting fails here rather than passing quietly.
 */
function redirectTargetOf(page: PageFn, searchParams?: Record<string, string | string[] | undefined>): string {
  try {
    page({ searchParams });
  } catch (err) {
    const digest = (err as { digest?: string }).digest ?? '';
    const parts = digest.split(';');
    if (parts[0] === 'NEXT_REDIRECT') return parts[2];
    throw err;
  }
  throw new Error('the page returned instead of redirecting');
}

test('/review resolves into the Ready-for-review filter of Work', () => {
  assert.equal(redirectTargetOf(reviewPage), '/work?view=review');
});

test('/inbox resolves into the Delivered filter of Work', () => {
  assert.equal(redirectTargetOf(inboxPage), '/work?view=delivered');
});

test('a result deep link keeps its ?run= across the redirect', () => {
  // /inbox?run=<id> is what a result notification links to. Losing `run` here
  // is a silent regression: the page still renders, just not the thing the
  // reader clicked.
  assert.equal(
    redirectTargetOf(inboxPage, { run: 'run_9f2a1c' }),
    '/work?run=run_9f2a1c&view=delivered',
  );
});

test('an incoming ?view= cannot override the destination the legacy route means', () => {
  assert.equal(redirectTargetOf(inboxPage, { view: 'review' }), '/work?view=delivered');
  assert.equal(redirectTargetOf(reviewPage, { view: 'delivered' }), '/work?view=review');
});

test('/agents is a live forward alias for the Agents page', () => {
  assert.equal(redirectTargetOf(agentsPage), '/workflows');
  assert.equal(redirectTargetOf(agentsPage, { category: 'research' }), '/workflows?category=research');
});

// ── The filter that replaced the Review navigation entry ─────────────────────

function renderTabs(current: string, reviewCount: number | null) {
  return renderToStaticMarkup(React.createElement(tabsMod.default as never, { current, reviewCount }));
}

test('Work exposes its three filters as real, linkable URLs', () => {
  const html = renderTabs('needs', 0);
  const nav = navByLabel(html, 'Work filters');
  assert.ok(nav, 'the filters must be a labelled navigation region');
  const links = anchors(nav.inner);
  assert.deepEqual(links.map((a) => a.href), ['/work', '/work?view=review', '/work?view=delivered']);
  assert.deepEqual(links.map((a) => a.label), ['Needs you', 'Ready for review', 'Delivered']);
});

test('the selected filter is announced, and only one is', () => {
  for (const [current, label] of [['needs', 'Needs you'], ['review', 'Ready for review'], ['delivered', 'Delivered']] as const) {
    const current_ = anchors(renderTabs(current, null)).filter((a) => a.attrs['aria-current'] === 'page');
    assert.equal(current_.length, 1);
    assert.equal(current_[0].label, label);
  }
});

test('the Ready-for-review count renders only when it is knowable', () => {
  // A null count means a queue source was unavailable or the list was truncated.
  // Rendering "0" there would claim an all-clear we cannot prove — the exact
  // reason the old Review entry shipped with no badge at all.
  assert.match(textOf(renderTabs('needs', 3)), /Ready for review 3/);
  assert.doesNotMatch(textOf(renderTabs('needs', 0)), /\d/, 'zero renders no chip');
  assert.doesNotMatch(textOf(renderTabs('needs', null)), /\d/, 'an unknown count renders no number');
});

test('the count is exposed to assistive tech as a decision count, not a bare number', () => {
  const html = renderTabs('needs', 4);
  assert.match(html, /aria-label="4 waiting for your decision"/);
});
