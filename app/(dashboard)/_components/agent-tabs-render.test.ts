// node --test "app/(dashboard)/_components/agent-tabs-render.test.ts"
//
// AgentTabs, ACTUALLY RENDERED.
//
// This file exists because of a review finding: the component used
// useOptimistic, a React 19 API absent from this project's declared
// react@18.3.1. It resolved at runtime only because Next aliases React to its
// own vendored canary — and lib/test/render.ts bundles the REAL React, so the
// component could not be mounted here at all. Every claim about it (no
// flicker, deep links, the sibling open-tab event) was therefore pinned by
// source regex only, which is exactly the gap this harness was built to close.
//
// Swapping to useState made the component renderable. These are the assertions
// that regex could never make.

import test from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../../../lib/test/render.ts';

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'runs', label: 'Runs (3)' },
  { key: 'setup', label: 'Setup', attention: true },
];

function mount(active: string) {
  return render('agent-tabs.tsx', {
    tabs: TABS,
    active,
    panel: `PANEL:${active}`,
  });
}

test('it mounts at all on the project\'s declared React — the useOptimistic regression', async () => {
  const r = await mount('overview');
  try {
    assert.match(r.text(), /Overview/);
    assert.match(r.text(), /PANEL:overview/, 'the active panel renders');
  } finally { r.cleanup(); }
});

test('only the panel it was GIVEN renders — the other tabs are not in the tree', async () => {
  const r = await mount('overview');
  try {
    assert.ok(r.queryByText(/PANEL:overview/), 'active panel present');
    assert.equal(r.queryByText(/PANEL:runs/), null, 'an unopened tab must contribute nothing to the payload');
    assert.equal(r.queryByText(/PANEL:setup/), null);
  } finally { r.cleanup(); }
});

test('the server-resolved tab is the selected one (?tab= deep link honoured)', async () => {
  const r = await mount('setup');
  try {
    const selected = r.queryAllByText(/Setup/).find((el) => el.getAttribute('aria-selected') === 'true');
    assert.ok(selected, 'Setup is aria-selected when the server resolved ?tab=setup');
    const overview = r.queryAllByText(/Overview/).find((el) => el.getAttribute('role') === 'tab');
    assert.equal(overview?.getAttribute('aria-selected'), 'false');
  } finally { r.cleanup(); }
});

test('clicking a tab navigates via replace (deep link written, viewport preserved)', async () => {
  const r = await mount('overview');
  try {
    await r.click(r.getByText('Runs (3)'));
    assert.equal(r.calls.replace.length, 1, 'exactly one navigation');
    assert.match(r.calls.replace[0], /tab=runs/, 'the tab must be written to the URL');
    assert.equal(r.calls.push.length, 0, 'replace, not push — a tab switch is not a new history entry');
  } finally { r.cleanup(); }
});

test('the FIRST tab drops the param instead of pinning ?tab=overview', async () => {
  const r = await mount('runs');
  try {
    await r.click(r.getByText('Overview'));
    assert.equal(r.calls.replace.length, 1);
    assert.doesNotMatch(r.calls.replace[0], /tab=/, 'the default tab is the bare URL');
  } finally { r.cleanup(); }
});

test('NO FLICKER: the outgoing panel stays mounted while the next one is in flight', async () => {
  const r = await mount('overview');
  try {
    await r.click(r.getByText('Runs (3)'));
    // The server has not answered (the stub router never re-renders the page),
    // so the panel prop is unchanged — and it must still be on screen. A
    // spinner or a blank frame here is precisely the flicker this forbids.
    assert.match(r.text(), /PANEL:overview/, 'content already on screen must not be replaced by a placeholder');
    assert.doesNotMatch(r.text(), /Loading/i);
  } finally { r.cleanup(); }
});

test('the tab strip responds to the click IMMEDIATELY, before the panel arrives', async () => {
  const r = await mount('overview');
  try {
    await r.click(r.getByText('Runs (3)'));
    const runsTab = r.queryAllByText(/Runs \(3\)/).find((el) => el.getAttribute('role') === 'tab');
    assert.equal(runsTab?.getAttribute('aria-selected'), 'true',
      'the strip must show the pending tab; waiting for the server makes the click feel dead');
  } finally { r.cleanup(); }
});

test('the strip reconciles to the SERVER\'s answer when the panel lands', async () => {
  const r = await mount('overview');
  try {
    await r.click(r.getByText('Runs (3)'));
    // The navigation resolves: the server re-renders with a new active tab.
    await r.rerender({ tabs: TABS, active: 'runs', panel: 'PANEL:runs' });
    const runsTab = r.queryAllByText(/Runs \(3\)/).find((el) => el.getAttribute('role') === 'tab');
    assert.equal(runsTab?.getAttribute('aria-selected'), 'true');
    assert.match(r.text(), /PANEL:runs/);

    // And if the server comes back on a DIFFERENT tab than the click (a
    // redirect, or a stale click), the strip follows the server, not the guess.
    await r.rerender({ tabs: TABS, active: 'setup', panel: 'PANEL:setup' });
    const setupTab = r.queryAllByText(/Setup/).find((el) => el.getAttribute('role') === 'tab');
    assert.equal(setupTab?.getAttribute('aria-selected'), 'true', 'the server is the authority once it answers');
  } finally { r.cleanup(); }
});

test('clicking the ALREADY-active tab does nothing (no redundant navigation)', async () => {
  const r = await mount('overview');
  try {
    await r.click(r.getByText('Overview'));
    assert.equal(r.calls.replace.length, 0);
  } finally { r.cleanup(); }
});

test('a sibling component can open a tab through the implexa-open-tab event', async () => {
  const r = await mount('overview');
  try {
    await r.act(() => {
      r.window.dispatchEvent(new r.window.CustomEvent('implexa-open-tab', { detail: { key: 'setup' } }));
    });
    assert.equal(r.calls.replace.length, 1, 'the "Answer N questions to run" jump must still open Setup');
    assert.match(r.calls.replace[0], /tab=setup/);
  } finally { r.cleanup(); }
});

test('an unknown key from that event is ignored rather than navigating nowhere', async () => {
  const r = await mount('overview');
  try {
    await r.act(() => {
      r.window.dispatchEvent(new r.window.CustomEvent('implexa-open-tab', { detail: { key: 'nope' } }));
    });
    assert.equal(r.calls.replace.length, 0);
  } finally { r.cleanup(); }
});
