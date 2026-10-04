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
async function flush() { for (let i = 0; i < 80; i++) await Promise.resolve(); }
const preparedSession = { data: { session: null }, error: null };
const refreshedSession = () => json({ access_token: accessToken, refresh_token: 'synthetic-successor',
  token_type: 'bearer', expires_in: 3600, user });
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
  let verified = 0;
  const late = load({ createServerClient: () => ({ auth: { getSession: async () => preparedSession, getUser: async () => {
    verified++;
    now = 4001; return { data: { user: null }, error: null };
  } } }) });
  await unavailable(await late(request()));
  assert.equal(verified, 1, 'must reach the verification phase rather than fail on a missing mock method');
  now = 0;
  for (const result of [undefined, { data: { user: {} }, error: null }, { data: {}, error: null }]) {
    const malformed = load({ createServerClient: () => ({ auth: {
      getSession: async () => preparedSession, getUser: async () => result,
    } }) });
    await unavailable(await malformed(request()));
  }
});

test('SDK initialization/lock hang is bounded, and uncertain cookie proposals are discarded', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const stuck = load({ createServerClient: (_url: string, _key: string, options: any) => {
    options.cookies.setAll([{ name: 'synthetic', value: '', options: {} }]);
    return { auth: { getSession: () => new Promise(() => {}), getUser: () => { throw new Error('must not verify'); } } };
  } });
  const pending = stuck(request());
  t.mock.timers.tick(8000);
  await unavailable(await pending);
});

test('real SDK slow refresh gets its own allowance then requires verified user before cookies', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let now = 0;
  t.mock.method(performance, 'now', () => now);
  t.mock.method(Date, 'now', () => new Date().getTime() + 7200000);
  const seen: string[] = [];
  let releaseRefresh!: (value: Response) => void;
  let releaseUser!: (value: Response) => void;
  globalThis.fetch = async input => {
    seen.push(String(input));
    return new Promise<Response>(resolve => {
      if (String(input).includes('/token')) releaseRefresh = resolve; else releaseUser = resolve;
    });
  };
  const pending = middleware(request());
  await flush();
  assert.equal(seen.length, 1);
  assert(seen[0].includes('/token'));
  now = 6000;
  t.mock.timers.tick(6000);
  releaseRefresh(refreshedSession());
  await flush();
  assert.equal(seen.length, 2);
  assert.equal(seen[1], url + '/auth/v1/user');
  now = 9000;
  t.mock.timers.tick(3000);
  releaseUser(json(user));
  const response = await pending;
  assert.equal(response.status, 200);
  assert(response.headers.get('set-cookie'));
});

test('real SDK refresh hang is cancelled at eight seconds, with no verification or late cookies', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(Date, 'now', () => new Date().getTime() + 7200000);
  let calls = 0;
  let signal!: AbortSignal;
  let release!: (value: Response) => void;
  globalThis.fetch = async (input, init) => {
    calls++;
    assert(String(input).includes('/token'));
    signal = init?.signal as AbortSignal;
    return new Promise<Response>(resolve => { release = resolve; });
  };
  const pending = middleware(request());
  await flush();
  t.mock.timers.tick(8000);
  const response = await pending;
  await unavailable(response);
  assert.equal(signal.aborted, true);
  release(refreshedSession());
  await flush();
  t.mock.timers.tick(60000);
  await flush();
  assert.equal(calls, 1);
  assert.equal(response.headers.get('set-cookie'), null);
});

test('successful refresh cannot authorize an unverified stored user or commit uncertain cookies', async t => {
  t.mock.method(Date, 'now', () => new Date().getTime() + 7200000);
  for (const status of [401, 503]) {
    let verifies = 0;
    globalThis.fetch = async input => {
      if (String(input).includes('/token')) return refreshedSession();
      verifies++;
      return json({ code: status === 401 ? 'session_not_found' : 'unexpected', message: 'synthetic' }, status);
    };
    const response = await middleware(request());
    assert.equal(verifies, 1);
    if (status === 401) {
      assert.equal(response.status, 307);
      assert.equal(new URL(response.headers.get('location')!).pathname, '/login');
    } else await unavailable(response);
    assert.equal(response.headers.get('set-cookie'), null);
  }
});

test('refresh retries share the eight-second phase and cannot restart network after expiry', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(Date, 'now', () => new Date().getTime() + 7200000);
  let calls = 0;
  globalThis.fetch = async () => { calls++; return json({ message: 'synthetic retry' }, 503); };
  const pending = middleware(request());
  await flush();
  assert.equal(calls, 1);
  t.mock.timers.tick(8000);
  await unavailable(await pending);
  const callsAtExpiry = calls;
  t.mock.timers.tick(60000);
  await flush();
  assert.equal(calls, callsAtExpiry);
});

test('phase deadlines cannot extend the overall limit or accept late preparatory success', async t => {
  let now = 0;
  t.mock.method(performance, 'now', () => now);
  let verifies = 0;
  const boundary = load({ createServerClient: () => ({ auth: {
    getSession: async () => { now = 7999; return preparedSession; },
    getUser: async () => { verifies++; now = 12000; return { data: { user }, error: null }; },
  } }) });
  await unavailable(await boundary(request()));
  assert.equal(verifies, 1);
  now = 0;
  const lateRefresh = load({ createServerClient: () => ({ auth: {
    getSession: async () => { now = 8000; return preparedSession; },
    getUser: async () => { verifies++; return { data: { user }, error: null }; },
  } }) });
  await unavailable(await lateRefresh(request()));
  assert.equal(verifies, 1);
  now = 0;
  const lateConstruction = load({ createServerClient: () => {
    now = 8000;
    return { auth: { getSession: async () => { throw new Error('must not start'); } } };
  } });
  await unavailable(await lateConstruction(request()));
});

test('concurrent requests do not share refresh deadlines, aborts or cookie proposals', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const signals: AbortSignal[] = [];
  let releaseRefresh!: (value: Response) => void;
  let releaseVerified!: (value: Response) => void;
  globalThis.fetch = async (input, init) => {
    const signal = init?.signal as AbortSignal;
    signals.push(signal);
    if (signals.length === 1) return new Promise<Response>((_resolve, reject) =>
      signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    return new Promise<Response>(resolve => {
      if (String(input).includes('/token')) releaseRefresh = resolve; else releaseVerified = resolve;
    });
  };
  const fresh = middleware(request());
  await flush();
  assert.equal(signals.length, 1);
  t.mock.method(Date, 'now', () => new Date().getTime() + 7200000);
  const stale = middleware(request());
  await flush();
  assert.equal(signals.length, 2);
  t.mock.timers.tick(4000);
  await unavailable(await fresh);
  assert.equal(signals[0].aborted, true);
  assert.equal(signals[1].aborted, false);
  releaseRefresh(refreshedSession());
  await flush();
  assert.equal(signals.length, 3);
  assert.equal(signals[1], signals[2], 'both phases of one request share its cancellation');
  assert.notEqual(signals[0], signals[2]);
  releaseVerified(json(user));
  const response = await stale;
  assert.equal(response.status, 200);
  assert(response.headers.get('set-cookie'));
  assert.equal(signals[2].aborted, false);
});
