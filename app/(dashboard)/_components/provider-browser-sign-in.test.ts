import assert from 'node:assert/strict';
import { test } from 'node:test';
import { render } from '../../../lib/test/render.ts';
import { BackendError } from '../../../lib/test/stubs/api.ts';

test('an older Desktop can open the browser but offers no unsupported session check', async () => {
  const r = await render('provider-browser-sign-in', { domain: 'dev.runwayml.com' }, {
    exportName: 'ProviderBrowserSignIn',
    bridge: { connectAccount: async () => ({ ok: true }), verifyAccount() { assert.fail('used legacy Verify'); } },
  });
  try {
    assert.equal(r.document.querySelector('input[type="email"]'), null);
    assert.match(r.text(), /Keep this site signed in/);
    assert.ok(r.queryByText('Open in Tukido browser'));
    assert.equal(r.queryByText('Check sign-in'), null);
  } finally { r.cleanup(); }
});

test('Runway checks the provider session without sending an email or recording a connection', async () => {
  const requested: string[][] = [];
  const r = await render('provider-browser-sign-in', {
    domain: 'dev.runwayml.com', onVerified: () => assert.fail('a session observation is not a durable connection'),
  }, {
    exportName: 'ProviderBrowserSignIn',
    bridge: {
      async connectAccount(domain: string) {
        assert.equal(domain, 'dev.runwayml.com');
        return { ok: true };
      },
      async inspectProviderBrowserSession(...args: string[]) {
        requested.push(args);
        if (requested.length === 1) return { ok: true, message: 'Finish signing in.' };
        if (requested.length === 2) return { ok: true, reachable: true };
        return { ok: true, sessionConfirmed: true };
      },
    },
  });
  try {
    assert.equal(r.document.querySelector('input'), null);
    await r.click(r.getByText('Open in Tukido browser'));
    assert.match(r.text(), /keep the site signed in/);
    await r.click(r.getByText('Check sign-in'));
    assert.match(r.text(), /Finish signing in/);
    await r.click(r.getByText('Check sign-in'));
    assert.doesNotMatch(r.text(), /session confirmed/);
    await r.click(r.getByText('Check sign-in'));
    assert.match(r.text(), /Signed-in browser session confirmed/);
    assert.deepEqual(requested, Array(3).fill(['dev.runwayml.com']));
    assert.equal(r.calls.backend.length, 0);
  } finally { r.cleanup(); }
});

test('ChatGPT sign-in check leaves the session and the Setup page alone', async () => {
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
      connectAccount: async () => ({ ok: true }),
      async inspectProviderBrowserSession(...args: string[]) {
        assert.deepEqual(args, ['chatgpt.com']);
        return { ok: true, sessionConfirmed: true };
      },
    },
    backend(path) {
      if (path === '/api/v2/agents/test-agent/activation') throw new BackendError('login required', 401, null);
      return null;
    },
  });
  try {
    await r.click(r.getByText('Check sign-in'));
    assert.match(r.text(), /Signed-in browser session confirmed/);
    assert.equal(r.calls.backend.filter(call => call.path.endsWith('/activation')).length, 0);
    assert.equal(r.calls.refresh, 0);
    assert.deepEqual(r.calls.push, []);
    assert.deepEqual(r.calls.replace, []);
    assert.equal(r.window.location.pathname, '/agents/test-agent');
  } finally { r.cleanup(); }
});

test('connection warnings update their status in place after a supported session check', async () => {
  const r = await render('connection-attention-banner', {
    warnings: [{ agent_slug: 'test-agent', agent_name: 'Test Agent', domain: 'chatgpt.com',
      label: 'ChatGPT', reason: 'Sign-in needed' }],
  }, {
    exportName: 'ConnectionAttentionBanner',
    bridge: {
      connectAccount: async () => ({ ok: true }),
      inspectProviderBrowserSession: async () => ({ ok: true, sessionConfirmed: true }),
    },
  });
  try {
    assert.match(r.text(), /1 connection needs a sign-in/);
    await r.click(r.getByText('Check sign-in'));
    assert.match(r.text(), /Browser checks complete/);
    assert.match(r.text(), /Signed-in browser session confirmed/);
    assert.doesNotMatch(r.text(), /Sign-in needed/);
    assert.equal(r.calls.refresh, 0);
  } finally { r.cleanup(); }
});

test('a cached reachable report does not claim a current browser session', async () => {
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
      connectAccount: async () => ({ ok: true }),
      inspectProviderBrowserSession: async () => ({ ok: true, sessionConfirmed: true }),
    },
    backend: () => null,
  });
  try {
    assert.match(r.text(), /Check the provider browser sessions/);
    assert.doesNotMatch(r.text(), /All needed accounts are reachable/);
    await r.click(r.getByText(/^Browser sign-in$/));
    await r.click(r.getByText('Check sign-in'));
    assert.match(r.text(), /Signed-in browser session confirmed/);
  } finally { r.cleanup(); }
});
