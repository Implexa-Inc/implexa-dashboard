/**
 * A tiny module loader so `node --test` can actually RENDER a React component.
 *
 * WHY THIS EXISTS. Every test in this repo until now asserted over component
 * SOURCE TEXT, because Node can strip types from `.ts` but cannot parse JSX, so
 * importing a `.tsx` file fails with ERR_UNKNOWN_FILE_EXTENSION. Source-regex
 * guards are fine for pinning an internal invariant, and hopeless for the shell:
 * "does the narrow-viewport bar expose the same three destinations", "is the
 * selected item announced to a screen reader", and "is every destination
 * reachable by keyboard" are questions about the rendered output, and a regex
 * that answers them is really only checking that a string still exists.
 *
 * So: register a resolve/load hook pair that
 *   1. transpiles `.ts`/`.tsx` with the TypeScript compiler already in
 *      devDependencies — no new package, no bundler, no jsdom;
 *   2. resolves the `@/*` path alias the way tsconfig/Next do; and
 *   3. redirects `next/link` and `next/navigation` to the stubs beside this
 *      file, so a client component can be rendered outside a Next runtime.
 *
 * The components under test are imported UNMODIFIED. Rendering is
 * `renderToStaticMarkup`, which runs the real component functions and their
 * real props/branching — effects do not run, which is exactly right here: the
 * shell's navigation must be correct in the server-rendered HTML, before any
 * hydration.
 *
 * USAGE — the register must run before the component is resolved, so import
 * this module statically and import the component dynamically:
 *
 *     import './support/tsx-register.mjs';
 *     const { default: Sidebar } = await import('@/app/(dashboard)/_components/sidebar.tsx');
 */

import { registerHooks, createRequire } from 'node:module';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve as resolvePath } from 'node:path';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolvePath(HERE, '..', '..');

/** Next runtime modules a client component pulls in, mapped to local stubs. */
const STUBS = {
  'next/link':       join(HERE, 'stubs', 'next-link.tsx'),
  'next/navigation': join(HERE, 'stubs', 'next-navigation.ts'),
};

const EXTENSIONS = ['', '.tsx', '.ts', '.mjs', '.js', '/index.tsx', '/index.ts'];

function firstExistingFile(base) {
  for (const ext of EXTENSIONS) {
    const candidate = base + ext;
    try { if (statSync(candidate).isFile()) return candidate; } catch { /* next candidate */ }
  }
  return null;
}

function fileResult(path) {
  return { url: pathToFileURL(path).href, shortCircuit: true };
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (STUBS[specifier]) return fileResult(STUBS[specifier]);

    // tsconfig `paths`: { "@/*": ["./*"] }
    if (specifier.startsWith('@/')) {
      const hit = firstExistingFile(join(ROOT, specifier.slice(2)));
      if (hit) return fileResult(hit);
    }

    // Relative imports inside app/ and lib/ are extensionless.
    if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL?.startsWith('file:')) {
      const hit = firstExistingFile(resolvePath(dirname(fileURLToPath(context.parentURL)), specifier));
      if (hit) return fileResult(hit);
    }

    return nextResolve(specifier, context);
  },

  load(url, context, nextLoad) {
    if (!url.startsWith('file:') || !/\.tsx?$/.test(url)) return nextLoad(url, context);
    const path = fileURLToPath(url);
    const { outputText } = ts.transpileModule(readFileSync(path, 'utf8'), {
      fileName: path,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        // Automatic runtime: no `import React` needed in the source files.
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
        isolatedModules: true,
      },
    });
    return { format: 'module', source: outputText, shortCircuit: true };
  },
});
