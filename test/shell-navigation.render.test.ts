// node --test test/shell-navigation.render.test.ts
//
// RENDERED tests for the dashboard shell — the real components, rendered to the
// real server markup, inspected as HTML.
//
// Why rendered and not source-matched (which is the older idiom in this repo):
// every claim below is about output, not about a line of code existing. "The
// narrow-viewport bar exposes the same three destinations" was false for the
// entire life of the previous shell while the source looked perfectly fine —
// MobileTopBar rendered a logo and a plan chip and no navigation at all. A
// regex over sidebar.tsx would have happily passed.
//
// See test/support/tsx-register.mjs for how a .tsx component is loaded into
// node:test without a bundler.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import './support/tsx-register.mjs';
import { anchors, navByLabel, findElements, textOf } from './support/dom.mjs';

const React      = (await import('react')).default;
const { renderToStaticMarkup } = await import('react-dom/server');
const routerStub = await import('./support/stubs/next-navigation.ts') as unknown as { __setPathname(p: string): void };
const sidebarMod = await import('@/app/(dashboard)/_components/sidebar.tsx') as unknown as {
  default: (p: unknown) => unknown;
  MobileTopBar: (p: unknown) => unknown;
};
const skipLinkMod = await import('@/app/(dashboard)/_components/skip-link.tsx') as unknown as { default: () => unknown };
const { PRIMARY_NAV, SECONDARY_NAV } = await import('@/lib/navigation.ts');

const USER = {
  displayName: 'Ada', email: 'ada@example.com', plan: 'free',
  isFoundingCreator: false, setupStatus: 'active' as const, lastSeenAt: null, isAdmin: false,
};

/** Render one shell surface at a given pathname. */
function renderShell(which: 'desktop' | 'narrow', pathname: string, props: Record<string, unknown> = {}) {
  routerStub.__setPathname(pathname);
  const Component = which === 'desktop' ? sidebarMod.default : sidebarMod.MobileTopBar;
  return renderToStaticMarkup(React.createElement(Component as never, { user: USER, ...props }));
}

// ── Desktop ──────────────────────────────────────────────────────────────────

test('desktop: primary navigation renders exactly Agents, Work, Training', () => {
  const html = renderShell('desktop', '/work');
  const primary = navByLabel(html, 'Primary');
  assert.ok(primary, 'the sidebar must expose a <nav aria-label="Primary">');

  const items = findElements(primary.inner, 'ul')[0];
  const links = anchors(items.outer);
  assert.deepEqual(links.map((a) => a.label), ['Agents', 'Work', 'Training']);
  assert.deepEqual(links.map((a) => a.href), ['/workflows', '/work', '/training']);
});

test('desktop: Settings is secondary, not a fourth primary domain', () => {
  const html = renderShell('desktop', '/work');
  const all = anchors(html);
  const settings = all.find((a) => a.label === 'Settings');
  assert.ok(settings, 'Settings must still be reachable');
  assert.equal(settings.href, '/settings');

  // It sits under the Account group, i.e. after the three primary items.
  const labels = all.map((a) => a.label);
  assert.ok(labels.indexOf('Settings') > labels.indexOf('Training'));
});

test('desktop: Home and Review are gone from the shell entirely', () => {
  const html = renderShell('desktop', '/work');
  const links = anchors(html);
  for (const banned of ['Home', 'Review', 'Results', 'Marketplace', 'Discover']) {
    assert.ok(!links.some((a) => a.label === banned), `"${banned}" must not render as a navigation link`);
  }
  for (const banned of ['/overview', '/review', '/inbox']) {
    assert.ok(!links.some((a) => a.href === banned), `${banned} must not be linked from the shell`);
  }
});

test('desktop: the logo resolves to the state-aware landing, never to Home', () => {
  const html = renderShell('desktop', '/training');
  const logo = anchors(html).find((a) => a.label === 'Implexa');
  assert.ok(logo, 'the brand link must exist');
  assert.equal(logo.href, '/start');
});

test('desktop: "Switch account" is gone (it submitted the same sign-out form)', () => {
  const html = renderShell('desktop', '/work');
  assert.ok(!textOf(html).includes('Switch account'));
  assert.ok(textOf(html).includes('Sign out'), 'signing out must still be possible');
});

// ── Selected state ───────────────────────────────────────────────────────────

test('the selected domain is ANNOUNCED with aria-current, not only tinted', () => {
  // DESIGN.md §13.1 forbids carrying meaning in colour alone. A background tint
  // is invisible to a screen reader and to Windows high-contrast mode.
  for (const [pathname, expected] of [
    ['/work', 'Work'],
    ['/workflows', 'Agents'],
    ['/training', 'Training'],
    ['/settings', 'Settings'],
  ] as const) {
    const html = renderShell('desktop', pathname);
    const current = anchors(html).filter((a) => a.attrs['aria-current'] === 'page');
    assert.equal(current.length, 1, `${pathname}: exactly one item may be current`);
    assert.equal(current[0].label, expected);
  }
});

