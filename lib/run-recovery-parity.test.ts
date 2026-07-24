// node --test lib/run-recovery-parity.test.ts
//
// Two copies of ONE rule (deriveRecoveredWork), one in each runtime — see the
// header comment in run-recovery.ts for why a second copy is unavoidable here.
// ARCHITECTURE §8.1's resolution for an unavoidable second copy is to
// guard-test it against the other's SOURCE, so a change to one that forgets the
// other fails a test instead of silently drifting (this codebase's "two homes"
// incidents are all this exact shape).
//
// implexa-backend is a SIBLING checkout on disk in this environment (both repos
// live under revenoid-workspace/Implexa/), but a dashboard-only CI run won't have
// it — so this degrades to a same-repo literal check rather than failing the
// build over a checkout layout it doesn't control. Either way, the actual
// exported RECOVERABLE_STATES/regex objects are exercised directly, not just the
// backend's source text, so the more important half of this test never degrades.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { RECOVERABLE_STATES, deriveRecoveredWork } from './run-recovery.ts';

const BACKEND_LIB = join(import.meta.dirname, '..', '..', 'implexa-backend', 'src', 'lib', 'run-recovery.js');

test('RECOVERABLE_STATES matches the backend exactly — stalled and failed, nothing else', () => {
  assert.deepEqual([...RECOVERABLE_STATES].sort(), ['failed', 'stalled']);
});

test('running/completed/cancelled are never recoverable client-side either', () => {
  for (const runState of ['running', 'completed', 'cancelled']) {
    const r = deriveRecoveredWork({ runState, outputMarkdown: null, progress: { current: { note: 'VERIFIED: done' } } });
    assert.equal(r.recoverable, false, runState);
  }
});

test('a PROGRESS marker beats a TERMINAL word in the client mirror too', () => {
  const r = deriveRecoveredWork({ runState: 'stalled', outputMarkdown: null, progress: { current: { note: 'encode ~55% done' } } });
  assert.equal(r.looksComplete, false);
});

test('if the backend checkout is present, the two source files still agree on markers', { skip: !existsSync(BACKEND_LIB) }, () => {
  const backendSrc = readFileSync(BACKEND_LIB, 'utf8');
  const dashSrc = readFileSync(join(import.meta.dirname, 'run-recovery.ts'), 'utf8');
  const extract = (src: string, name: string) => {
    const m = src.match(new RegExp(`${name}\\s*=\\s*(/.+?/i)`));
    assert.ok(m, `${name} must exist in the source read`);
    return m![1];
  };
  assert.equal(extract(dashSrc, 'TERMINAL_MARKERS'), extract(backendSrc, '_TERMINAL_MARKERS'),
    'a marker added to one side and not the other silently changes which runs look complete');
  assert.equal(extract(dashSrc, 'PROGRESS_MARKERS'), extract(backendSrc, '_PROGRESS_MARKERS'));
});
