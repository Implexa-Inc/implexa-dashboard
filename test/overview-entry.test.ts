import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { legacyDestination, postAuthDestination } from '../lib/navigation.ts';

// Execute the actual page entry. These are control-flow seams, not HTTP/DTO
// fixtures: any legacy reader is forbidden on an ordinary Desktop launch.
const require = createRequire(import.meta.url);
const code = (await build({ entryPoints: [new URL('../app/(dashboard)/overview/page.tsx', import.meta.url).pathname],
  bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
  plugins: [{ name: 'page-import-seams', setup(build) {
    build.onResolve({ filter: /.*/ }, args => args.kind === 'entry-point' ? undefined : { path: args.path, external: true });
  } }],
})).outputFiles![0].text;
let legacyReads = 0;
const legacyRead = new Error('existing website-intent handoff reached its session reader');
const module = { exports: {} as any };
new Function('require', 'module', 'exports', code)((name: string) => {
  if (name === 'next/navigation') return { redirect: (href: string) => { throw { redirect: href }; } };
  if (name === '@/lib/navigation') return { legacyDestination };
  if (name === '@/lib/supabase/server') return { createClient: () => { legacyReads++; throw legacyRead; } };
  if (name === 'react') return require('react');
  // Imports below the early redirect must not be invoked by this regression.
  return new Proxy({}, { get: () => () => { throw new Error(`unexpected legacy dependency: ${name}`); } });
}, module, module.exports);
const OverviewPage = module.exports.default;

test('ordinary legacy Desktop launch redirects before old Build/Today/Results reads', async () => {
  await assert.rejects(OverviewPage({}), error => (error as any).redirect === '/work');
  assert.equal(legacyReads, 0);
});

test('legacy entry preserves query and deep-link values on the fixed Work destination', async () => {
  const searchParams = { run: 'run-fixture', view: 'review', tag: ['one', 'two'], next: 'https://untrusted.invalid' };
  await assert.rejects(OverviewPage({ searchParams }), error => {
    const target = new URL((error as any).redirect, 'https://fixture.invalid');
    assert.equal(target.origin, 'https://fixture.invalid');
    assert.equal(target.pathname, '/work');
    assert.equal(target.searchParams.get('run'), 'run-fixture');
    assert.equal(target.searchParams.get('view'), 'review');
    assert.deepEqual(target.searchParams.getAll('tag'), ['one', 'two']);
    return true;
  });
  assert.equal(legacyReads, 0);
});

test('blank intent is ordinary launch; explicit website intent keeps its existing consumer', async () => {
  for (const intent of ['', '   ', ['', 'ignored-second-value']]) {
    await assert.rejects(OverviewPage({ searchParams: { intent } }), error =>
      String((error as any).redirect).startsWith('/work?'));
  }
  const destination = postAuthDestination({ intent: 'Research a topic' });
  assert.equal(destination, '/overview?intent=Research%20a%20topic');
  for (const intent of ['Research a topic', ['Research a topic', 'second']]) {
    await assert.rejects(OverviewPage({ searchParams: { intent } }), error => error === legacyRead);
  }
  assert.equal(legacyReads, 2);
});
