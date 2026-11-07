'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { transformSync } = require('esbuild');
const source = fs.readFileSync(__dirname + '/activation-requirements.tsx', 'utf8');
const compiled = transformSync(source, { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code;
const mod = { exports: {} };
new Function('require', 'module', 'exports', compiled)(name => {
  if (name === './api-key-row') return { useDesktopBridge: () => null, InlineAddKeyButton: () => null };
  if (name === '@/lib/activation-core') return { apiKeyAccessReady: () => false, toolAccessReady: s => s.browserSession?.status === 'reachable' };
  return require(name);
}, mod, mod.exports);
function render(required) {
  return renderToStaticMarkup(React.createElement(mod.exports.ActivationRequirements, { slug: 'video', req: {
    source: 'frozen_step_declarations', tools: [], services: [{ key: 'veed', name: 'Veed', required,
      provider: null, accessMode: 'browser', apiKeyRequired: false, url: null }],
  } }));
}
test('unconnected optional tool remains visible but is skipped without implying a connection', () => {
  const html = render(false);
  assert.match(html, /Optional/);
  assert.match(html, /Unconnected optional tools will be skipped/);
  assert.match(html, /The agent will use its fallback/);
  assert.doesNotMatch(html, /Everything’s set up|✓ signed in|href="null"|Confirm account statement/);
});
test('unconnected required tool keeps its requirement and does not claim ready or fallback', () => {
  const html = render(true);
  assert.match(html, /Required/);
  assert.doesNotMatch(html, /Required service connections are ready|Everything’s set up|The agent will use its fallback/);
});
