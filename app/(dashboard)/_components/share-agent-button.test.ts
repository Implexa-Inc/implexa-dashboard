import test from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../../../lib/test/render.ts';

const id = '11111111-1111-4111-8111-111111111111';
const version = '22222222-2222-4222-8222-222222222222';

test('Share copies one stable family link and does not change publication', async t => {
  let copied = '';
  const methods: string[] = [];
  const r = await render('./share-agent-button.tsx', { id, slug: 'video-agent', canPublish: true }, {
    fetch: (async (_url, options) => {
      methods.push(options?.method || 'GET');
      return new Response(null, { status: 200 });
    }) as typeof fetch,
  });
  t.after(r.cleanup);
  Object.defineProperty(r.window.navigator, 'clipboard', { value: { writeText: async (text: string) => { copied = text; } } });
  await r.click(r.getByText('Share'));
  await r.click(r.getByText('Copy link'));
  assert.equal(copied, new URL(`/s/agent/${id}`, r.window.location.origin).href);
  assert.deepEqual(methods, ['GET']);
});

test('private owners explicitly publish the checked version before a link is shown', async t => {
  let published = false;
  const writes: unknown[] = [];
  const r = await render('./share-agent-button.tsx', { id, slug: 'video-agent', canPublish: true }, {
    fetch: (async (url, options) => {
      if (String(url).startsWith('/api/agents/share')) return new Response(null, { status: published ? 200 : 404 });
      if (options?.method !== 'POST') return Response.json({ ok: true,
        publication: { versionId: version, publishedVersionId: version } });
      writes.push(JSON.parse(String(options.body)));
      published = true;
      return Response.json({ ok: true });
    }) as typeof fetch,
  });
  t.after(r.cleanup);
  await r.click(r.getByText('Share'));
  assert.equal(r.queryByText('Copy link'), null);
  assert.deepEqual(writes, []);
  await r.click(r.getByText('Make public and share'));
  assert.deepEqual(writes, [{ expectedVersionId: version, definitionOnlyConfirmed: true }]);
  assert.ok(r.getByText('Copy link'));
});

test('making an agent private requires confirmation and disables its public link', async t => {
  let published = true;
  const writes: unknown[] = [];
  const r = await render('./share-agent-button.tsx', { id, slug: 'video-agent', canPublish: true }, {
    fetch: (async (url, options) => {
      if (String(url).startsWith('/api/agents/share')) return new Response(null, { status: published ? 200 : 404 });
      if (options?.method !== 'POST') return Response.json({ ok: true,
        publication: { versionId: version, publishedVersionId: version } });
      writes.push(JSON.parse(String(options.body)));
      published = false;
      return Response.json({ ok: true });
    }) as typeof fetch,
  });
  t.after(r.cleanup);
  await r.click(r.getByText('Share'));
  await r.click(r.getByText('Make private'));
  assert.deepEqual(writes, []);
  await r.click(r.getByText('Confirm make private'));
  assert.deepEqual(writes, [{ expectedVersionId: version, makePrivate: true }]);
  assert.ok(r.queryByText('Public link disabled.'));
  assert.equal(r.queryByText('Copy link'), null);
});
