/**
 * A node module-customization hook that lets `node --test` import a REAL component —
 * JSX, `@/` aliases, `next/navigation` and all.
 *
 * WHY THIS EXISTS. Every submission bug this repo has shipped lived in the seam
 * between the component and the helpers it calls, and a source-string assertion cannot
 * reach it: a click handler mutated to do nothing still matches every regex. The only
 * test that catches that is one that renders the component and clicks the button.
 *
 * Node strips TypeScript types natively but does NOT transform JSX, so a `.tsx`
 * component cannot be imported as-is. esbuild does the transform; the rest is resolution.
 *
 * Registered from inside the test file via `module.register`, NOT process-wide:
 * node:test runs each file in its own process, so this affects exactly the one test
 * that needs it and no other file's resolution changes.
 *
 * TWO ROOTS, AND WHY (2026-08-08).
 * A mutation harness copies a handful of files into a throwaway tree and runs the
 * suite there. That tree is NOT the repository: it has no `node_modules`, and it holds
 * only the files the harness chose to copy. Both gaps used to fail as
 * ERR_MODULE_NOT_FOUND *inside the test process*, which the harnesses scored as a
 * non-zero exit — i.e. as a KILLED mutant. Every rendered test was therefore "killing"
 * every mutation by crashing on an import, and no rendered assertion ever ran.
 *
 * So resolution is now explicitly two-rooted:
 *   MUTANT_ROOT  the throwaway tree. Anything the harness copied — and therefore
 *                anything it may have mutated — is here, and ALWAYS WINS.
 *   SOURCE_ROOT  the real repository, read-only. Where an uncopied `@/` or relative
 *                dependency comes from, unmutated, so a harness need not enumerate the
 *                full transitive closure of every component it touches.
 * A specifier found in neither still fails loudly: silence is what got us here.
 *
 * Both roots are passed in EXPLICITLY — `module.register(url, { data })` from a test,
 * or IMPLEXA_MUTANT_ROOT / IMPLEXA_SOURCE_ROOT from a harness. Neither is inferred
 * from `process.cwd()`: cwd is whatever the spawner happened to choose, and guessing
 * it is how a mutant tree silently resolves against the real repo.
 */

import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync, realpathSync } from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { transform } from 'esbuild';

/**
 * Roots are compared against `parentURL`, which Node has already resolved through
 * symlinks. On macOS `os.tmpdir()` is `/var/folders/…` but its real path is
 * `/private/var/folders/…`, so an unresolved root never prefix-matches an importer
 * inside it and the fallback below silently never fires. Resolve both ends.
 */
const real = (p) => { try { return realpathSync(p); } catch { return resolvePath(p); } };

/**
 * Default: the tree this loader file itself sits in. When a harness copies the loader
 * into the mutant tree, that IS the mutant tree — an identity, not a cwd guess.
 */
let MUTANT_ROOT = real(resolvePath(dirname(fileURLToPath(import.meta.url)), '..'));
/** Read-only fallback. `null` means "no fallback": an uncopied import fails loudly. */
let SOURCE_ROOT = process.env.IMPLEXA_SOURCE_ROOT ? real(process.env.IMPLEXA_SOURCE_ROOT) : null;
if (process.env.IMPLEXA_MUTANT_ROOT) MUTANT_ROOT = real(process.env.IMPLEXA_MUTANT_ROOT);

/** Modules replaced with local stubs: framework surfaces a node test cannot run. */
const STUBS = new Map([
  ['next/navigation', ['scripts', 'stubs', 'next-navigation.mjs']],
]);

/**
 * Explicit configuration from `module.register(url, { data })`. A test that needs its
 * own stubs (a component's external boundaries — auth, transport, routing) passes them
 * here rather than the loader carrying a growing global map that every other test
 * silently inherits.
 */
export async function initialize(data) {
  if (!data || typeof data !== 'object') return;
  if (data.mutantRoot) MUTANT_ROOT = real(data.mutantRoot);
  if (data.sourceRoot) SOURCE_ROOT = real(data.sourceRoot);
  if (data.stubs) {
    for (const [specifier, target] of Object.entries(data.stubs)) {
      STUBS.set(specifier, Array.isArray(target) ? target : [target]);
    }
  }
}

const EXTS = ['', '.tsx', '.ts', '.jsx', '.js', '.mjs', '/index.tsx', '/index.ts', '/index.js'];

function firstExisting(base) {
  for (const ext of EXTS) {
    const candidate = base + ext;
    if (existsSync(candidate) && !candidate.endsWith('/')) return candidate;
  }
  return null;
}

/**
 * Mutant tree first, real repository second. The order is the whole contract: a file
 * the harness copied (and possibly mutated) must never lose to its pristine original.
 */
function resolveInRoots(relativeParts) {
  const found = firstExisting(join(MUTANT_ROOT, ...relativeParts));
  if (found) return found;
  if (SOURCE_ROOT) return firstExisting(join(SOURCE_ROOT, ...relativeParts));
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  const stub = STUBS.get(specifier);
  if (stub) {
    const found = resolveInRoots(stub);
    if (found) return { url: pathToFileURL(found).href, shortCircuit: true };
  }

  // `@/lib/x` -> <root>/lib/x, with the extension the file actually has.
  if (specifier.startsWith('@/')) {
    const found = resolveInRoots([specifier.slice(2)]);
    if (found) return { url: pathToFileURL(found).href, shortCircuit: true };
  }

  // Relative imports that omit their extension (or point at a .tsx).
  if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
    const parentDir = real(dirname(fileURLToPath(context.parentURL)));
    const found = firstExisting(resolvePath(parentDir, specifier));
    if (found) return { url: pathToFileURL(found).href, shortCircuit: true };
    // The importer lives in the mutant tree but this dependency was never copied.
    // Re-hang the same relative path off the real repository so the harness does not
    // have to enumerate a component's full transitive closure to render it.
    if (SOURCE_ROOT && parentDir.startsWith(MUTANT_ROOT)) {
      const fromSource = resolvePath(
        join(SOURCE_ROOT, parentDir.slice(MUTANT_ROOT.length)), specifier,
      );
      const alt = firstExisting(fromSource);
      if (alt) return { url: pathToFileURL(alt).href, shortCircuit: true };
    }
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
