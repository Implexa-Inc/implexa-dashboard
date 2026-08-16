// node --test "app/(dashboard)/_components/agent-tabs-lazy.test.ts"
//
// Only the OPEN tab's tree may be built.
//
// What was wrong: /workflows/[slug] server-rendered all three panels on every
// view and handed them to <AgentTabs/> as a `panels` record. The shell then
// showed one — but the Runs list and the entire Setup tree (activation card +
// a second <AgentActions/> + learnings card, the two heaviest subtrees on the
// page) were built and serialized into the RSC payload every single time,
// including for someone who only ever looked at Overview.
//
// The fix: the server resolves ?tab= itself and renders ONE panel; switching
// tabs is a real navigation, so each expensive tree is built when opened. The
// risks that fix introduces — flicker, a lost deep link, and the cross-component
// "open Setup" jump firing before the panel exists — are pinned here too.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = import.meta.dirname;
const tabs = readFileSync(join(dir, 'agent-tabs.tsx'), 'utf8');
const page = readFileSync(join(dir, '..', 'workflows', '[slug]', 'page.tsx'), 'utf8');
const actions = readFileSync(join(dir, 'agent-actions.tsx'), 'utf8');
const readiness = readFileSync(join(dir, 'agent-readiness.tsx'), 'utf8');

test('the page builds ONE panel, not a record of all three', () => {
  assert.doesNotMatch(page, /panels=\{\{/,
    'handing over every panel is exactly the "all tabs rendered, one visible" cost');
  assert.match(page, /panel=\{activeTab === 'runs' \? runsPanel\(\) : activeTab === 'setup' \? setupPanel\(\) : overviewPanel\(\)\}/,
    'only the active tab\'s tree may be constructed');
  for (const name of ['overviewPanel', 'runsPanel', 'setupPanel']) {
    assert.match(page, new RegExp(`const ${name} = \\(\\) =>`),
      `${name} must be a function so an unopened tab's tree is never built`);
  }
});

test('?tab= deep links still work, and Overview stays the safe fallback', () => {
  assert.match(page, /searchParams\.tab && tabKeys\.includes\(searchParams\.tab\) \? searchParams\.tab : 'overview'/,
    'an unknown ?tab= must fall back to Overview rather than rendering nothing');
  assert.match(tabs, /next\.set\('tab', key\)/, 'switching tabs must write the deep link');
  assert.match(tabs, /next\.delete\('tab'\)/, 'the default tab should drop the param, not pin ?tab=overview');
});

test('no flicker: the switch is a transition and the outgoing panel is dimmed, never replaced', () => {
  assert.match(tabs, /useTransition\(\)/, 'the navigation must run in a transition so the current panel stays mounted');
  assert.match(tabs, /aria-busy=\{isPending \|\| undefined\}/);
  // useOptimistic is React 19 and absent from this project's react@18.3.1; it
  // resolved only via Next's vendored canary and made this component
  // unrenderable by lib/test/render.ts. The behaviour it provided is asserted
  // for real in agent-tabs-render.test.ts now.
  // Strip comments first: this file's own prose explains WHY the hook is gone,
  // and a bare /useOptimistic/ would match that explanation forever.
  const tabsCode = tabs.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert.doesNotMatch(tabsCode, /useOptimistic/,
    'a hook outside the declared React version cannot be exercised by the render harness');
  assert.doesNotMatch(tabs, /isPending \?\s*<|Loading|Spinner/,
    'a spinner replacing content that was already on screen IS the flicker this forbids');
  assert.match(tabs, /scroll: false/, 'a tab switch must not yank the viewport to the top');
});

test('the cross-component "open Setup" jump survives the round-trip', () => {
  // Both entry points dispatch the event; AgentTabs owns the URL + navigation.
  assert.match(tabs, /'implexa-open-tab'/, 'the shell must still listen for the sibling open-tab event');
  assert.match(readiness, /dispatchEvent\(new CustomEvent\('implexa-open-tab'/);
  assert.doesNotMatch(readiness, /history\.replaceState/,
    'hand-writing ?tab= fights the router for the same param — AgentTabs owns it');
  // The panel now lands after a server round-trip, so the scroll retries must
  // outlast it (the old 90ms/300ms pair gave up before the panel existed).
  assert.match(actions, /clearInterval\(retry\)/, 'the setup-scroll retry must keep trying until the panel lands');
  assert.doesNotMatch(actions, /setTimeout\(focusSetup, 300\)/, 'the old too-short retry pair must be gone');
});
