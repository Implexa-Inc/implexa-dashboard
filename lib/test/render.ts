/**
 * A real DOM renderer for this repo's tests.
 *
 * WHY THIS EXISTS. Until now the only way to assert anything about a component
 * here was to read its SOURCE and match a regular expression. That catches a
 * deleted line and nothing else, and it is confidently green for every defect
 * that lives in the relationship between lines: a button rendered but disabled,
 * a handler wired to the wrong field, an error computed and never displayed, a
 * condition that is true for the wrong contract. `run-input-surface-parity.test.ts`
 * says so out loud — "this repo has no DOM renderer, so the parity itself is
 * pinned as source" — and the folder work is exactly the kind of change a source
 * regex cannot grade: "the folder button appears only for a folder-capable
 * contract" is a statement about what RENDERS, for a given contract, in a given
 * bridge environment.
 *
 * HOW. esbuild bundles the component with the handful of framework and network
 * modules replaced by stubs (below), and the bundle runs inside jsdom against
 * the real React and react-dom. Everything else — the component, the contract
 * helpers, the sibling components it renders — is the real module.
 *
 * The stubs are deliberately tiny and deliberately few. Each one replaces
 * something that is not the thing under test and cannot run here: the Next.js
 * router, the Supabase browser client, and the backend fetch wrapper. A stub for
 * anything else would start to make these tests a description of the mocks.
 */

import { buildSync } from 'esbuild';
import { JSDOM } from 'jsdom';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';


const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Calls the stubs recorded, so a test can assert what a component asked for. */
export type RenderCalls = {
  push: string[];
  backend: Array<{ path: string; init: unknown }>;
};

export type Rendered = {
  window: Window & typeof globalThis;
  document: Document;
  calls: RenderCalls;
  /** Run a mutation and flush React's work, exactly like `act`. */
  act: (fn: () => unknown) => Promise<void>;
  text: () => string;
  queryAllByText: (pattern: string | RegExp) => Element[];
  getByText: (pattern: string | RegExp) => Element;
  queryByText: (pattern: string | RegExp) => Element | null;
  click: (element: Element) => Promise<void>;
  cleanup: () => void;
};

async function bundle(entry: string): Promise<string> {
  // buildSync starts no long-lived esbuild service. The async API leaves a
  // helper process with process-group cleanup hooks; under node:test inside a
  // mutation harness that helper can terminate the harness parent before it
  // records the result. These bundles are tiny and test-only, so deterministic
  // process lifetime matters more than async build throughput.
  const result = buildSync({
    stdin: { contents: entry, resolveDir: join(ROOT, 'app', '(dashboard)', '_components'), loader: 'tsx' },
    bundle: true,
    write: false,
    format: 'iife',
    globalName: '__harness',
    platform: 'browser',
    absWorkingDir: ROOT,
    target: 'es2022',
    jsx: 'automatic',
    // React and react-dom are provided by the harness, not bundled twice.
    external: [],
    define: { 'process.env.NODE_ENV': '"development"' },
    loader: { '.css': 'empty' },
    alias: {
      'next/navigation': join(ROOT, 'lib/test/stubs/next-navigation.ts'),
      'next/link': join(ROOT, 'lib/test/stubs/next-link.tsx'),
      '@/lib/supabase/client': join(ROOT, 'lib/test/stubs/supabase.ts'),
      '@/lib/api': join(ROOT, 'lib/test/stubs/api.ts'),
    },
  });
  return result.outputFiles![0].text;
}

/**
 * Render `component` (a path relative to `_components`) with `props`.
 *
 * `bridge` becomes `window.implexaDesktop` BEFORE the first render, because the
 * components read it during an effect on mount — which is the whole point of
 * several of these tests: what renders when there is no Desktop at all.
 */
