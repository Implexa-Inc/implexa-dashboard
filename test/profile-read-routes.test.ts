import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import './support/tsx-register.mjs';

const supa = await import('./support/stubs/supabase-server.ts');
const { ProfileReadUnavailableError, PROFILE_READ_TIMEOUT_MS } = await import('@/lib/profile-read.ts');
const callback = (await import('@/app/auth/callback/route.ts')).GET;
const onboarding = (await import('@/app/onboarding/page.tsx')).default;
const getApp = (await import('@/app/get-app/page.tsx')).default;
const cliAuth = (await import('@/app/cli-auth/page.tsx')).default;
const proficiency = (await import('@/app/onboarding/proficiency/page.tsx')).default;
const role = (await import('@/app/onboarding/role/page.tsx')).default;
const detail = (await import('@/app/(dashboard)/workflows/[slug]/page.tsx')).default;
const layout = (await import('@/app/(dashboard)/layout.tsx')).default;
const unavailable = (await import('@/app/error.tsx')).default;
const user = { id: 'fixture-user', email: 'fixture@example.invalid', user_metadata: {} };
const member = { id: user.id, organization_id: 'fixture-org', last_mcp_call_at: new Date().toISOString() };

beforeEach(() => { supa.__reset(); supa.__setSession(user); supa.__setRow('users', member); });

test('auth callback returns truthful no-store 503 on profile failure, not onboarding', async () => {
  supa.__setError('users', { code: '57014', message: 'private diagnostic' });
  const res = await callback(new Request('https://fixture.invalid/auth/callback?next=%2Fworkflows%2Fplanner'));
  assert.equal(res.status, 503);
  assert.equal(res.headers.get('location'), null);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const body = await res.json();
  assert.equal(body.code, 'profile_read_unavailable');
  assert.doesNotMatch(JSON.stringify(body), /private diagnostic/);
});

test('real absence still onboards and a verified existing member keeps their deep link', async () => {
  const existing = await callback(new Request('https://fixture.invalid/auth/callback?next=%2Fworkflows%2Fplanner'));
  assert.equal(existing.headers.get('location'), 'https://fixture.invalid/workflows/planner');
  supa.__setRow('users', null);
  const absent = await callback(new Request('https://fixture.invalid/auth/callback'));
  assert.equal(new URL(absent.headers.get('location')!).pathname, '/onboarding');
});

test('actual protected routes HOLD profile errors before fallback or backend actions', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('unexpected network'); };
  try {
    supa.__setError('users', { code: '57014' });
    for (const route of [
      () => layout({ children: null }),
      () => detail({ params: { slug: 'planner' }, searchParams: {} }),
      () => getApp(),
      () => cliAuth({ searchParams: { code: 'ABCD-1234' } }),
      () => proficiency({}),
      () => role(),
      () => onboarding({ searchParams: { invite: 'fixture-invite' } }),
    ]) await assert.rejects(route(), ProfileReadUnavailableError);
    assert.equal(calls, 0, 'a failed profile read cannot reach provisioning, invite or admission calls');
  } finally { globalThis.fetch = originalFetch; }
});

test('a stale onboarding URL does not provision an already verified member', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('unexpected provisioning'); };
  try {
    await assert.rejects(onboarding({ searchParams: { next: '/workflows/planner' } }), error => {
      assert.match((error as { digest: string }).digest, /;\/workflows\/planner;/);
      return true;
    });
    assert.equal(calls, 0);
    for (const next of ['//external.invalid', '/onboarding', '/onboarding?next=x']) {
      await assert.rejects(onboarding({ searchParams: { next } }), error => {
        assert.match((error as { digest: string }).digest, /;\/start;/);
        return true;
      });
    }
  } finally { globalThis.fetch = originalFetch; }
});

test('a hanging callback profile read returns 503 within the fixed deadline and aborts', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  supa.__setHanging('users', true);
  const result = callback(new Request('https://fixture.invalid/auth/callback'));
  // getUser awaits once before the profile query.
  await Promise.resolve(); await Promise.resolve();
  t.mock.timers.tick(PROFILE_READ_TIMEOUT_MS);
  const response = await result;
  assert.equal(response.status, 503);
  assert.equal(supa.__queries().find(q => q.table === 'users')?.signal?.aborted, true);
});

test('the error boundary offers only a manual retry, not workspace provisioning', () => {
  const html = renderToStaticMarkup(createElement(unavailable));
  assert.match(html, /role="alert"/);
  assert.match(html, /Temporarily unavailable/);
  assert.match(html, /does not mean you need a new account or workspace/);
  assert.match(html, /Try again/);
  assert.doesNotMatch(html, /Join their workspace|Create a separate|href="\/onboarding/);
});

test('verified genuine absence still provisions and explicit invite acceptance stays intact', async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ path: string; method?: string }> = [];
  globalThis.fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    calls.push({ path, method: init?.method });
    return new Response(JSON.stringify(path.endsWith('org-suggestion') ? { suggestion: null } : { ok: true }), { status: 200 });
  };
  try {
    supa.__setRow('users', null);
    await assert.rejects(onboarding({ searchParams: {} }), error => {
      assert.match((error as { digest: string }).digest, /;\/get-app;/);
      return true;
    });
    assert.deepEqual(calls, [
      { path: '/api/v2/auth/org-suggestion', method: 'GET' },
      { path: '/api/v2/auth/provision', method: 'POST' },
    ]);
    calls.length = 0;
    supa.__setRow('users', member);
    await assert.rejects(onboarding({ searchParams: { invite: 'fixture-invite' } }), error => {
      assert.match((error as { digest: string }).digest, /;\/get-app;/);
      return true;
    });
    assert.deepEqual(calls, [{ path: '/api/v2/team/accept-invite', method: 'POST' }]);
  } finally { globalThis.fetch = originalFetch; }
});
