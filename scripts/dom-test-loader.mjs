/**
 * A node module-customization hook that lets `node --test` import the REAL Review Room
 * component — JSX, `@/` aliases, `next/navigation` and all.
 *
 * WHY THIS EXISTS. Every submission bug this repo has shipped lived in the seam
 * between the component and the helpers it calls, and a source-string assertion cannot
 * reach it: a click handler mutated to do nothing still matches every regex. The only
 * test that catches that is one that renders the component and clicks the button.
 *
 * Node strips TypeScript types natively but does NOT transform JSX, so `review-room.tsx`
 * cannot be imported as-is. esbuild does the transform; the rest is resolution.
 *
 * Registered from inside the test file via `module.register`, NOT process-wide:
 * node:test runs each file in its own process, so this affects exactly the one test
 * that needs it and no other file's resolution changes.
 */

import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { transform } from 'esbuild';

const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..');

/** Modules replaced with local stubs: framework surfaces a node test cannot run. */
const STUBS = new Map([
  ['next/navigation', join(ROOT, 'scripts', 'stubs', 'next-navigation.mjs')],
]);

const EXTS = ['', '.tsx', '.ts', '.jsx', '.js', '.mjs', '/index.tsx', '/index.ts', '/index.js'];

function firstExisting(base) {
  for (const ext of EXTS) {
    const candidate = base + ext;
    if (existsSync(candidate) && !candidate.endsWith('/')) return candidate;
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  const stub = STUBS.get(specifier);
  if (stub) return { url: pathToFileURL(stub).href, shortCircuit: true };

  // `@/lib/x` -> <root>/lib/x, with the extension the file actually has.
  if (specifier.startsWith('@/')) {
    const found = firstExisting(join(ROOT, specifier.slice(2)));
    if (found) return { url: pathToFileURL(found).href, shortCircuit: true };
  }

  // Relative imports that omit their extension (or point at a .tsx).
  if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
    const base = resolvePath(dirname(fileURLToPath(context.parentURL)), specifier);
    const found = firstExisting(base);
    if (found) return { url: pathToFileURL(found).href, shortCircuit: true };
  }

  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (!url.startsWith('file:') || !/\.(tsx|jsx)$/.test(url)) return nextLoad(url, context);
  const raw = await nextLoad(url, { ...context, format: 'module' });
  const source = typeof raw.source === 'string' ? raw.source : Buffer.from(raw.source).toString('utf8');
  const { code } = await transform(source, {
    loader: url.endsWith('.tsx') ? 'tsx' : 'jsx',
    format: 'esm',
    target: 'node20',
    jsx: 'automatic',
    sourcefile: fileURLToPath(url),
  });
  return { format: 'module', source: code, shortCircuit: true };
}
