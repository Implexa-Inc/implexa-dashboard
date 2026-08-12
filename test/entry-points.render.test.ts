// node --test test/entry-points.render.test.ts
//
// PROVES THE DEFAULT LANDING IS ACTUALLY THE DEFAULT.
//
// The first version of this change routed the LOGO to /start and stopped there.
// Every other way an authenticated user enters the product — the root redirect,
// the already-signed-in short circuits on /login and /signup, the auth callback,
// and the post-connect hand-off from /get-app — still hard-coded /overview. So
// the locked state-aware rule applied to one click and nothing else, and Home
// remained the product's real landing page while the shell claimed it was gone.
//
// A unit test over `postAuthDestination` would not have caught that: the bug was
// that the callers did not use it. These tests EXECUTE the real route modules
// with a stubbed Supabase session and assert where each one sends the user.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/tsx-register.mjs';

const supa = await import('./support/stubs/supabase-server.ts') as unknown as {
  __setSession(u: { id: string; app_metadata?: Record<string, unknown> } | null): void;
  __setRow(table: string, row: Record<string, unknown> | null): void;
  __reset(): void;
};
const { DEFAULT_LANDING_ROUTE } = await import('@/lib/navigation.ts');

type Page = (props?: { searchParams?: Record<string, string | undefined> }) => unknown | Promise<unknown>;
const rootPage   = ((await import('@/app/page.tsx')) as { default: Page }).default;
const loginPage  = ((await import('@/app/login/page.tsx')) as { default: Page }).default;
const signupPage = ((await import('@/app/signup/page.tsx')) as { default: Page }).default;
const getAppPage = ((await import('@/app/get-app/page.tsx')) as { default: Page }).default;
const callbackGET = ((await import('@/app/auth/callback/route.ts')) as { GET: (r: Request) => Promise<Response> }).GET;

/** Run a route and return where it redirected, or null if it rendered instead. */
async function landingOf(page: Page, searchParams?: Record<string, string | undefined>): Promise<string | null> {
  try {
    await page({ searchParams });
    return null;
  } catch (err) {
    const digest = (err as { digest?: string }).digest ?? '';
    const parts = digest.split(';');
    if (parts[0] === 'NEXT_REDIRECT') return parts[2];
    throw err;
  }
}

const SIGNED_IN = { id: 'user-1' };

beforeEach(() => {
  supa.__reset();
  supa.__setSession(SIGNED_IN);
  // A connected, provisioned account by default; individual tests override.
  supa.__setRow('users', { id: 'user-1', organization_id: 'org-1', last_mcp_call_at: new Date().toISOString(), last_hook_event_at: null });
});

test('the default landing route is the state-aware resolver', () => {
  assert.equal(DEFAULT_LANDING_ROUTE, '/start');
});

test('/ sends an authenticated user to the state-aware landing, not Home', async () => {
  assert.equal(await landingOf(rootPage), '/start');
});

test('/ still sends an anonymous visitor to sign in', async () => {
  supa.__setSession(null);
  assert.equal(await landingOf(rootPage), '/login');
});

test('/login short-circuits an existing session to the state-aware landing', async () => {
  assert.equal(await landingOf(loginPage, {}), '/start');
});

test('/login still honours an explicit deep link', async () => {
  // cli-auth and install chains depend on this — the default must not swallow it.
  assert.equal(await landingOf(loginPage, { next: '/cli-auth?code=abc' }), '/cli-auth?code=abc');
});

test('/signup short-circuits an existing session to the state-aware landing', async () => {
  assert.equal(await landingOf(signupPage, {}), '/start');
});

test('/signup still carries a build intent to the one surface that consumes it', async () => {
  // THE CARVE-OUT. GetStartedIntent on /overview is what turns the website hero
  // prompt into a build run-request; there is nowhere else that can yet.
  // Removing Home from navigation must not strand first-run onboarding.
  assert.equal(
    await landingOf(signupPage, { intent: 'summarise my competitors weekly' }),
    '/overview?intent=summarise%20my%20competitors%20weekly',
  );
});

test('/signup adopt-and-run still lands on the agent, ahead of everything else', async () => {
  assert.equal(
    await landingOf(signupPage, { intent: 'adopt', agent: 'daily-brief', next: '/settings' }),
    '/workflows/daily-brief',
  );
});

test('/signup still routes an invite through onboarding', async () => {
  assert.equal(await landingOf(signupPage, { invite: 'tok123' }), '/onboarding?invite=tok123');
});

test('/get-app hands a now-connected user to the state-aware landing', async () => {
  assert.equal(await landingOf(getAppPage), '/start');
});

test('/get-app still HOLDS a never-connected user on the door', async () => {
  // The hard gate is load-bearing: the product does nothing without a connected
  // executor. Rerouting the default landing must not open a way past it.
  supa.__setRow('users', { id: 'user-1', organization_id: 'org-1', last_mcp_call_at: null, last_hook_event_at: null });
  assert.equal(await landingOf(getAppPage), null, 'a never-connected user must stay on /get-app');
});

test('the auth callback lands on the state-aware landing', async () => {
  const res = await callbackGET(new Request('https://app.implexa.ai/auth/callback'));
  assert.equal(new URL(res.headers.get('location')!).pathname, '/start');
});

test('the auth callback still honours `next` and still gates on provisioning', async () => {
  const withNext = await callbackGET(new Request('https://app.implexa.ai/auth/callback?next=%2Fsettings%2Fapi-keys'));
  assert.equal(new URL(withNext.headers.get('location')!).pathname, '/settings/api-keys');

  supa.__setRow('users', { id: 'user-1', organization_id: null });
  const unprovisioned = await callbackGET(new Request('https://app.implexa.ai/auth/callback'));
  assert.equal(new URL(unprovisioned.headers.get('location')!).pathname, '/onboarding');
});

test('NO ordinary entry point lands on Home any more', async () => {
  // The regression this whole file exists for. Every default path, checked at
  // once, so adding a new caller that hard-codes /overview shows up here.
  const defaults = await Promise.all([
    landingOf(rootPage),
    landingOf(loginPage, {}),
    landingOf(signupPage, {}),
    landingOf(getAppPage),
  ]);
  for (const dest of defaults) {
    assert.equal(dest, '/start', `expected the state-aware landing, got ${dest}`);
  }
  const res = await callbackGET(new Request('https://app.implexa.ai/auth/callback'));
  assert.equal(new URL(res.headers.get('location')!).pathname, '/start');
});
