import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { render } from '../../../lib/test/render.ts';

const fixture = JSON.parse(readFileSync(new URL('../../../lib/test/fixtures/managed-browser-owner-trial-producers.v1.json', import.meta.url), 'utf8'));
const native = JSON.parse(readFileSync(new URL('../../../lib/test/fixtures/managed-browser-trial-runtime-owner-view-composed.v1.json', import.meta.url), 'utf8'));
const q = fixture.trialRequest, preview = fixture.trialContext, version = q.workflow_version_id;
const props = { slug: q.workflow_slug, name: 'Synthetic browser Agent', isActive: true, requiresLocal: true, setupRouteClass: 'browser',
  workflowVersionId: version, inputContractDigest: q.input_contract_digest, activeVersionNumber: 88,
  inputContract: { version: 1, fields: [] } };
async function ui(options: { outcome?: 'lost' | 'refused'; noBridge?: boolean; requiredFile?: boolean; setupRouteClass?: 'headless' | 'browser' | 'computer_use' | null } = {}) {
  let owner = q.user_id, authChange: ((event: string) => void) | undefined;
  const reads: unknown[] = [], picks: string[] = [];
  const auth = { getSession: async () => ({ data: { session: { user: { id: owner }, access_token: 'synthetic-test-session' } } }),
    onAuthStateChange: (callback: (event: string) => void) => { authChange = callback; return { data: { subscription: { unsubscribe() {} } } }; } };
  const r = await render('agent-actions.tsx', { ...props, ...('setupRouteClass' in options ? { setupRouteClass: options.setupRouteClass } : {}), ...(options.requiredFile ? { inputContract: { version: 1,
    fields: [{ key: 'source', label: 'Presenter video', kind: 'file', cardinality: 'one', required: true, order: 1 }] } } : {}) }, { auth, bridge: options.noBridge ? null : {
    executionMachineId: async () => native.output.machineId,
    managedBrowserTrialRuntime: async (input: unknown) => { reads.push(input); return native.output; },
    pickRunInput: async () => { picks.push('registered'); return { ok: false, canceled: true }; },
    pickDeferredRunInput: async () => { picks.push('deferred'); return { ok: false, canceled: true }; },
  }, backend: (path, init: any) => {
    if (path.startsWith('/api/v2/agent-training/agents/')) return { ok: true, home: {
      agent: { currentVersionId: version }, successorProjection: { contractVersion: 'agent-training-successor-projection.v1', activeVersionId: version, eligiblePredecessor: null },
      managerTrainingRequirements: { contractVersion: 'manager-reference-training-readiness.v1', scope: 'workflow_version_quality_references', workflowVersionId: version,
        classified: false, requiredPairs: [], fulfilledPairs: [], missingPairs: [], readiness: 'not_applicable', reason: null },
    } };
    if (path.includes('/setup')) return { schema: [], answers: {}, note: '', runInputDefaults: {} };
    if (path.includes('/run-precheck')) return { ok: true, fingerprint: 'synthetic-fingerprint', duplicate: null };
    if (path === '/api/v2/me/run-admission') return { ok: true, admitted: true, machine: { id: native.output.machineId } };
    if (path.endsWith('managed-browser-trial-context')) return preview; // Unchanged real backend producer output.
    if (path === '/api/v2/me/run-requests' && init?.method === 'POST') {
      if (options.outcome === 'lost') throw Error('lost acknowledgement');
      if (options.outcome === 'refused') return { ok: false, reason: 'managed_browser_trial_expired' };
      return { ok: true, request: q };
    }
    return { ok: true, items: [] };
  } });
  // Explicit fixture clock and UUID, not rewritten responses or live authority.
  Object.defineProperty(r.window, 'crypto', { configurable: true, value: { subtle: crypto.subtle, randomUUID: () => q.id } });
  Object.defineProperty(r.window, 'TextEncoder', { value: TextEncoder });
  r.window.Date.now = () => Date.parse(q.created_at) - 1000;
  const click = (text: string) => {
    const button = [...r.document.querySelectorAll('button')].find(b => b.textContent?.trim().replace(/^▶\s*/, '') === text);
    assert.ok(button, `button ${text} in ${r.text()}`);
    return r.click(button).then(() => r.act(async () => {
      // WebCrypto settles outside React's microtask flush; wait for the real
      // digest operation, without replacing the flow or producer response.
      for (let n = 0; n < 5; n++) await new Promise(resolve => setTimeout(resolve, 1));
    }));
  };
  const births = () => r.calls.backend.filter(c => c.path === '/api/v2/me/run-requests' && (c.init as any)?.method === 'POST');
  const settled = async () => {
    for (let n = 0; n < 100 && !births().length && !/could not be confirmed|lost acknowledgement/.test(r.text()); n++)
      await r.act(() => new Promise(resolve => setTimeout(resolve, 5)));
  };
  const open = async () => { await click('Run now'); };
  const chooseTrial = async () => {
    const summary = [...r.document.querySelectorAll('summary')].find(x => x.textContent === 'Advanced beta browser diagnostics');
    assert.ok(summary); await r.click(summary);
    await r.click(r.document.querySelector('input[type=checkbox]')!);
    const input = r.document.querySelector('input[type=datetime-local]') as HTMLInputElement;
    const d = new Date(preview.decision.expiresAt), pad = (v: number) => String(v).padStart(2, '0');
    const value = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3,'0')}`;
    await r.act(() => {
      Object.getOwnPropertyDescriptor(r.window.HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new r.window.Event('input', { bubbles: true }));
      input.dispatchEvent(new r.window.Event('change', { bubbles: true }));
    });
  };
  return { r, reads, picks, births, open, chooseTrial, click, settled, switchOwner: async () => { owner = 'other'; await r.act(() => authChange?.('SIGNED_IN')); } };
}

test('Run form has no trial consent or native read until explicitly selected and reviewed', async () => {
  const f = await ui(); try {
    await f.open(); assert.equal(f.reads.length, 0); assert.equal(f.births().length, 0);
    assert.equal((f.r.document.querySelector('input[type=checkbox]') as HTMLInputElement).checked, false);
    assert.equal(f.r.document.querySelector('input[type=datetime-local]'), null);
    await f.chooseTrial(); await f.click('Review beta trial');
    assert.equal(f.reads.length, 1); assert.equal(f.births().length, 0);
    assert.match(f.r.text(), /This browser path is unqualified/); assert.match(f.r.text(), /v88/);
    assert.match(f.r.text(), /https:\/\/veed.io/); assert.match(f.r.text(), /No media purchases/);
    const confirm = [...f.r.document.querySelectorAll('button')].find(b => b.textContent === 'Start this trial')!;
    assert.equal(confirm.disabled, true); await f.r.click(confirm); assert.equal(f.births().length, 0);
    await f.click('Cancel'); assert.equal(f.births().length, 0);
  } finally { f.r.cleanup(); }
});

test('explicit second confirmation creates exactly one exact owner trial, including double-clicks', async () => {
  const f = await ui(); try {
    await f.open(); await f.chooseTrial(); await f.click('Review beta trial');
    await f.r.click(f.r.document.querySelector('input[type=checkbox]')!);
    const button = [...f.r.document.querySelectorAll('button')].find(b => b.textContent === 'Start this trial')!;
    await f.r.act(() => { button.click(); button.click(); });
    await f.settled();
    assert.equal(f.births().length, 1);
    const body = (f.births()[0].init as any).body;
    assert.deepEqual(JSON.parse(JSON.stringify(body.managedBrowserTrial)), { decision: preview.decision, decisionDigest: preview.decisionDigest });
    assert.equal(body.requiredMachineId, native.output.machineId);
    assert.equal(body.workflowVersionId, version); assert.equal(body.kind, 'run');
  } finally { f.r.cleanup(); }
});

test('account switch and target-version switch cancel an open confirmation without creating a request', async () => {
  for (const change of ['owner', 'version']) {
    const f = await ui(); try {
      await f.open(); await f.chooseTrial(); await f.click('Review beta trial');
      if (change === 'owner') await f.switchOwner(); else await f.r.rerender({ ...props, workflowVersionId: 'different-version' });
      assert.equal(f.births().length, 0); assert.doesNotMatch(f.r.text(), /Start this trial/);
    } finally { f.r.cleanup(); }
  }
});

test('ambiguous or refused trial birth never enters ordinary automatic birth recovery', async () => {
  for (const outcome of ['lost', 'refused'] as const) {
    const f = await ui({ outcome }); try {
      await f.open(); await f.chooseTrial(); await f.click('Review beta trial');
      await f.r.click(f.r.document.querySelector('input[type=checkbox]')!); await f.click('Start this trial');
      assert.equal(f.births().length, 1); assert.doesNotMatch(f.r.text(), /Start this trial/);
      assert.match(f.r.text(), new RegExp(q.id));
      assert.equal(f.r.calls.backend.filter(c => c.path.endsWith('managed-browser-trial-context')).length, 1);
    } finally { f.r.cleanup(); }
  }
});

test('beta file selection enters the existing immediate-registration picker, never deferred preparation', async () => {
  const f = await ui({ requiredFile: true }); try {
    await f.open(); await f.chooseTrial(); await f.click('Choose file');
    assert.deepEqual(f.picks, ['registered']); assert.equal(f.births().length, 0);
    // Picker cancellation is controlled: no fabricated successful registration.
    assert.equal(f.reads.length, 0);
  } finally { f.r.cleanup(); }
});

test('plain browser cannot expose the native beta-trial option', async () => {
  const f = await ui({ noBridge: true }); try { await f.open(); assert.doesNotMatch(f.r.text(), /one-run Codex beta browser trial/); assert.equal(f.reads.length, 0); } finally { f.r.cleanup(); }
});


test('ordinary non-browser and unresolved run forms do not offer the internal beta trial', async () => {
  for (const setupRouteClass of ['headless', 'computer_use', null] as const) {
    const f = await ui({ setupRouteClass });
    try {
      await f.open();
      assert.doesNotMatch(f.r.text(), /Advanced beta browser diagnostics|Review a one-run Codex beta browser trial|free-account statement/);
      assert.equal(f.reads.length, 0);
      assert.equal(f.births().length, 0);
    } finally { f.r.cleanup(); }
  }
});
