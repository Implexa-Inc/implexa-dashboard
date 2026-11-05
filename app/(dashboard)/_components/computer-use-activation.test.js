'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const React = require('react');
const { createRoot } = require('react-dom/client');
const { JSDOM } = require('jsdom');
const { transformSync } = require('esbuild');
const CARD = fs.readFileSync(path.join(__dirname, 'activation-card.tsx'), 'utf8');
const component = CARD.slice(CARD.indexOf('function AgentMacSetup('), CARD.indexOf('\nfunction ConnectionsList'));
const compiled = transformSync("const { useEffect, useState } = require('react');\n" + component + '\nmodule.exports = AgentMacSetup;', { loader: 'tsx', jsx: 'automatic', format: 'cjs' }).code;
const target = { accountId: '11111111-1111-4111-8111-111111111111', slug: 'video', versionId: 'v1', requiredRouteClass: 'computer_use' };
const ready = { ok: true, routeVerified: true, permissionsReady: true };
const blocked = { ok: true, routeVerified: true, permissionsReady: false };

async function fixture(bridge) {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://example.invalid' });
  global.window = dom.window; global.document = dom.window.document;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', 'useDesktopBridge', 'window', compiled)(require, mod, mod.exports, () => bridge, dom.window);
  const root = createRoot(document.getElementById('root'));
  const evidence = [];
  const onReady = (value) => evidence.push(value);
  async function render(t = target) { await React.act(async () => root.render(React.createElement(mod.exports, { target: t, onReady }))); }
  async function focus() { await React.act(async () => dom.window.dispatchEvent(new dom.window.Event('focus'))); }
  return { dom, evidence, render, focus, text: () => document.body.textContent,
    close: async () => { await React.act(async () => root.unmount()); dom.window.close(); } };
}

test('fresh setup reads quietly; only the explicit button opens exact Agent setup', async () => {
  let reads = 0; const opens = [];
  const f = await fixture({ agentSetupReadiness: async () => { reads++; return blocked; }, openAgentSetup: async (t) => { opens.push(t); return { ok: true }; } });
  try {
    await f.render();
    assert.equal(reads, 1); assert.deepEqual(opens, []);
    assert.match(f.text(), /Mac access needs setup/);
    await React.act(async () => document.querySelector('button').click());
    assert.deepEqual(opens, [target]);
    assert.equal(f.evidence.includes(true), false);
  } finally { await f.close(); }
});

test('returning to the Agent rechecks access without another consent action', async () => {
  let next = ready; let opens = 0;
  const f = await fixture({ agentSetupReadiness: async () => next, openAgentSetup: async () => { opens++; return { ok: true }; } });
  try {
    await f.render(); assert.match(f.text(), /Mac access ready/);
    next = blocked; await f.focus();
    assert.match(f.text(), /Mac access needs setup/);
    assert.equal(f.evidence.at(-1), false); assert.equal(opens, 0);
    next = ready; await f.focus(); assert.equal(f.evidence.at(-1), true);
  } finally { await f.close(); }
});

test('missing bridge and unresolved browser transport never claim ready', async () => {
  for (const bridge of [{}, { agentSetupReadiness: async () => ({ ...ready, routeVerified: false }) }, { agentSetupReadiness: async () => { throw Error('offline'); } }]) {
    const f = await fixture(bridge);
    try { await f.render(); assert.match(f.text(), /Mac access not verified/); assert.equal(f.evidence.includes(true), false); }
    finally { await f.close(); }
  }
});

test('old version/account async responses cannot publish readiness for a new target', async () => {
  const pending = [];
  const f = await fixture({ agentSetupReadiness: (t) => new Promise((resolve) => pending.push({ t, resolve })) });
  try {
    await f.render();
    await f.render({ ...target, versionId: 'v2' });
    await React.act(async () => pending[0].resolve(ready));
    assert.equal(f.evidence.includes(true), false);
    await React.act(async () => pending[1].resolve(blocked));
    assert.match(f.text(), /Mac access needs setup/);
    assert.equal(f.evidence.at(-1), false);
  } finally { await f.close(); }
});

test('setup replaces OS-only readiness without exposing decision authority or unsupported recovery', () => {
  assert.match(CARD, /macAccessEvidence\?\.key === setupTargetKey/);
  assert.match(CARD, /const \[macAccessEvidence, setMacAccessEvidence\].*null/);
  assert.doesNotMatch(component, /decideCapability|capabilityDisclosure|computerUsePermissionsStatus|checkComputerUseHealth|restartComputerUse/);
  assert.doesNotMatch(CARD, /function ComputerUseSetup|Restart computer control/);
});
