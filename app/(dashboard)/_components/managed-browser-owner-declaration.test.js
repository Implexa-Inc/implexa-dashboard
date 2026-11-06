'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const React = require('react');
const { createRoot } = require('react-dom/client');
const { Simulate } = require('react-dom/test-utils');
const { JSDOM } = require('jsdom');
const { transformSync } = require('esbuild');
const flow = require('../../../lib/managed-browser-owner-declaration.ts');
const fixture = require('../../../lib/test/fixtures/managed-browser-owner-view.v1.json');
const sample = name => fixture.samples.find(row => row.name === name).output;
const target = { accountId: '55200000-0000-4000-8000-000000000001', slug: 'video', versionId: sample('absent').workflowVersionId };
const compiled = transformSync(fs.readFileSync(path.join(__dirname, 'managed-browser-owner-declaration.tsx'), 'utf8'), { loader: 'tsx', jsx: 'automatic', format: 'cjs' }).code;

async function ui(options = {}) {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://dashboard.invalid' });
  global.window = dom.window; global.document = dom.window.document; global.IS_REACT_ACT_ENVIRONMENT = true;
  let authChanged;
  let currentOwner = target.accountId;
  const reads = [], writes = [];
  const bridge = options.noBridge ? {} : {
    managedBrowserNoSpendContext: async input => { reads.push(input); return options.read ? options.read(input) : { ok: true, context: sample(input.operation === 'revoke' ? 'revoke' : 'absent') }; },
    confirmManagedBrowserNoSpend: async input => { writes.push(input); if (options.write) return options.write(input); return { ok: true }; },
  };
  const supabase = { auth: {
    getSession: async () => ({ data: { session: { user: { id: currentOwner }, access_token: 'synthetic-session-not-a-credential' } } }),
    onAuthStateChange: cb => { authChanged = cb; return { data: { subscription: { unsubscribe() {} } } }; },
  } };
  const mod = { exports: {} };
  const load = name => name === '@/lib/supabase/client' ? { createClient: () => supabase }
    : name === '@/lib/managed-browser-owner-declaration' ? flow
    : name === './api-key-row' ? { useDesktopBridge: () => bridge }
    : name === './modal' ? ({ open, title, children }) => open ? React.createElement('div', { role: 'dialog', 'aria-label': title }, children) : null
    : require(name);
  new Function('require', 'module', 'exports', compiled)(load, mod, mod.exports);
  const root = createRoot(document.getElementById('root'));
  await React.act(async () => root.render(React.createElement(mod.exports.default, { target })));
  const click = async text => { const button = [...document.querySelectorAll('button')].find(button => button.textContent === text); assert.ok(button, text); await React.act(async () => button.click()); };
  return { reads, writes, dom, click, text: () => document.body.textContent,
    confirm: async () => { await React.act(async () => document.querySelector('input[type=checkbox]').click()); },
    expiry: async () => { await React.act(async () => { const input = document.querySelector('input[type=datetime-local]'); input.value = new Date(Date.now() + 3600000).toISOString().slice(0, 16); Simulate.change(input); }); },
    submit: async () => {
      await React.act(async () => document.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })));
      // WebCrypto completes outside React's immediate act flush. Observe the
      // operation's terminal UI instead of racing its digest on a busy runner.
      for (let n = 0; n < 100 && document.querySelector('button[type=submit]')?.disabled
        && document.querySelector('button[type=submit]')?.textContent === 'Confirming…'; n++)
        await React.act(() => new Promise(resolve => setTimeout(resolve, 5)));
    },
    switchOwner: async () => { await React.act(async () => { currentOwner = 'other-owner'; authChanged('SIGNED_IN'); }); },
    close: async () => { await React.act(async () => root.unmount()); dom.window.close(); },
  };
}

test('Setup is quiet until owner opens the form, with no prechecked consent or invented expiry', async () => {
  const f = await ui();
  try {
    assert.equal(f.reads.length, 0); assert.equal(f.writes.length, 0);
    await f.click('Review statement'); assert.deepEqual(f.reads, [target]);
    assert.equal(document.querySelector('input[type=checkbox]').checked, false);
    assert.equal(document.querySelector('input[type=datetime-local]').value, '');
    await f.submit(); assert.equal(f.writes.length, 0);
    assert.match(f.text(), /No saved statement/); assert.match(f.text(), /grants no permission to spend/);
    assert.doesNotMatch(f.text(), /qualified|ready to run/i);
  } finally { await f.close(); }
});

test('explicit statement and expiry send one exact decision through the native bridge', async () => {
  const f = await ui();
  try {
    await f.click('Review statement'); await f.confirm(); await f.expiry(); await f.submit();
    assert.equal(f.writes.length, 1); assert.equal(Object.keys(f.writes[0].decision).length, 11);
    assert.equal(f.writes[0].decision.statement, 'no_payment_method_free_plan');
    assert.equal(f.writes[0].decision.evidenceRef, null);
    assert.match(f.text(), /Statement saved — owner-declared, unverified/);
    assert.equal(document.querySelector('form'), null);
  } finally { await f.close(); }
});

test('revoke uses retained real producer identities without a normal/browser preparation read', async () => {
  const f = await ui();
  try {
    await f.click('Revoke saved statement'); await f.confirm(); await f.submit();
    assert.deepEqual(f.reads, [{ ...target, operation: 'revoke' }]);
    assert.equal(f.writes.length, 1);
    assert.equal(f.writes[0].decision.bindingId, sample('revoke').bindingId);
    for (const key of ['statement', 'expiresAt', 'evidenceRef']) assert.equal(f.writes[0].decision[key], null);
    assert.match(f.text(), /Statement revoked/);
  } finally { await f.close(); }
});

test('failed read stays unavailable, missing bridge offers app path, and account switch clears confirmation', async () => {
  const missing = await ui({ noBridge: true });
  try { assert.match(missing.text(), /updated Implexa app/); assert.equal(document.querySelector('button'), null); } finally { await missing.close(); }
  const failed = await ui({ read: async () => ({ ok: false }) });
  try { await failed.click('Review statement'); assert.match(failed.text(), /unavailable/); assert.equal(document.querySelector('form'), null); } finally { await failed.close(); }
  const switched = await ui();
  try { await switched.click('Review statement'); await switched.confirm(); await switched.expiry(); await switched.switchOwner();
    assert.equal(document.querySelector('form'), null); assert.equal(switched.writes.length, 0);
  } finally { await switched.close(); }
});

test('unknown acknowledgement cannot auto-retry or re-submit the old confirmation', async () => {
  const f = await ui({ write: async () => { throw Error('lost acknowledgement'); } });
  try {
    await f.click('Review statement'); await f.confirm(); await f.expiry(); await f.submit();
    assert.equal(f.writes.length, 1); assert.equal(document.querySelector('form'), null);
    assert.match(f.text(), /Review the current statement before trying again/);
    await f.click('Review statement'); assert.equal(f.reads.length, 2);
    assert.equal(document.querySelector('input[type=checkbox]').checked, false);
    assert.equal(f.writes.length, 1);
  } finally { await f.close(); }
});
