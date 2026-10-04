import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { buildSync } from 'esbuild';
import { createServerClient } from '@supabase/ssr';

// Execute the unmodified entry point with real Next responses and real SSR/Auth
// SDKs. Only transport is synthetic; no account, token or network is real.
const require = createRequire(import.meta.url);
const { NextRequest } = require('next/server');
const code = buildSync({ entryPoints: [new URL('./middleware.ts', import.meta.url).pathname],
  bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external' }).outputFiles[0].text;
function load(override?: unknown) {
  const module = { exports: {} as any };
  new Function('require', 'module', 'exports', code)(
    (name: string) => name === '@supabase/ssr' && override ? override : require(name), module, module.exports);
  return module.exports.middleware;
}
const middleware = load();
const url = 'https://fixture.invalid';
const user = { id: 'fixture-user', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01' };
const originalFetch = globalThis.fetch;
const oldUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const oldKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json', 'x-supabase-api-version': '2024-01-01' },
});
let cookies: Array<{ name: string; value: string }>;
let accessToken: string;
beforeEach(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = url;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'synthetic-anon';
  cookies = [];
  accessToken = [ { alg: 'HS256' }, { exp: Math.floor(Date.now() / 1000) + 3600, sub: user.id } ]
    .map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.')
    + '.' + Buffer.from('synthetic-signature').toString('base64url');
  const producer = createServerClient(url, 'synthetic-anon', {
    global: { fetch: async () => json(user) },
    cookies: { getAll: () => cookies, setAll: values => { cookies = values.filter(v => v.value); } },
  });
  assert.equal((await producer.auth.setSession({ access_token: accessToken, refresh_token: 'synthetic-refresh' })).error, null);
  assert(cookies.length, 'session cookies must come from the actual SSR producer');
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (oldUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = oldUrl;
  if (oldKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY; else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = oldKey;
});
function request(path = '/skills/planner', withSession = true) {
  return new NextRequest(url + path, { headers: withSession ? {
    cookie: cookies.map(c => `${c.name}=${c.value}`).join('; '),
  } : {} });
}
async function unavailable(response: Response) {
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('location'), null);
  assert.equal(response.headers.get('set-cookie'), null, 'uncertain auth must not change browser cookies');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('retry-after'), '5');
  assert.deepEqual(await response.json(), { code: 'auth_read_unavailable',
    error: 'Sign-in verification is temporarily unavailable. Please try again.' });
}

test('verified user retains protected access, deep-link pathname and exact SDK user transport', async () => {
  const seen: Array<{ url: string; signal?: AbortSignal | null }> = [];
  globalThis.fetch = async (input, init) => { seen.push({ url: String(input), signal: init?.signal }); return json(user); };
  const response = await middleware(request());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-pathname'), '/skills/planner');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, url + '/auth/v1/user');
  assert.equal(seen[0].signal?.aborted, false);
});

test('genuine missing session preserves protected redirect and public-route behavior without transport', async () => {
  globalThis.fetch = async () => { throw new Error('unexpected transport'); };
  for (const path of ['/skills/planner', '/settings', '/pricing']) {
    const response = await middleware(request(path, false));
    assert.equal(response.status, 307);
    const location = new URL(response.headers.get('location')!);
    assert.equal(location.pathname, '/login');
    assert.equal(location.searchParams.get('next'), path);
  }
  for (const path of ['/', '/login', '/signup', '/auth/callback']) {
    assert.equal((await middleware(request(path, false))).status, 200);
  }
});

test('SDK rejects revoked sessions rather than granting access', async () => {
  globalThis.fetch = async () => json({ code: 'session_not_found', message: 'revoked' }, 401);
  const response = await middleware(request());
  assert.equal(response.status, 307);
  assert.equal(new URL(response.headers.get('location')!).pathname, '/login');
});

test('upstream 500/503 and unknown 400 are unavailable on protected AND public routes', async () => {
  for (const status of [500, 503, 400]) for (const path of ['/skills/planner', '/login']) {
    globalThis.fetch = async () => json({ code: 'unexpected', message: 'private diagnostic' }, status);
    await unavailable(await middleware(request(path)));
  }
});

test('transport rejection is sanitized and never treated as sign-out', async () => {
  globalThis.fetch = async () => { throw new Error('private diagnostic'); };
  await unavailable(await middleware(request()));
});

test('real SDK hanging transport is cancelled at four seconds and cannot retry network', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal: AbortSignal | undefined;
  let calls = 0;
  let started!: () => void;
  const start = new Promise<void>(resolve => { started = resolve; });
  globalThis.fetch = async (_input, init) => {
    calls++; signal = init?.signal as AbortSignal; started();
    return new Promise<Response>((_resolve, reject) => signal!.addEventListener('abort', () => reject(signal!.reason), { once: true }));
  };
  const pending = middleware(request());
  await start;
  t.mock.timers.tick(4000);
  await unavailable(await pending);
  assert.equal(signal?.aborted, true);
  t.mock.timers.tick(60000);
  await Promise.resolve();
  assert.equal(calls, 1);
});

test('late ignored-abort transport cannot change refusal or cookies', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let finish!: (value: Response) => void;
  let started!: () => void;
  const start = new Promise<void>(resolve => { started = resolve; });
  globalThis.fetch = async () => { started(); return new Promise<Response>(resolve => { finish = resolve; }); };
  const pending = middleware(request());
  await start;
  t.mock.timers.tick(4000);
  const response = await pending;
  await unavailable(response);
  finish(json(user));
  for (let i = 0; i < 20; i++) await Promise.resolve();
  assert.equal(response.headers.get('set-cookie'), null);
});

test('real refresh cookies are retained only after successful verified auth', async t => {
  // Advance only SDK session time, not the monotonic read deadline.
  t.mock.method(Date, 'now', () => new Date().getTime() + 7200000);
  globalThis.fetch = async input => String(input).includes('/token')
    ? json({ access_token: accessToken, refresh_token: 'synthetic-successor', token_type: 'bearer', expires_in: 3600, user })
    : json(user);
  const response = await middleware(request());
  assert.equal(response.status, 200);
  assert(response.headers.get('set-cookie'), 'real SSR successful refresh writes must survive');
});

test('initialization refresh failure cannot masquerade as session missing or delete browser cookies', async t => {
  t.mock.method(Date, 'now', () => new Date().getTime() + 7200000);
  const originalCookies = structuredClone(cookies);
  for (const status of [500, 400]) {
    globalThis.fetch = async () => json({ code: 'unexpected', message: 'private diagnostic' }, status);
    await unavailable(await middleware(request()));
    assert.deepEqual(cookies, originalCookies);
  }
});

test('late null and malformed results from an auth operation cannot become absence or access', async t => {
  let now = 0;
  t.mock.method(performance, 'now', () => now);
  const late = load({ createServerClient: () => ({ auth: { getUser: async () => {
    now = 4001; return { data: { user: null }, error: null };
  } } }) });
  await unavailable(await late(request()));
  now = 0;
  for (const result of [undefined, { data: { user: {} }, error: null }, { data: {}, error: null }]) {
    const malformed = load({ createServerClient: () => ({ auth: { getUser: async () => result } }) });
    await unavailable(await malformed(request()));
  }
});

test('SDK initialization/lock hang is bounded, and uncertain cookie proposals are discarded', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const stuck = load({ createServerClient: (_url: string, _key: string, options: any) => {
    options.cookies.setAll([{ name: 'synthetic', value: '', options: {} }]);
    return { auth: { getUser: () => new Promise(() => {}) } };
  } });
  const pending = stuck(request());
  t.mock.timers.tick(4000);
  await unavailable(await pending);
});