export async function render(component: string, props: Record<string, unknown>, options: {
  bridge?: Record<string, unknown> | null;
  backend?: (path: string, init: unknown) => unknown;
} = {}): Promise<Rendered> {
  // React's browser scheduler creates long-lived MessagePorts. jsdom.close()
  // does not own ports created by code evaluated in its window, so remember the
  // process handles that predate this renderer and close only the new ports on
  // cleanup. Without this ownership boundary a rendered test can pass every
  // assertion yet keep node --test alive forever; a mutation harness then
  // mistakes the timeout for a killed mutant.
  const activeHandles = () => (process as unknown as { _getActiveHandles?: () => unknown[] })
    ._getActiveHandles?.() || [];
  const handlesBeforeRender = new Set(activeHandles());
  const entry = `
    import * as React from 'react';
    import { createRoot } from 'react-dom/client';
    import * as TestUtils from 'react-dom/test-utils';
    import Component from ${JSON.stringify(`./${component}`)};
    // React 18.3 exposes act on React itself; react-dom/test-utils is the
    // fallback. Using the BUNDLED React's act matters — a second copy would
    // flush a different renderer's queue and silently do nothing.
    const act = React.act || TestUtils.act;
    // Keep the act scope open through the microtask turn in which an event
    // handler's deliberately-void async work resolves. A synchronous act around
    // dispatch alone produces a green DOM assertion while React warns that the
    // state update happened outside the test boundary — another discarded
    // signal. The MessageChannel installed below is unref'd, so async act can
    // flush without keeping node --test alive.
    globalThis.__act = async (fn) => {
      await act(async () => {
        const pending = fn();
        if (pending && typeof pending.then === 'function') await pending;
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    };
    globalThis.__mount = (target, props) => {
      const root = createRoot(target);
      act(() => { root.render(React.createElement(Component, props)); });
      return () => act(() => root.unmount());
    };
  `;
  const code = await bundle(entry);

  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    runScripts: 'outside-only',
    url: 'https://dashboard.test/agents/test-agent',
  });
  const { window } = dom;
  const calls: RenderCalls = { push: [], backend: [] };
  (window as unknown as Record<string, unknown>).__implexaCalls = calls;
  if (options.backend) (window as unknown as Record<string, unknown>).__implexaBackend = options.backend;
  if (options.bridge) (window as unknown as Record<string, unknown>).implexaDesktop = options.bridge;
  (window as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  // React's scheduler posts its flush through a MessageChannel, which jsdom does
  // not implement. Node's is a faithful one — but its ports are REF'D, and React
  // holds them for the lifetime of the renderer, so the test process would never
  // exit and `node --test` would hang instead of reporting. Unref'ing both ends
  // keeps the channel fully functional while letting the loop drain.
  class UnrefdMessageChannel extends MessageChannel {
    constructor() {
      super();
      (this.port1 as unknown as { unref?: () => void }).unref?.();
      (this.port2 as unknown as { unref?: () => void }).unref?.();
    }
  }
  // jsdom 30 supplies its own MessageChannel, but those ports are ref'd too.
  // Always replace it; checking only for absence left two live ports per render
  // and made every rendered mutation test time out after its assertions passed.
  (window as unknown as Record<string, unknown>).MessageChannel = UnrefdMessageChannel;
  (window as unknown as Record<string, unknown>).MessagePort = MessagePort;
  // jsdom has no crypto.randomUUID before Node's webcrypto is attached.
  if (!window.crypto?.randomUUID) {
    Object.defineProperty(window, 'crypto', { value: globalThis.crypto, configurable: true });
  }
  if (!(window as unknown as Record<string, unknown>).fetch) {
    (window as unknown as Record<string, unknown>).fetch = async () => ({ ok: true, json: async () => ({}) });
  }
  window.matchMedia = window.matchMedia || (() => ({
    matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {},
  } as unknown as MediaQueryList));

  // The bundle is evaluated as a script inside the jsdom window, so the React it
  // closes over and the DOM it writes into are the same ones the test inspects.
  window.eval(code);

  const target = window.document.getElementById('root')!;

  const act = async (fn: () => unknown) => {
    // React 18's act lives on the bundled React; the harness exposes a flush
    // that awaits microtasks and lets scheduled effects run, which is what these
    // assertions need and is deterministic under jsdom.
    await (window as unknown as { __act: (f: () => unknown) => Promise<void> }).__act(fn);
  };

  const mount = (window as unknown as { __mount: (t: Element, p: unknown) => () => void }).__mount;
  let unmount: () => void = () => {};
  await act(() => { unmount = mount(target, props); });

  const matches = (pattern: string | RegExp) => {
    const all = Array.from(window.document.querySelectorAll('*'));
    return all.filter((element) => {
      const own = Array.from(element.childNodes)
        .filter((node) => node.nodeType === 3)
        .map((node) => node.textContent || '')
        .join('');
      const text = (element.textContent || '').replace(/\s+/g, ' ').trim();
      const ownText = own.replace(/\s+/g, ' ').trim();
      const subject = ownText || text;
      return typeof pattern === 'string' ? subject.includes(pattern) : pattern.test(subject);
    });
  };

  return {
    window: window as unknown as Window & typeof globalThis,
    document: window.document,
    calls,
    act,
    text: () => (window.document.body.textContent || '').replace(/\s+/g, ' ').trim(),
    queryAllByText: matches,
    getByText: (pattern) => {
      const found = matches(pattern);
      if (!found.length) throw new Error(`no element matching ${pattern} in:\n${window.document.body.textContent}`);
      return found[found.length - 1];
    },
    queryByText: (pattern) => {
      const found = matches(pattern);
      return found.length ? found[found.length - 1] : null;
    },
    click: async (element: Element) => {
      await act(() => {
        element.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
      });
    },
    cleanup: () => {
      unmount();
      dom.window.close();
      for (const handle of activeHandles()) {
        if (handlesBeforeRender.has(handle)) continue;
        if ((handle as { constructor?: { name?: string } }).constructor?.name !== 'MessagePort') continue;
        (handle as { close?: () => void }).close?.();
      }
    },
  };
}
