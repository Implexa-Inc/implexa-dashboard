import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { readUserProfile, ProfileReadUnavailableError, PROFILE_READ_TIMEOUT_MS } from './profile-read.ts';

test('only a successful null profile is absent; a successful member survives unchanged', async () => {
  const member = { id: 'fixture', organization_id: 'org' };
  const query = (data: unknown) => ({ abortSignal: () => ({ maybeSingle: () => Promise.resolve({ data, error: null }) }) });
  assert.equal(await readUserProfile(query(null)), null);
  assert.equal(await readUserProfile(query(member)), member);
});

test('upstream errors, partial rows and invalid results are unavailable, never absent', async () => {
  for (const result of [
    { data: null, error: { code: '57014' } },
    { data: { organization_id: 'org' }, error: { code: 'PGRST' } },
    { data: undefined, error: null },
    { data: [], error: null },
    { data: 'bad', error: null },
  ]) {
    await assert.rejects(readUserProfile({ abortSignal: () => ({ maybeSingle: () => Promise.resolve(result) }) }), ProfileReadUnavailableError);
  }
});

test('rejected diagnostics are sanitized', async () => {
  await assert.rejects(readUserProfile({ abortSignal: () => ({ maybeSingle: () => Promise.reject(new Error('private upstream detail')) }) }), error => {
    assert(error instanceof ProfileReadUnavailableError);
    assert.equal(error.code, 'profile_read_unavailable');
    assert.doesNotMatch(error.message, /private upstream/);
    return true;
  });
});

test('a never-settling read is bounded and cancelled, even when transport ignores abort', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal: AbortSignal | undefined;
  const promise = readUserProfile({ abortSignal: value => { signal = value; return { maybeSingle: () => new Promise(() => {}) }; } });
  const refusal = assert.rejects(promise, ProfileReadUnavailableError);
  assert.equal(signal?.aborted, false);
  t.mock.timers.tick(PROFILE_READ_TIMEOUT_MS);
  await refusal;
  assert.equal(signal?.aborted, true);
});

test('a late success after timeout cannot turn the refusal into membership', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let resolve: (value: { data: unknown; error: null }) => void = () => {};
  const upstream = new Promise<{ data: unknown; error: null }>(value => { resolve = value; });
  const promise = readUserProfile({ abortSignal: () => ({ maybeSingle: () => upstream }) });
  const refusal = assert.rejects(promise, ProfileReadUnavailableError);
  t.mock.timers.tick(PROFILE_READ_TIMEOUT_MS);
  await refusal;
  resolve({ data: { organization_id: 'late' }, error: null });
  await Promise.resolve();
});

test('actual SDK preserves the selected columns, user filter and abort signal', async () => {
  const observed: { url: string; signal?: AbortSignal | null }[] = [];
  const member = { organization_id: 'org' };
  const client = createClient('https://fixture.invalid', 'fixture-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (url, init) => {
      observed.push({ url: String(url), signal: init?.signal });
      return new Response(JSON.stringify([member]), { status: 200, headers: { 'content-type': 'application/json' } });
    } },
  });
  assert.deepEqual(await readUserProfile(client.from('users').select('organization_id').eq('id', 'fixture-user')), member);
  const request = new URL(observed[0].url);
  assert.equal(request.pathname, '/rest/v1/users');
  assert.equal(request.searchParams.get('select'), 'organization_id');
  assert.equal(request.searchParams.get('id'), 'eq.fixture-user');
  assert.equal(observed[0].signal?.aborted, false);
});

test('actual SDK transport is cancelled at the profile deadline without a retry', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal: AbortSignal | undefined;
  let calls = 0;
  let markStarted = () => {};
  const started = new Promise<void>(resolve => { markStarted = resolve; });
  const client = createClient('https://fixture.invalid', 'fixture-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (_url, init) => {
      calls++;
      signal = init?.signal as AbortSignal;
      markStarted();
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal?.reason), { once: true });
      });
    } },
  });
  const refusal = assert.rejects(readUserProfile(client.from('users').select('organization_id').eq('id', 'fixture-user')), ProfileReadUnavailableError);
  await started;
  assert.equal(calls, 1);
  t.mock.timers.tick(PROFILE_READ_TIMEOUT_MS);
  await refusal;
  for (let i = 0; i < 8; i++) await Promise.resolve();
  t.mock.timers.tick(10000);
  assert.equal(signal?.aborted, true);
  assert.equal(calls, 1);
});
