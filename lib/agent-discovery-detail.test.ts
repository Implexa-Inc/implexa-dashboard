import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { buildSync } from 'esbuild';

type ResumeLookup = (slug: string, jwt: string) => Promise<unknown>;

function loadGetAgentResume(): ResumeLookup {
  const built = buildSync({
    entryPoints: [join(import.meta.dirname, 'agent-discovery.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
    tsconfig: join(import.meta.dirname, '..', 'tsconfig.json'),
  }).outputFiles[0].text;
  const module = { exports: {} as { getAgentResume?: ResumeLookup } };
  new Function('module', 'exports', 'require', built)(module, module.exports, createRequire(import.meta.url));
  assert.equal(typeof module.exports.getAgentResume, 'function');
  return module.exports.getAgentResume!;
}

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

test('detail lookup distinguishes authoritative absence from outages and malformed success', async (t) => {
  const getAgentResume = loadGetAgentResume();
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  globalThis.fetch = async () => response(404, { error: 'not found' });
  assert.deepEqual(await getAgentResume('ordinary-workflow', 'jwt'), { status: 'not_marketplace' });

  globalThis.fetch = async () => response(503, { error: 'readiness unavailable' });
  assert.deepEqual(await getAgentResume('marketplace-agent', 'jwt'), { status: 'unavailable', reason: 'readiness unavailable' });

  globalThis.fetch = async () => { throw new Error('network down'); };
  assert.deepEqual(await getAgentResume('marketplace-agent', 'jwt'), { status: 'unavailable', reason: 'network down' });

  globalThis.fetch = async () => response(200, { ok: true });
  assert.deepEqual(await getAgentResume('marketplace-agent', 'jwt'), { status: 'unavailable', reason: 'Agent resume response was incomplete.' });
});

test('workflow detail falls back only for authoritative non-marketplace absence', () => {
  const page = readFileSync(join(import.meta.dirname, '..', 'app', '(dashboard)', 'workflows', '[slug]', 'page.tsx'), 'utf8');
  assert.match(page, /resume\.status === 'found'/);
  assert.match(page, /resume\.status === 'unavailable'/);
  assert.match(page, /Marketplace readiness could not be verified, so running is disabled/);
  assert.doesNotMatch(page, /resume\.status === 'unavailable'[\s\S]{0,300}getMyWorkflow/,
    'an unavailable authority must return before any legacy runnable fallback');
});
