import { test } from 'node:test';
import assert from 'node:assert/strict';
import './support/tsx-register.mjs';
const { workAttentionBadge, primaryNavigation, mergeWorkCount } = await import('../lib/navigation.ts');

const empty = { needGrant: [], missed: [], signIns: [], homeAttention: [] };

test('Work badge counts the page actions, deduplicates Judge/live aliases and excludes historical/non-actionable rows', () => {
  const badge = workAttentionBadge({
    needGrant: [{ slug: 'agent-a' }], missed: [{ id: 'schedule-a' }], signIns: [{ domain: 'example.com' }],
    homeAttention: [{ attentionId: 'judge', runId: 'v2' }],
  }, [{ runId: 'v2', requestId: 'request', status: 'needs_attention' },
      { runId: 'v2', requestId: 'request', status: 'needs_attention' }], true);
  assert.deepEqual(badge, { count: 4, complete: true });
  const broadFeed = { ...empty, attentionItems: Array.from({ length: 70 }, (_, i) => ({ runId: `old-${i}`, attentionId: `old-${i}` })), stalled: [{ id: 'old-stall' }] };
  assert.equal(workAttentionBadge(broadFeed, [], true).count, 0, 'historical holds/stalls absent from the Work view do not inflate its badge');
});

test('partial/unavailable sources never become an exact zero or an exact known total', () => {
  assert.deepEqual(workAttentionBadge(empty, [], false), { count: 0, complete: false });
  assert.deepEqual(workAttentionBadge(empty, [{ runId: 'one', status: 'waiting_approval' }], false), { count: 1, complete: false });
  assert.deepEqual(workAttentionBadge(empty, [], true), { count: 0, complete: true });
});

test('Coach navigation is a trainer capability, in both pilot and ordinary accounts', () => {
  for (const pilot of [true, false]) {
    assert.deepEqual(primaryNavigation(pilot, false).map((item) => item.label), ['Agents', 'Work']);
    assert.deepEqual(primaryNavigation(pilot, true).map((item) => item.label), ['Agents', 'Work', 'Coach']);
  }
});

test('install instructions do not put disclosure hints inside paragraphs (hydration regression)', async () => {
  const React = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { default: InstallFlow } = await import('../app/(dashboard)/install/install-flow');
  const html = renderToStaticMarkup(React.createElement(InstallFlow, {
    hasKey: false, keyPrefix: null, coworkHooksLive: false, installCurl: null,
  }));
  assert.doesNotMatch(html, /<p\b[^>]*>(?:(?!<\/p>).)*<details\b/s);
});