test('a deep link still marks its owning domain as current', () => {
  // Inside a Review Room, the shell must say "you are in Work" — not "nowhere".
  for (const [pathname, expected] of [
    ['/review/run-abc123', 'Work'],
    ['/inbox', 'Work'],
    ['/runs/9f2a', 'Work'],
    ['/overview', 'Work'],
    ['/workflows/daily-brief', 'Agents'],
    ['/settings/billing', 'Settings'],
  ] as const) {
    const current = anchors(renderShell('desktop', pathname)).filter((a) => a.attrs['aria-current'] === 'page');
    assert.equal(current.length, 1, `${pathname}: expected exactly one current item`);
    assert.equal(current[0].label, expected, `${pathname} should light up ${expected}`);
  }
});

test('/workflows does not also light up Work (the /work prefix trap)', () => {
  const current = anchors(renderShell('desktop', '/workflows')).filter((a) => a.attrs['aria-current'] === 'page');
  assert.deepEqual(current.map((a) => a.label), ['Agents']);
});

// ── Keyboard ─────────────────────────────────────────────────────────────────

test('keyboard: every destination is a real anchor left in the tab order', () => {
  const html = renderShell('desktop', '/work');
  const primary = navByLabel(html, 'Primary');
  for (const a of anchors(primary.inner)) {
    assert.ok(a.href, 'a navigation item without href is not focusable');
    assert.ok(!('tabindex' in a.attrs), `${a.label} must not override the natural tab order`);
    assert.ok(!('disabled' in a.attrs), `${a.label} must not be disabled`);
  }
});

test('keyboard: every shell control renders a visible focus ring', () => {
  // focus-visible (not :focus) so a mouse click leaves no ring behind, and
  // ring-offset against the sidebar background so it stays visible on the
  // selected row too.
  const html = renderShell('desktop', '/work');
  const focusable = [...anchors(html), ...findElements(html, 'button').map((b) => ({ label: textOf(b.inner), attrs: b.attrs }))];
  for (const el of focusable) {
    const cls = el.attrs.class ?? '';
    assert.match(cls, /focus-visible:ring-2/, `"${el.label}" has no visible focus ring`);
    assert.match(cls, /focus-visible:ring-offset-/, `"${el.label}" focus ring has no offset`);
  }
});

test('keyboard: the skip link targets a focusable main region', () => {
  const html = renderToStaticMarkup(React.createElement(skipLinkMod.default as never));
  const [link] = anchors(html);
  assert.equal(link.href, '#main-content');
  assert.equal(link.label, 'Skip to main content');
  // Hidden until focused — it must not occupy visual space for sighted users.
  assert.match(link.attrs.class ?? '', /\bsr-only\b/);
  assert.match(link.attrs.class ?? '', /focus:not-sr-only/);
});

// ── Narrow viewport ──────────────────────────────────────────────────────────

test('narrow: the top bar exposes the SAME destinations as the sidebar', () => {
  // The regression this exists for: MobileTopBar used to render the logo and a
  // plan chip and nothing else, so below `md` there was no way to change domain.
  const html = renderShell('narrow', '/work');
  const primary = navByLabel(html, 'Primary');
  assert.ok(primary, 'the narrow bar must expose a <nav aria-label="Primary">');

  const links = anchors(primary.inner);
  assert.deepEqual(
    links.map((a) => a.href),
    [...PRIMARY_NAV, ...SECONDARY_NAV].map((i) => i.href),
    'every domain reachable on desktop must be reachable on a phone',
  );
  assert.deepEqual(links.map((a) => a.label), ['Agents', 'Work', 'Training', 'Settings']);
});

test('narrow: selection is announced the same way', () => {
  const current = anchors(renderShell('narrow', '/review/run-1')).filter((a) => a.attrs['aria-current'] === 'page');
  assert.deepEqual(current.map((a) => a.label), ['Work']);
});

test('narrow: the nav row scrolls rather than wrapping or clipping', () => {
  const html = renderShell('narrow', '/work');
  const primary = navByLabel(html, 'Primary');
  assert.match(primary.attrs.class ?? '', /overflow-x-auto/, 'four labels plus a badge must not clip on a 320px screen');
  const list = findElements(primary.inner, 'ul')[0];
  assert.match(list.attrs.class ?? '', /min-w-max/);
  assert.match(list.attrs.class ?? '', /whitespace-nowrap|flex/);
});

test('responsive: exactly one shell surface is visible at any width', () => {
  const desktop = renderShell('desktop', '/work');
  const narrow  = renderShell('narrow', '/work');
  // The sidebar appears at md and up; the top bar disappears there. If both
  // dropped their breakpoint class the user would get two navigations at once.
  assert.match(findElements(desktop, 'aside')[0].attrs.class ?? '', /\bhidden\b.*\bmd:flex\b/);
  assert.match(findElements(narrow, 'div')[0].attrs.class ?? '', /\bmd:hidden\b/);
});

// ── Badge ────────────────────────────────────────────────────────────────────

test('the Work badge does not render in server markup (hydration-safe)', () => {
  // The count is derived from a localStorage "last opened" marker, which does
  // not exist on the server. Rendering a number here would either mismatch on
  // hydration or show a stale count to every user; the component returns 0
  // until the marker is read. The counting rule itself is tested in
  // lib/navigation.test.ts (countNewerThan).
  const fresh = new Date(Date.now() + 60_000).toISOString();
  const html = renderShell('desktop', '/workflows', { resultRunsAt: [fresh], needsItemsAt: [fresh] });
  const work = anchors(html).find((a) => a.href === '/work');
  assert.ok(work);
  assert.equal(work.label, 'Work', 'no count is rendered server-side');
});
