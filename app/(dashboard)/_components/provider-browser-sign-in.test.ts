import assert from 'node:assert/strict';
import { test } from 'node:test';
import { render, type Rendered } from '../../../lib/test/render.ts';
import { BackendError } from '../../../lib/test/stubs/api.ts';

async function enterAccount(r: Rendered, value: string) {
  const input = r.document.querySelector('input[type="email"]')!;
  await r.act(() => {
    Object.getOwnPropertyDescriptor(r.window.HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new r.window.Event('input', { bubbles: true }));
  });
}

test('an older Desktop cannot report a URL-only connection through the new UI', async () => {
  const r = await render('provider-browser-sign-in', { domain: 'dev.runwayml.com' }, {
    exportName: 'ProviderBrowserSignIn',
    bridge: { connectAccount() { assert.fail('used legacy sign-in'); }, verifyAccount() { assert.fail('used legacy Verify'); } },
  });
  try {
    assert.match(r.text(), /Update Tukido Desktop/);
    assert.equal(r.queryByText(/^Verify$/), null);
  } finally { r.cleanup(); }
});

test('only the matching owner receives Connected in the browser setup control', async () => {
  const identity = 'owner@example.test';
  const requested: string[][] = [];
  let checks = 0;
  const options = {
    exportName: 'ProviderBrowserSignIn',
    bridge: {
      providerBrowserAccountMatching: true,
      async connectAccount(domain: string) {
        assert.equal(domain, 'dev.runwayml.com');
        return { ok: true, message: 'Open your account menu.' };
      },
      async verifyAccount(domain: string, email: string) {
        requested.push([domain, email]);
        if (requested.length === 1) return { ok: true, reachable: false, message: 'Switch to the intended account.' };
        if (requested.length === 2) return { ok: true, reachable: true, identity };
        return { ok: true, reachable: true, accountMatched: true, identity };
      },
    },
  };
  const r = await render('provider-browser-sign-in', { domain: 'dev.runwayml.com', onVerified: () => checks++ }, options);
  try {
    await r.click(r.getByText(/^Sign in$/));
    assert.match(r.text(), /Open your account menu/);
    await r.click(r.getByText(/^Verify$/));
    assert.match(r.text(), /Enter the email/);
    await enterAccount(r, 'OWNER@EXAMPLE.TEST');
    await r.click(r.getByText(/^Verify$/));
    assert.match(r.text(), /Switch to the intended account/);
    await r.click(r.getByText(/^Verify$/));
    assert.doesNotMatch(r.text(), /Connected as/);
    await r.click(r.getByText(/^Verify$/));
    assert.match(r.text(), /Connected as owner@example\.test/);
    assert.equal(checks, 1);
    assert.deepEqual(requested, Array(3).fill(['dev.runwayml.com', identity]));
    await enterAccount(r, 'another@example.test');
    assert.doesNotMatch(r.text(), /Connected as/);
  } finally { r.cleanup(); }
});

test('Verify leaves Setup visible even when the checklist read returns unauthorized', async () => {
  const identity = 'owner@example.test';
  const checklist = {
    slug: 'test-agent', name: 'Test agent', state: 'created', stepsLeft: 1,
    steps: [{ id: 'connections', status: 'todo', label: 'Connections', data: {
      needed: [{ account: 'chatgpt.com', status: 'unreachable' }],
    } }],
  };
  const r = await render('activation-card', {
    checklist, surface: 'setup', runInputs: null, statusUnavailable: false, revisePending: false,
  }, {
    exportName: 'ActivationCard',
    bridge: {
      providerBrowserAccountMatching: true,
      connectAccount: async () => ({ ok: true }),
      async verifyAccount(domain: string, email: string) {
        assert.equal(domain, 'chatgpt.com');
        assert.equal(email, identity);
        return { ok: true, reachable: true, accountMatched: true, identity };
      },
    },
    backend(path) {
      if (path === '/api/v2/agents/test-agent/activation') throw new BackendError('login required', 401, null);
      return null;
    },
  });
  try {
    await enterAccount(r, identity);
    await r.click(r.getByText(/^Verify$/));
    assert.match(r.text(), /Connected as owner@example\.test/);
    assert.equal(r.calls.backend.filter(call => call.path.endsWith('/activation')).length, 1);
    assert.equal(r.calls.refresh, 0);
    assert.deepEqual(r.calls.push, []);
    assert.deepEqual(r.calls.replace, []);
    assert.equal(r.window.location.pathname, '/agents/test-agent');
  } finally { r.cleanup(); }
});

test('connection warnings update their status in place after a matching browser check', async () => {
  const identity = 'owner@example.test';
  const r = await render('connection-attention-banner', {
    warnings: [{ agent_slug: 'test-agent', agent_name: 'Test Agent', domain: 'chatgpt.com',
      label: 'ChatGPT', reason: 'Sign-in needed' }],
  }, {
    exportName: 'ConnectionAttentionBanner',
    bridge: {
      providerBrowserAccountMatching: true,
      connectAccount: async () => ({ ok: true }),
      verifyAccount: async () => ({ ok: true, reachable: true, accountMatched: true, identity }),
    },
  });
  try {
    assert.match(r.text(), /1 connection needs a sign-in/);
    await enterAccount(r, identity);
    await r.click(r.getByText(/^Verify$/));
    assert.match(r.text(), /Browser checks complete/);
    assert.match(r.text(), /Connected as owner@example\.test/);
    assert.doesNotMatch(r.text(), /Sign-in needed/);
    assert.equal(r.calls.refresh, 0);
  } finally { r.cleanup(); }
});

test('a cached reachable browser report does not show all accounts connected before matching', async () => {
  const identity = 'owner@example.test';
  const checklist = {
    slug: 'test-agent', name: 'Test agent', state: 'created', stepsLeft: 0,
    steps: [{ id: 'connections', status: 'done', title: 'Connections', detail: 'All needed accounts are reachable.',
      data: { needed: [{ account: 'dev.runwayml.com', status: 'reachable' }] } }],
  };
  const r = await render('activation-card', {
    checklist, surface: 'setup', runInputs: null, statusUnavailable: false, revisePending: false,
  }, {
    exportName: 'ActivationCard',
    bridge: {
      providerBrowserAccountMatching: true,
      connectAccount: async () => ({ ok: true }),
      verifyAccount: async () => ({ ok: true, reachable: true, accountMatched: true, identity }),
    },
    backend: () => null,
  });
  try {
    assert.match(r.text(), /Verify the intended provider accounts/);
    assert.doesNotMatch(r.text(), /All needed accounts are reachable/);
    await r.click(r.getByText(/^Verify accounts$/));
    await enterAccount(r, identity);
    await r.click(r.getByText(/^Verify$/));
    assert.match(r.text(), /All needed accounts are reachable/);
    assert.match(r.text(), /Connected as owner@example\.test/);
    await enterAccount(r, 'another@example.test');
    assert.match(r.text(), /Verify the intended provider accounts/);
  } finally { r.cleanup(); }
});