test('both real shell surfaces retain attention on visiting Work, refresh after resolving, and fail visibly', async () => {
  const { JSDOM } = await import('jsdom');
  const React = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { __setPathname } = await import('./support/stubs/next-navigation.ts');
  const { default: Sidebar, MobileTopBar, ShellNavigationProvider } = await import('../app/(dashboard)/_components/sidebar');
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/workflows', pretendToBeVisual: true });
  const before = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch };
  const realNow = Date.now;
  let now = realNow();
  Date.now = () => now;
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  let response: unknown = { ok: true, canTrain: true, work: { count: 3, complete: true } };
  let heldRead: Promise<Response> | null = null;
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return heldRead ?? Response.json(response); }) as typeof fetch;
  const root = createRoot(document.getElementById('root')!);
  const user = { displayName: 'Ada', email: 'ada@example.com', plan: 'free', isFoundingCreator: false };
  const render = (key = 'initial', userId = 'account-one') => React.createElement(ShellNavigationProvider, { key, userId, children: React.createElement(React.Fragment, null,
    React.createElement(Sidebar, { user }), React.createElement(MobileTopBar, { user })) });
  const badges = () => Array.from(document.querySelectorAll('[aria-label="3 need you"]'));
  try {
    __setPathname('/workflows');
    await React.act(async () => { root.render(render()); });
    assert.equal(calls, 1, 'one background read feeds both surfaces');
    assert.equal(badges().length, 2);
    assert.equal(document.querySelectorAll('a[href="/training"]').length, 2);

    __setPathname('/work');
    await React.act(async () => { root.render(render()); });
    assert.equal(badges().length, 2, 'opening Work does not acknowledge or resolve attention');
    assert.equal(calls, 1, 'navigation does not repeat the background reads');
    assert.ok(!Object.keys(window.localStorage).some((key) => key.startsWith('implexa.seen.')), 'no visit-based seen markers');
    await React.act(async () => { window.dispatchEvent(new dom.window.Event('focus')); });
    assert.equal(calls, 1, 'focus events have a minimum read gap');

    response = { ok: true, canTrain: false, work: { count: 0, complete: true } };
    now += 15_001;
    await React.act(async () => { window.dispatchEvent(new dom.window.Event('focus')); });
    assert.equal(document.querySelectorAll('.app-nav-count').length, 0);
    assert.equal(document.querySelectorAll('a[href="/training"]').length, 0);

    response = { ok: true, canTrain: null, work: { count: 2, complete: false } };
    now += 15_001;
    await React.act(async () => { window.dispatchEvent(new dom.window.Event('focus')); });
    assert.equal(document.querySelectorAll('[aria-label="At least 2 need you"]').length, 2);

    response = { ok: false };
    now += 15_001;
    await React.act(async () => { window.dispatchEvent(new dom.window.Event('focus')); });
    assert.equal(document.querySelectorAll('[aria-label="At least 2 need you"]').length, 2,'an unavailable refresh retains the known lower bound');

    response = { ok: true, canTrain: true, work: { count: 0, complete: true } };
    now += 15_001;
    await React.act(async () => { window.dispatchEvent(new dom.window.Event('focus')); });
    response = { ok: false };
    let settleRead!: (response: Response) => void;
    heldRead = new Promise((resolve) => { settleRead = resolve; });
    await React.act(async () => { root.render(render('fresh-load')); });
    assert.equal(document.querySelectorAll('.app-nav-count').length, 0, 'loading is not an unavailable question-mark badge');
    assert.equal(document.querySelectorAll('a[href="/training"]').length, 2, 'remembered trainer is available while the first read is pending');
    await React.act(async () => { settleRead(Response.json(response)); });
    heldRead = null;
    assert.equal(document.querySelectorAll('a[href="/training"]').length, 2, 'confirmed trainer survives a failed first refresh on a fresh load');

    response = {ok:true,canTrain:true,work:{count:20,complete:false}};
    now+=15_001;await React.act(async()=>window.dispatchEvent(new dom.window.Event('focus')));
    response = {ok:true,canTrain:true,work:{count:2,complete:false}};
    now+=15_001;await React.act(async()=>window.dispatchEvent(new dom.window.Event('focus')));
    assert.equal(document.querySelectorAll('[aria-label="At least 20 need you"]').length,2,'a weaker partial read cannot shrink the session lower bound');
    await React.act(async()=>root.render(render('restored-account','account-one')));
    assert.equal(document.querySelectorAll('[aria-label="At least 20 need you"]').length,2,'a remount restores the account-scoped session lower bound');
    response = { ok: true, canTrain: false, work: { count: 0, complete: true } };
    await React.act(async () => { root.render(render('other-account', 'account-two')); });
    assert.equal(document.querySelectorAll('[aria-label="At least 20 need you"]').length,0,'another account cannot inherit the count');
    assert.equal(document.querySelectorAll('a[href="/training"]').length, 0, 'a verified new account cannot inherit the trainer hint');
    __setPathname('/training/my-agent');
    await React.act(async () => { root.render(render('other-account', 'account-two')); });
    assert.equal(document.querySelectorAll('a[href="/training"][aria-current="page"]').length, 2, 'a direct Coach visit always has a highlighted destination');
  } finally {
    await React.act(async () => { root.unmount(); });
    dom.window.close();
    Object.assign(globalThis, before);
    Date.now = realNow;
    delete (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT;
  }
});


test('only a complete Work count can reduce a previously known lower bound',()=>{
 assert.deepEqual(mergeWorkCount({count:20,complete:true},{count:2,complete:false}),{count:20,complete:false});
 assert.deepEqual(mergeWorkCount({count:20,complete:false},null),{count:20,complete:false});
 assert.deepEqual(mergeWorkCount({count:20,complete:false},{count:23,complete:false}),{count:23,complete:false});
 assert.deepEqual(mergeWorkCount({count:20,complete:false},{count:0,complete:true}),{count:0,complete:true});
 assert.equal(mergeWorkCount(undefined,null),null);
});
