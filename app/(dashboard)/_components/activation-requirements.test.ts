// node --test "app/(dashboard)/_components/activation-requirements.test.ts"
// (Node 22.6+ strips the types natively)
//
// REGRESSION GUARD (2026-07-23 review, P0) — a browser-route tool with no
// key-vault provider (Veed) must render as "uses your local browser", not as a
// bare row with a cost badge and a null-href "Get it ↗" link. The requirements
// list is now driven by the confirmed capability stack (backend
// servicesFromToolStack), so a provider-less browser tool with url:null is a
// real, expected row here — the panel must present it cleanly.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(import.meta.dirname, 'activation-requirements.tsx'), 'utf8');

test('a browser-route tool reads as browser even without a verifiable session (Veed)', () => {
  assert.match(
    src,
    /const browserOnly = mode === 'browser';/,
    'browserOnly must not require s.browserSession — a provider-less browser tool has none but is still browser-route',
  );
  assert.doesNotMatch(
    src,
    /const browserOnly = mode === 'browser' && !!s\.browserSession;/,
    'the old session-gated definition hid the browser note for provider-less tools like Veed',
  );
});

test('the "uses your local browser" note renders for any browser-route row, not only ones with a session', () => {
  assert.match(
    src,
    /\{browserOnly \? \([\s\S]*?Uses your signed-in browser\./,
    'the browser note branch must key on browserOnly alone',
  );
});

test('the "Get it" link is suppressed when there is no URL (never render a null href)', () => {
  assert.match(
    src,
    /\{!keyReady && !needsGrantOnly && !browserOnly && !unknownAccess && s\.keysReadable !== false && s\.url && \(/,
    'a link-less row (url:null) must not render an <a href={null}>',
  );
});


test('Setup shows an optional declared CLI without claiming a connection or offering a key grant', async t => {
  const {render} = await import('../../../lib/test/render.ts');
  const r = await render('./activation-requirements.tsx', { declarations: [
    { id: 'declared-step-4', kind: 'declared_local_tool', label: 'Higgsfield', required: false },
  ] }, { exportName: 'DeclaredMachineTools' });
  t.after(() => r.cleanup());
  assert.match(r.text(), /Higgsfield/);
  assert.match(r.text(), /Declared for this version/);
  assert.match(r.text(), /Local · optional/);
  assert.doesNotMatch(r.text(), /signed in|installed|key allowed|Everything.*set up|checked when used|before each run|this agent can use/i);
  assert.equal(r.document.querySelectorAll('button, a, input').length, 0);
});
